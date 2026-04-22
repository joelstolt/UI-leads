/**
 * enrich-sitemap.js — Räknar URL:er i sitemap.xml + checkar robots.txt
 *
 * Stark SEO-signal:
 *   - 0 sidor i sitemap → sajt med tom SEO-strategi
 *   - 5 sidor → minimal sajt (often Wix/SQ-default)
 *   - 50+ sidor → engagerad innehållsstrategi
 *   - Saknar sitemap helt → SEO-amatör eller statisk sajt
 *
 * Robots.txt-signaler: noindex/disallow på viktiga paths = SEO-bug
 *
 * Användning:
 *   node enrich-sitemap.js                 → alla bolag med hemsida som inte är checkade
 *   node enrich-sitemap.js --branch snickare
 *   node enrich-sitemap.js --limit 200
 *   node enrich-sitemap.js --recheck
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");

const CONCURRENCY = 10;
const TIMEOUT_MS = 8000;
const MAX_SITEMAP_DEPTH = 2; // Sitemap-index får peka på child-sitemaps; vi följer 1 nivå

// ── DB-helpers ────────────────────────────────────────────────

function ensureSitemapColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  const adds = [
    ["sitemap_url", "TEXT"],
    ["sitemap_url_count", "INTEGER"], // antal <url> totalt
    ["robots_has_sitemap", "INTEGER"], // 1 om robots.txt pekar på sitemap
    ["robots_disallows_root", "INTEGER"], // 1 om robots.txt har Disallow: /
    ["sitemap_checked_at", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
    }
  }
}

function getLeadsToCheck(opts) {
  const conditions = ["website IS NOT NULL AND website != ''"];
  const params = [];
  if (!opts.recheck) conditions.push("sitemap_checked_at IS NULL");
  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }
  return getDb()
    .prepare(
      `SELECT place_id, name, website, priority
       FROM companies WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE priority WHEN '🔥 A+' THEN 1 WHEN '🟡 A' THEN 2 WHEN '🔵 B' THEN 3 ELSE 4 END,
         created_at ASC
       LIMIT ?`
    )
    .all(...params, opts.limit);
}

function saveResult(placeId, r) {
  getDb()
    .prepare(
      `UPDATE companies
       SET sitemap_url             = ?,
           sitemap_url_count       = ?,
           robots_has_sitemap      = ?,
           robots_disallows_root   = ?,
           sitemap_checked_at      = datetime('now'),
           updated_at              = datetime('now')
       WHERE place_id = ?`
    )
    .run(
      r.sitemapUrl ?? null,
      r.urlCount,
      r.robotsHasSitemap ? 1 : 0,
      r.robotsDisallowsRoot ? 1 : 0,
      placeId
    );
}

// ── Network ───────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LeadScraper/2.0; +https://stoltmarketing.se)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), url: res.url };
}

function originOf(url) {
  const clean = url.startsWith("http") ? url : `https://${url}`;
  try {
    const u = new URL(clean);
    return u.origin;
  } catch {
    return null;
  }
}

// ── Robots.txt ────────────────────────────────────────────────

function parseRobots(text) {
  const sitemapUrls = [];
  let disallowsRoot = false;
  let inGlobalAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [k, ...rest] = line.split(":");
    const key = (k || "").trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") inGlobalAgent = val === "*";
    if (key === "sitemap" && val) sitemapUrls.push(val);
    if (key === "disallow" && val === "/" && inGlobalAgent) disallowsRoot = true;
  }

  return { sitemapUrls, disallowsRoot };
}

// ── Sitemap parsing (regex, no XML deps) ─────────────────────

function countUrls(xml) {
  // Räknar bara <url><loc>...</loc></url> (inte <sitemap>-pek)
  return (xml.match(/<url\b[\s\S]*?<\/url>/gi) || []).length;
}

function extractChildSitemaps(xml) {
  // <sitemap><loc>URL</loc></sitemap>
  const matches = xml.match(/<sitemap\b[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi) || [];
  return matches
    .map((m) => (m.match(/<loc>([\s\S]*?)<\/loc>/) || [])[1])
    .filter(Boolean)
    .map((s) => s.trim());
}

async function readSitemap(url, depth = 0) {
  let res;
  try {
    res = await fetchText(url);
  } catch {
    return { count: 0, found: false };
  }

  const direct = countUrls(res.text);
  if (direct > 0 || depth >= MAX_SITEMAP_DEPTH) {
    return { count: direct, found: true };
  }

  // Sitemap-index — följ children (max 50 children för att undvika exploder)
  const children = extractChildSitemaps(res.text).slice(0, 50);
  let total = 0;
  for (const child of children) {
    const sub = await readSitemap(child, depth + 1);
    total += sub.count;
  }
  return { count: total, found: children.length > 0 };
}

// ── Per-lead workflow ────────────────────────────────────────

async function checkSite(website) {
  const origin = originOf(website);
  if (!origin) return null;

  let robotsHasSitemap = false;
  let robotsDisallowsRoot = false;
  const candidates = [];

  // 1. Robots.txt
  try {
    const r = await fetchText(`${origin}/robots.txt`);
    const parsed = parseRobots(r.text);
    robotsDisallowsRoot = parsed.disallowsRoot;
    if (parsed.sitemapUrls.length > 0) {
      robotsHasSitemap = true;
      candidates.push(...parsed.sitemapUrls);
    }
  } catch {
    /* no robots.txt */
  }

  // 2. Vanliga default-paths
  candidates.push(
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`
  );

  // 3. Försök tills någon ger > 0 sidor
  for (const url of [...new Set(candidates)]) {
    const sm = await readSitemap(url);
    if (sm.found && sm.count > 0) {
      return {
        sitemapUrl: url,
        urlCount: sm.count,
        robotsHasSitemap,
        robotsDisallowsRoot,
      };
    }
  }

  return {
    sitemapUrl: null,
    urlCount: 0,
    robotsHasSitemap,
    robotsDisallowsRoot,
  };
}

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { branch: null, limit: 200, recheck: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === "--recheck") opts.recheck = true;
  }
  return opts;
}

async function pool(items, limit, worker) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  ensureSitemapColumns();
  const opts = parseArgs();
  const leads = getLeadsToCheck(opts);

  console.log("🗺  Sitemap + robots.txt scan");
  console.log(`   Att checka:   ${leads.length} sajter`);
  console.log(`   Parallellt:   ${CONCURRENCY}`);
  console.log();

  let withSitemap = 0;
  let withoutSitemap = 0;
  let disallowedRoot = 0;
  let totalUrls = 0;
  let done = 0;

  await pool(leads, CONCURRENCY, async (lead) => {
    const result = await checkSite(lead.website);
    done++;
    if (result) {
      saveResult(lead.place_id, result);
      if (result.urlCount > 0) {
        withSitemap++;
        totalUrls += result.urlCount;
      } else {
        withoutSitemap++;
      }
      if (result.robotsDisallowsRoot) disallowedRoot++;
    }
    if (done % 20 === 0 || done === leads.length) {
      process.stdout.write(`\r  ${done}/${leads.length} klara   `);
    }
  });

  console.log("\n");
  console.log(`✅ Klart!`);
  console.log(`   Med sitemap (>0 URLs):   ${withSitemap}`);
  console.log(`   Utan/tom sitemap:        ${withoutSitemap}`);
  if (withSitemap > 0) {
    console.log(`   Snitt URL:er per sajt:   ${Math.round(totalUrls / withSitemap)}`);
  }
  if (disallowedRoot > 0) {
    console.log(`   ⚠️  robots.txt blockar roten: ${disallowedRoot}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
