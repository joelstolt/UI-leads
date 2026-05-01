/**
 * enrich-csv-pagespeed.js — Kör PageSpeed + priority på bolag som listas i en CSV.
 * Användning: node enrich-csv-pagespeed.js <csv-path> [--brand <key>] [--branch <name>]
 * CSV förväntas ha: Bransch,Stad,Företag,Telefon,Hemsida,Adress,Betyg,Recensioner
 */

require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const csvPath = args[0];
if (!csvPath) {
  console.error("Usage: node enrich-csv-pagespeed.js <csv-path> [--brand wlm-ie] [--branch Hairdressers]");
  process.exit(1);
}
const brand = args[args.indexOf("--brand") + 1] || null;
const branch = args[args.indexOf("--branch") + 1] || null;

const PSI_KEY = process.env.PAGESPEED_API_KEY || "";
const DB_PATH = path.resolve(__dirname, "leads.db");

// Läs CSV och extrahera (namn, stad)
function parseCsvRow(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = fs.readFileSync(csvPath, "utf8").split("\n").slice(1).filter(Boolean);
const csvEntries = lines
  .map((l) => {
    const c = parseCsvRow(l);
    return { city: (c[1] || "").trim(), name: (c[2] || "").replace(/^"|"$/g, "").trim() };
  })
  .filter((e) => e.name);

console.log(`CSV: ${csvEntries.length} rader`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const where = ["name = ?", "city = ?", "website IS NOT NULL", "website != ''", "pagespeed_at IS NULL"];
const params0 = [];
if (brand) { where.push("brand = ?"); params0.push(brand); }
if (branch) { where.push("branch = ?"); params0.push(branch); }

const lookup = db.prepare(`SELECT place_id, name, city, website, rating, reviews FROM companies WHERE ${where.join(" AND ")}`);

// Matcha CSV → DB
const matches = [];
for (const e of csvEntries) {
  const rows = lookup.all(e.name, e.city, ...params0);
  for (const r of rows) matches.push(r);
}
// Dedupe på place_id
const byId = new Map();
for (const r of matches) byId.set(r.place_id, r);
const leads = [...byId.values()];

console.log(`DB-matches med hemsida och utan pagespeed: ${leads.length}`);
if (leads.length === 0) {
  console.log("Inget att göra.");
  process.exit(0);
}

// ── PageSpeed ─────────────────────────────────────────────
async function analyzePagespeed(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  apiUrl.searchParams.set("url", cleanUrl);
  apiUrl.searchParams.set("strategy", "mobile");
  apiUrl.searchParams.append("category", "performance");
  apiUrl.searchParams.append("category", "seo");
  apiUrl.searchParams.append("category", "accessibility");
  if (PSI_KEY) apiUrl.searchParams.set("key", PSI_KEY);

  const data = await pRetry(
    async () => {
      const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(40000) });
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

function calculatePriority(ps, c) {
  let pts = 0;
  if (ps.seo <= 50) pts += 4;
  else if (ps.seo <= 70) pts += 2;
  else if (ps.seo <= 80) pts += 1;
  if (ps.performance <= 40) pts += 3;
  else if (ps.performance <= 60) pts += 2;
  else if (ps.performance <= 75) pts += 1;
  if (ps.mobile_friendly === "Nej") pts += 2;
  const rating = parseFloat(c.rating) || 0;
  if (rating >= 4.5) pts += 2;
  else if (rating >= 4.0) pts += 1;
  const reviews = parseInt(c.reviews) || 0;
  if (reviews >= 50) pts += 2;
  else if (reviews >= 20) pts += 1;
  if (pts >= 8) return "🔥 A+";
  if (pts >= 5) return "🟡 A";
  if (pts >= 3) return "🔵 B";
  return "⚪ C";
}

const update = db.prepare(`
  UPDATE companies
  SET performance=?, seo=?, accessibility=?, mobile_friendly=?, load_time=?, priority=?,
      pagespeed_at=datetime('now'), updated_at=datetime('now')
  WHERE place_id=?
`);

(async () => {
  const pool = pLimit(3);
  let done = 0, errors = 0;
  const counts = { "🔥 A+": 0, "🟡 A": 0, "🔵 B": 0, "⚪ C": 0 };

  await Promise.all(
    leads.map((c) =>
      pool(async () => {
        try {
          const ps = await analyzePagespeed(c.website);
          const prio = calculatePriority(ps, c);
          update.run(ps.performance, ps.seo, ps.accessibility, ps.mobile_friendly, ps.load_time, prio, c.place_id);
          counts[prio] = (counts[prio] || 0) + 1;
        } catch (e) {
          errors++;
          update.run(null, null, null, null, null, null, c.place_id);
        }
        done++;
        if (done % 10 === 0 || done === leads.length) {
          process.stdout.write(`\r  ${done}/${leads.length} (${errors} fel)   `);
        }
        await new Promise((r) => setTimeout(r, PSI_KEY ? 350 : 1200));
      })
    )
  );

  console.log(`\nKlart. Prioritetsfördelning:`);
  for (const [p, n] of Object.entries(counts)) if (n > 0) console.log(`  ${p}: ${n}`);
  if (errors > 0) console.log(`  ⚠️  Fel: ${errors}`);
})();
