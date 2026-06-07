#!/usr/bin/env node
/**
 * enrich-ehandel-website.js — hitta hemsida för svenska e-handlare som
 * har branch="E-handel" men saknar website.
 *
 * Approach (samma som enrich-se-website.js, men utan telefon-krav):
 *   1. Slug-gissning: testa www.{slug}.{se|com|nu|eu} för olika slug-varianter
 *   2. DuckDuckGo HTML search om gissning miss
 *   3. Innehållsvalidering (företagsnamn måste finnas på sajten)
 *
 * Default = bara EAA-omfattade bolag (>10 anst ELLER >22M SEK omsättning).
 *
 * Användning:
 *   node enrich-ehandel-website.js                 → alla EAA-omfattade utan hemsida
 *   node enrich-ehandel-website.js --all           → även mindre bolag
 *   node enrich-ehandel-website.js --skip-ddg      → bara domän-gissning
 *   node enrich-ehandel-website.js --concurrency 30 → snabbare
 *   node enrich-ehandel-website.js --limit 100     → testa på en delmängd
 */

const { getDb } = require("./db");
const pLimit = require("p-limit");

const BRANCH = "E-handel";
const TLDS = [".se", ".com", ".nu", ".eu"];
const DDG_URL = "https://html.duckduckgo.com/html/?q=";

const DIRECTORY_HOSTS = new Set([
  "allabolag.se", "proff.se", "bolagsverket.se", "hitta.se", "eniro.se",
  "ratsit.se", "merinfo.se", "upplysning.se", "creditsafe.se", "creditsafe.com",
  "kompass.com", "kompass.se", "facebook.com", "linkedin.com", "twitter.com",
  "instagram.com", "youtube.com", "wikipedia.org", "duckduckgo.com",
  "google.com", "bing.com", "prisjakt.nu", "pricerunner.se",
]);

const BAD_FINAL_HOSTS = new Set([
  "aftonbladet.se", "expressen.se", "svd.se", "dn.se", "di.se", "svt.se",
  "sedo.com", "godaddy.com", "namecheap.com", "hugedomains.com", "dan.com",
  "domainmarket.com", "afternic.com",
]);

// Generiska ord vi aldrig vill ha som ENDA slug
const GENERIC_BLOCKLIST = new Set([
  "ab", "sverige", "svensk", "swedish", "group", "international", "global",
  "company", "team", "tech", "web", "service", "services", "solutions",
  "agency", "online", "shop", "store", "butik", "handel", "fashion",
  "consulting", "konsult",
]);

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Slug-generering ───────────────────────────────────────────

function slugCandidates(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(ab|aktiebolag|hb|handelsbolag|kb|the|och|of)\b/gi, "")
    .replace(/[^a-zåäö0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const asciify = (s) =>
    s.replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");

  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const candidates = new Set();

  // Hela namnet ihop ("apoteksverige")
  const joined = asciify(tokens.join(""));
  if (joined.length >= 5 && joined.length <= 35) candidates.add(joined);

  // Bara första ordet ("apotea", "hm", "boozt")
  const first = asciify(tokens[0]);
  if (first.length >= 3 && first.length <= 25 && !GENERIC_BLOCKLIST.has(first)) {
    candidates.add(first);
  }

  // Första 2 ord ihop ("apoteksverige", "clas ohlson" → "clasohlson")
  if (tokens.length >= 2) {
    const two = asciify(tokens[0] + tokens[1]);
    if (two.length >= 5 && two.length <= 35 && !GENERIC_BLOCKLIST.has(two)) {
      candidates.add(two);
    }
  }

  // Med bindestreck ("clas-ohlson")
  if (tokens.length >= 2 && tokens.length <= 4) {
    const dashed = asciify(tokens.join("-"));
    if (dashed.length >= 6) candidates.add(dashed);
  }

  // Akronym för 3+ ords-namn
  if (tokens.length >= 3) {
    const acronym = asciify(tokens.map((t) => t[0]).join(""));
    if (acronym.length >= 3 && acronym.length <= 5) candidates.add(acronym);
  }

  return [...candidates];
}

// ── URL-validering ────────────────────────────────────────────

function isBadFinalHost(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (BAD_FINAL_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(u.hostname)) return true;
    if (/sedo\.com|godaddy\.com|hugedomains|afternic|parking/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

async function validateUrl(url, companyName) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,*/*",
        "Accept-Language": "sv-SE,sv;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return null;
    const finalUrl = r.url || url;
    if (isBadFinalHost(finalUrl)) return null;
    const html = (await r.text()).toLowerCase();
    if (html.length < 400) return null;
    if (/this domain (is for sale|may be for sale)|buy this domain|domänen är till salu/i.test(html))
      return null;

    // Innehållsmatch: minst ett ord från företagsnamnet måste finnas
    const tokens = companyName
      .toLowerCase()
      .replace(/[^a-zåäö\s]/g, " ")
      .split(/\s+/)
      .filter(
        (t) =>
          t.length >= 4 &&
          !["sverige", "svensk", "aktiebolag", "group"].includes(t)
      );
    if (tokens.length === 0) return finalUrl;
    const matches = tokens.filter((t) => html.includes(t)).length;
    if (matches === 0) return null;
    return finalUrl;
  } catch {
    return null;
  }
}

async function guessDomain(name) {
  const slugs = slugCandidates(name);
  for (const slug of slugs) {
    for (const tld of TLDS) {
      const variants = [`https://www.${slug}${tld}`, `https://${slug}${tld}`];
      for (const url of variants) {
        const validated = await validateUrl(url, name);
        if (validated) return validated;
      }
    }
  }
  return null;
}

// ── DuckDuckGo fallback ───────────────────────────────────────

function decodeDdgRedirect(href) {
  try {
    const m = href.match(/uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return null;
}

async function ddgSearch(name) {
  const query = `${name} e-handel`;
  try {
    const r = await fetch(DDG_URL + encodeURIComponent(query), {
      headers: { "User-Agent": pickUA(), Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const matches = [...html.matchAll(/<a[^>]+class="result__url[^"]*"[^>]+href="([^"]+)"/g)];
    for (const m of matches) {
      const realUrl = decodeDdgRedirect(m[1]);
      if (!realUrl) continue;
      try {
        const host = new URL(realUrl).hostname.replace(/^www\./, "");
        if (DIRECTORY_HOSTS.has(host) || BAD_FINAL_HOSTS.has(host)) continue;
      } catch {
        continue;
      }
      const validated = await validateUrl(realUrl, name);
      if (validated) return validated;
    }
  } catch {}
  return null;
}

// ── DB ────────────────────────────────────────────────────────

function setWebsite(placeId, website) {
  getDb()
    .prepare("UPDATE companies SET website = ?, updated_at = datetime('now') WHERE place_id = ?")
    .run(website, placeId);
}

const EAA_REVENUE_KR = 22_000_000;
const EAA_EMPLOYEES = 10;

function loadTargets(opts) {
  let sql = `SELECT place_id, name, revenue, employees FROM companies
             WHERE branch = ?
               AND (website IS NULL OR website = '')`;
  if (!opts.all) {
    sql += ` AND ((employees IS NOT NULL AND employees >= ${EAA_EMPLOYEES})
                  OR (revenue IS NOT NULL AND revenue >= ${EAA_REVENUE_KR}))`;
  }
  sql += " ORDER BY revenue DESC NULLS LAST, employees DESC NULLS LAST";
  if (opts.limit) sql += ` LIMIT ${opts.limit}`;
  return getDb().prepare(sql).all(BRANCH);
}

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: null, concurrency: 15, skipDdg: false, all: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
    else if (args[i] === "--skip-ddg") opts.skipDdg = true;
    else if (args[i] === "--all") opts.all = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const need = loadTargets(opts);

  console.log("🛒 enrich-ehandel-website — hitta hemsida för svenska e-handlare\n");
  console.log(`   Target:        ${opts.all ? "alla E-handel" : "EAA-omfattade (>10 anst ELLER >22M SEK)"}`);
  console.log(`   Concurrency:   ${opts.concurrency}`);
  console.log(`   DuckDuckGo:    ${opts.skipDdg ? "nej" : "ja (efter domän-gissning)"}`);
  console.log(`   Bolag att enricha: ${need.length.toLocaleString("sv-SE")}\n`);

  if (need.length === 0) {
    console.log("Inget att göra.");
    return;
  }

  const limit = pLimit(opts.concurrency);
  const ddgLimit = pLimit(Math.min(opts.concurrency, 5));
  const found = new Map();

  // Fas 1: domän-gissning
  console.log("🎯 Fas 1/2: Domän-gissning");
  let hits1 = 0, done1 = 0;
  await Promise.all(
    need.map((c) =>
      limit(async () => {
        const url = await guessDomain(c.name);
        if (url) {
          found.set(c.place_id, url);
          setWebsite(c.place_id, url);
          hits1++;
        }
        done1++;
        if (done1 % 25 === 0 || done1 === need.length) {
          const pct = Math.round((done1 / need.length) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${done1}/${need.length} — ${hits1} hittade   `
          );
        }
      })
    )
  );
  console.log(`\n   ✅ ${hits1.toLocaleString("sv-SE")} hemsidor via domän-gissning\n`);

  // Fas 2: DuckDuckGo
  if (!opts.skipDdg) {
    const remaining = need.filter((c) => !found.has(c.place_id));
    console.log(`🦆 Fas 2/2: DuckDuckGo för ${remaining.length.toLocaleString("sv-SE")} kvarvarande`);
    let hits2 = 0, done2 = 0;
    await Promise.all(
      remaining.map((c) =>
        ddgLimit(async () => {
          const url = await ddgSearch(c.name);
          if (url) {
            found.set(c.place_id, url);
            setWebsite(c.place_id, url);
            hits2++;
          }
          done2++;
          if (done2 % 20 === 0 || done2 === remaining.length) {
            const pct = Math.round((done2 / remaining.length) * 100);
            process.stdout.write(
              `\r   [${String(pct).padStart(3)}%] ${done2}/${remaining.length} — ${hits2} hittade   `
            );
          }
          await sleep(400 + Math.random() * 400);
        })
      )
    );
    console.log(`\n   ✅ ${hits2.toLocaleString("sv-SE")} ytterligare hemsidor via DDG\n`);
  }

  const total = found.size;
  const rate = Math.round((total / need.length) * 100);
  console.log(`🏁 Totalt: ${total.toLocaleString("sv-SE")}/${need.length.toLocaleString("sv-SE")} (${rate}%) hemsidor hittade`);
  console.log("\nKör export igen för uppdaterad CSV:");
  console.log("   node export-ehandel.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
