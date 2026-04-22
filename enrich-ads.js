/**
 * enrich-ads.js — Kollar om bolaget kör Meta-annonser nu via Meta Ad Library API
 *
 * En lead som redan kör betald reklam är kvalificerad köpare av digital marknadsföring.
 *
 * Användning:
 *   node enrich-ads.js                       → alla bolag som inte är checkade
 *   node enrich-ads.js --branch snickare
 *   node enrich-ads.js --limit 100
 *   node enrich-ads.js --recheck             → kolla om även de som redan checkats
 *   node enrich-ads.js --countries SE,NO     → vilka länder att söka i (default: SE)
 *
 * Kräver: META_ACCESS_TOKEN i .env
 *   Skaffa här: https://developers.facebook.com/tools/explorer/
 *   App-typ: "Business" → permission "ads_read"
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("❌ Saknar META_ACCESS_TOKEN i .env");
  console.error("   Hämta token via https://developers.facebook.com/tools/explorer/");
  console.error('   Behöver permission "ads_read"');
  process.exit(1);
}

const API = "https://graph.facebook.com/v19.0/ads_archive";
const RATE_DELAY_MS = 600; // ~100 req/min, säker buffert mot Meta-throttling

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── DB-helpers ────────────────────────────────────────────────

function ensureMetaAdsColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  const adds = [
    ["meta_ads_active", "INTEGER"], // 1 = aktiva ads, 0 = inga
    ["meta_ads_count", "INTEGER"],
    ["meta_ads_checked_at", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
    }
  }
}

function getLeadsToCheck(opts) {
  const conditions = [];
  const params = [];
  if (!opts.recheck) conditions.push("meta_ads_checked_at IS NULL");
  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }
  // Krav: namn att söka på
  conditions.push("name IS NOT NULL AND name != ''");
  // Prio på A+/A först
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  return getDb()
    .prepare(
      `SELECT place_id, name, city, branch, priority
       FROM companies ${where}
       ORDER BY
         CASE priority WHEN '🔥 A+' THEN 1 WHEN '🟡 A' THEN 2 WHEN '🔵 B' THEN 3 ELSE 4 END,
         created_at ASC
       LIMIT ?`
    )
    .all(...params, opts.limit);
}

function saveResult(placeId, active, count) {
  getDb()
    .prepare(
      `UPDATE companies
       SET meta_ads_active = ?, meta_ads_count = ?, meta_ads_checked_at = datetime('now'),
           updated_at = datetime('now')
       WHERE place_id = ?`
    )
    .run(active ? 1 : 0, count, placeId);
}

// ── Meta API ──────────────────────────────────────────────────

function cleanCompanyName(name) {
  // Ta bort vanliga suffixar som stör sökningen
  return name
    .replace(/\b(AB|HB|KB|EF|EKF|Aktiebolag|Ltd|Limited|Inc|GmbH)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .trim();
}

async function searchAds(name, countries) {
  const params = new URLSearchParams({
    search_terms: cleanCompanyName(name),
    ad_reached_countries: JSON.stringify(countries),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: "id,ad_delivery_start_time",
    limit: "50",
    access_token: TOKEN,
  });

  const url = `${API}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API: ${json.error.message}`);
  }

  const ads = json.data || [];
  return { active: ads.length > 0, count: ads.length };
}

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    branch: null,
    limit: 100,
    recheck: false,
    countries: ["SE"],
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === "--recheck") opts.recheck = true;
    if (args[i] === "--countries" && args[i + 1])
      opts.countries = args[++i].split(",").map((c) => c.trim().toUpperCase());
  }
  return opts;
}

async function main() {
  ensureMetaAdsColumns();
  const opts = parseArgs();
  const leads = getLeadsToCheck(opts);

  console.log("📣 Meta Ad Library check");
  console.log(`   Länder:       ${opts.countries.join(", ")}`);
  console.log(`   Att checka:   ${leads.length} bolag`);
  console.log(`   Hastighet:    ~${Math.round(60000 / RATE_DELAY_MS)} req/min`);
  console.log();

  let active = 0;
  let inactive = 0;
  let errors = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const tag = `[${i + 1}/${leads.length}] ${lead.name.slice(0, 40).padEnd(40)}`;
    process.stdout.write(`  ${tag} `);

    try {
      const { active: isActive, count } = await searchAds(lead.name, opts.countries);
      saveResult(lead.place_id, isActive, count);
      if (isActive) {
        active++;
        process.stdout.write(`🟢 KÖR ADS (${count})\n`);
      } else {
        inactive++;
        process.stdout.write(`— inga\n`);
      }
    } catch (err) {
      errors++;
      process.stdout.write(`✗ ${err.message}\n`);
    }
    await sleep(RATE_DELAY_MS);
  }

  console.log();
  console.log(`✅ Klart!`);
  console.log(`   🟢 Kör Meta-ads:   ${active}`);
  console.log(`   — Inga ads:        ${inactive}`);
  if (errors) console.log(`   ✗ Fel:             ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
