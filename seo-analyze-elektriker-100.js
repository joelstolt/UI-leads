#!/usr/bin/env node
/**
 * seo-analyze-elektriker-100.js
 *
 * Kör PageSpeed Insights (mobile) på topp 100 elektriker (samma filter
 * som CSV-exporten) och beräknar ett SEO-säljbarhets-score.
 *
 * Skriver tillbaka performance/seo/accessibility/mobile/load_time till DB,
 * och sparar uppdaterad CSV med scores till skrivbordet.
 *
 * Usage: node seo-analyze-elektriker-100.js
 */

require("dotenv").config({ override: true });
const fs = require("node:fs");
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const { getDb } = require("./db");

const PSI_KEY = process.env.PAGESPEED_API_KEY || "";
const CONCURRENCY = 3;
const OUT_CSV = "/Users/joelstolt/Desktop/elektriker-storre-100.csv";

if (!PSI_KEY) {
  console.error("PAGESPEED_API_KEY saknas i .env");
  process.exit(1);
}

async function analyzePagespeed(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http")
    ? websiteUrl
    : `https://${websiteUrl}`;
  const apiUrl = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
  );
  apiUrl.searchParams.set("url", cleanUrl);
  apiUrl.searchParams.set("strategy", "mobile");
  apiUrl.searchParams.append("category", "performance");
  apiUrl.searchParams.append("category", "seo");
  apiUrl.searchParams.append("category", "accessibility");
  apiUrl.searchParams.set("key", PSI_KEY);

  const data = await pRetry(
    async () => {
      const res = await fetch(apiUrl.toString(), {
        signal: AbortSignal.timeout(45000),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json;
    },
    { retries: 2, minTimeout: 3000 }
  );

  const cats = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};
  const viewportScore = audits["viewport"]?.score ?? 0;
  const tapScore = audits["tap-targets"]?.score ?? 1;
  const fontSizeScore = audits["font-size"]?.score ?? 1;
  const mobileFriendly =
    viewportScore === 1 && tapScore >= 0.8 && fontSizeScore >= 0.8 ? "Ja" : "Nej";

  return {
    performance: Math.round((cats.performance?.score || 0) * 100),
    seo: Math.round((cats.seo?.score || 0) * 100),
    accessibility: Math.round((cats.accessibility?.score || 0) * 100),
    mobile_friendly: mobileFriendly,
    load_time: audits["speed-index"]?.displayValue || "?",
  };
}

function calcSalesScore(ps) {
  // Högre = mer säljbar (mer att förbättra). 0-100.
  if (!ps || ps.performance === null) return null;
  let score = 0;
  score += (100 - ps.performance) * 0.45;
  score += (100 - ps.seo) * 0.30;
  score += (100 - ps.accessibility) * 0.15;
  if (ps.mobile_friendly === "Nej") score += 10;
  return Math.round(score);
}

function bucket(salesScore) {
  if (salesScore === null) return "?";
  if (salesScore >= 55) return "HET";
  if (salesScore >= 40) return "Bra";
  if (salesScore >= 25) return "OK";
  return "Hoppa";
}

async function main() {
  const db = getDb();

  const leads = db
    .prepare(
      `SELECT place_id, name, city, phone, website, email,
              rating, reviews, revenue, employees, org_nr, address, firmatecknare
       FROM companies
       WHERE branch = 'Elektriker'
         AND website IS NOT NULL AND website != ''
         AND (is_chain IS NULL OR is_chain = 0)
         AND revenue BETWEEN 5000000 AND 50000000
         AND employees >= 7
       ORDER BY (COALESCE(rating,0) * COALESCE(reviews,0)) DESC
       LIMIT 100`
    )
    .all();

  console.log(`\nKör PageSpeed på ${leads.length} elektriker...\n`);

  const update = db.prepare(`
    UPDATE companies
    SET performance=?, seo=?, accessibility=?, mobile_friendly=?, load_time=?,
        pagespeed_at=datetime('now'), updated_at=datetime('now')
    WHERE place_id=?
  `);

  const pool = pLimit(CONCURRENCY);
  let done = 0, errors = 0;
  const results = [];

  await Promise.all(
    leads.map((c) =>
      pool(async () => {
        try {
          const ps = await analyzePagespeed(c.website);
          update.run(
            ps.performance,
            ps.seo,
            ps.accessibility,
            ps.mobile_friendly,
            ps.load_time,
            c.place_id
          );
          results.push({ ...c, ...ps });
        } catch (e) {
          errors++;
          results.push({ ...c, performance: null, seo: null, accessibility: null, mobile_friendly: null, load_time: null, error: e.message });
        }
        done++;
        process.stdout.write(`\r  ${done}/${leads.length} (${errors} fel)   `);
        await new Promise((r) => setTimeout(r, 350));
      })
    )
  );

  console.log(`\n\nKlart.`);

  // Beräkna score, sortera (sämst sajt = först)
  for (const r of results) {
    r.sales_score = calcSalesScore(r);
    r.bucket = bucket(r.sales_score);
  }
  results.sort(
    (a, b) => (b.sales_score ?? -1) - (a.sales_score ?? -1)
  );

  const buckets = { HET: 0, Bra: 0, OK: 0, Hoppa: 0, "?": 0 };
  for (const r of results) buckets[r.bucket]++;
  console.log(`\nFörd av säljbarhet:`);
  for (const [k, v] of Object.entries(buckets)) {
    if (v > 0) console.log(`  ${k.padEnd(7)} ${v}`);
  }

  // Spara CSV med scores
  const headers = [
    "name","city","phone","website","email",
    "rating","reviews","revenue","employees",
    "performance","seo","accessibility","mobile_friendly","load_time",
    "sales_score","bucket",
    "org_nr","address","firmatecknare","place_id"
  ];
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }
  const csv = [
    headers.join(","),
    ...results.map(r => headers.map(h => csvCell(r[h])).join(","))
  ].join("\n");
  fs.writeFileSync(OUT_CSV, csv);
  console.log(`\nSparad: ${OUT_CSV}  (${results.length} rader)`);

  // Topp 10 hetaste (sämst sajt = bäst pitch)
  console.log(`\nTopp 10 säljbara (sämst sajt först):\n`);
  for (const r of results.slice(0, 10)) {
    const psStr = r.performance !== null
      ? `perf ${r.performance}, seo ${r.seo}, mob ${r.mobile_friendly}`
      : `ERROR: ${r.error || "?"}`;
    console.log(`  [${r.bucket}] ${r.name} (${r.city})`);
    console.log(`         ${psStr} → score ${r.sales_score ?? "?"}`);
    console.log(`         ${r.website}\n`);
  }

  // De som är "Hoppa" — riktigt bra sajter
  const hoppa = results.filter(r => r.bucket === "Hoppa");
  if (hoppa.length > 0) {
    console.log(`Riktigt bra sajter (säljaren kan hoppa över):\n`);
    for (const r of hoppa) {
      console.log(`  ${r.name} (${r.city}) — perf ${r.performance}, seo ${r.seo}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
