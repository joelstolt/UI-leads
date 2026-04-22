/**
 * enrich-tech.js — Detekterar tech-stack på leadens hemsida
 *
 * Plattform = säljvinkel:
 *   wix/squarespace      → "Plattformen håller er tillbaka — låst, dyr, dålig SEO"
 *   webflow              → "Bra design men dyr drift — vi bygger likvärdigt på WP"
 *   wordpress            → "Optimerbar — vi gör det utan migration"
 *   shopify              → "E-handel-pitch annorlunda än ren web/SEO"
 *   nextjs/react custom  → "Hög teknisk nivå — pitcha SEO/Ads, inte rebuild"
 *   unknown/plain        → "Antagligen handhackad sajt — full rebuild-möjlighet"
 *
 * Dessutom: HTTPS, schema.org-närvaro, viewport-meta — alla fria SEO/UX-signaler.
 *
 * Användning:
 *   node enrich-tech.js                 → alla bolag med hemsida som inte är checkade
 *   node enrich-tech.js --branch snickare
 *   node enrich-tech.js --limit 200
 *   node enrich-tech.js --recheck
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");

const CONCURRENCY = 10;
const TIMEOUT_MS = 8000;

// ── DB-helpers ────────────────────────────────────────────────

function ensureTechColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  const adds = [
    ["tech_stack", "TEXT"], // wix|squarespace|wordpress|webflow|shopify|nextjs|react|custom|unknown
    ["tech_https", "INTEGER"], // 1 = https, 0 = http only
    ["tech_has_schema", "INTEGER"], // 1 = schema.org markup, 0 = ej
    ["tech_has_viewport", "INTEGER"],
    ["tech_checked_at", "TEXT"],
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
  if (!opts.recheck) conditions.push("tech_checked_at IS NULL");
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

function saveResult(placeId, result) {
  // Bevarar null som null (= okänt/ej kunde testa). 1/0 = ja/nej. Tidigare
  // forced cast `result.https ? 1 : 0` gjorde att null sparades som 0
  // vilket är samma sak som "ja, vi testade och det saknas".
  const bool = (v) => (v == null ? null : v ? 1 : 0);
  getDb()
    .prepare(
      `UPDATE companies
       SET tech_stack         = ?,
           tech_https         = ?,
           tech_has_schema    = ?,
           tech_has_viewport  = ?,
           tech_checked_at    = datetime('now'),
           updated_at         = datetime('now')
       WHERE place_id = ?`
    )
    .run(result.stack, bool(result.https), bool(result.hasSchema), bool(result.hasViewport), placeId);
}

// ── Detection ─────────────────────────────────────────────────

function detectStack(html, headers, finalUrl) {
  const h = html.toLowerCase();
  const generator = (html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)/i) || [])[1] || "";
  const gen = generator.toLowerCase();
  const xPoweredBy = (headers.get("x-powered-by") || "").toLowerCase();
  const server = (headers.get("server") || "").toLowerCase();

  // Wix
  if (gen.includes("wix") || h.includes("wixstatic.com") || h.includes("static.wixstatic")) return "wix";

  // Squarespace
  if (gen.includes("squarespace") || h.includes("static1.squarespace.com") || h.includes("squarespace-cdn.com"))
    return "squarespace";

  // Shopify
  if (h.includes("cdn.shopify.com") || h.includes("shopify-section-") || h.includes("/shopifycloud/")) return "shopify";

  // Webflow
  if (gen.includes("webflow") || h.includes('data-wf-page="') || h.includes("assets.website-files.com")) return "webflow";

  // Wordpress
  if (
    gen.includes("wordpress") ||
    h.includes("/wp-content/") ||
    h.includes("/wp-includes/") ||
    h.includes("/wp-json/")
  )
    return "wordpress";

  // Joomla / Drupal (mindre vanliga men finns)
  if (gen.includes("joomla")) return "joomla";
  if (gen.includes("drupal") || h.includes("drupal-settings-json")) return "drupal";

  // Next.js
  if (h.includes("__next_data__") || h.includes("/_next/static/")) return "nextjs";

  // React (utan Next)
  if (h.includes('id="__next"') || h.includes('id="root"') && h.includes("react")) return "react";

  // Server hints
  if (xPoweredBy.includes("php")) return "php-custom";
  if (xPoweredBy.includes("asp.net")) return "aspnet";

  // Plain HTML — väldigt få script-taggar
  const scriptCount = (html.match(/<script/gi) || []).length;
  if (scriptCount <= 3) return "plain-html";

  return "custom";
}

async function checkSite(url) {
  const target = url.startsWith("http") ? url : `https://${url}`;

  try {
    const res = await fetch(target, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadScraper/2.0; +https://stoltmarketing.se)",
      },
    });

    if (!res.ok) return { error: `HTTP ${res.status}` };

    const html = await res.text();
    const finalUrl = res.url;

    return {
      stack: detectStack(html, res.headers, finalUrl),
      https: finalUrl.startsWith("https://"),
      hasSchema:
        /<script[^>]*type=["']application\/ld\+json["']/i.test(html) ||
        /itemscope[\s>]/i.test(html),
      hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    };
  } catch (err) {
    return { error: err.message };
  }
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

// Mini parallell-pool utan p-limit dependency (vi har det redan men kort)
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
  ensureTechColumns();
  const opts = parseArgs();
  const leads = getLeadsToCheck(opts);

  console.log("🛠  Tech-stack detection");
  console.log(`   Att checka:   ${leads.length} sajter`);
  console.log(`   Parallellt:   ${CONCURRENCY}`);
  console.log();

  const counts = {};
  let errors = 0;
  let done = 0;

  await pool(leads, CONCURRENCY, async (lead) => {
    const result = await checkSite(lead.website);
    done++;
    if (result.error) {
      errors++;
      // Behåll stack = "error" som signal "sajten är nere" (säljvinkel),
      // men sätt övriga checks till null — vi VET inte om de har HTTPS,
      // schema eller viewport eftersom vi inte kunde ladda sajten.
      // Förra implementationen sparade 0 (false) vilket gjorde att
      // audit-sidan flaggade "saknar HTTPS" på sajter som var nere.
      saveResult(lead.place_id, {
        stack: "error",
        https: null,
        hasSchema: null,
        hasViewport: null,
      });
    } else {
      counts[result.stack] = (counts[result.stack] || 0) + 1;
      saveResult(lead.place_id, result);
    }
    if (done % 20 === 0 || done === leads.length) {
      process.stdout.write(`\r  ${done}/${leads.length} klara (${errors} fel)   `);
    }
  });

  console.log("\n\n📊 Plattformsfördelning:");
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [stack, n] of sorted) {
    const pct = Math.round((n / leads.length) * 100);
    const icon =
      stack === "wix" || stack === "squarespace"
        ? "🟧"
        : stack === "wordpress"
          ? "🟦"
          : stack === "webflow" || stack === "nextjs" || stack === "react"
            ? "🟩"
            : stack === "shopify"
              ? "🟪"
              : "⬜";
    console.log(`   ${icon} ${stack.padEnd(15)} ${String(n).padStart(4)} (${pct}%)`);
  }
  if (errors) console.log(`   ✗ Fel             ${String(errors).padStart(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
