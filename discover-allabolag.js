/**
 * discover-allabolag.js — Discovery via allabolag.se (gratis, SerpAPI-killer)
 *
 * Istället för Google Maps via SerpAPI ($0.01/anrop), listar vi alla bolag i
 * en (bransch, ort)-kombination från allabolag.se. Får direkt: namn, orgnr,
 * telefon, hemsida, omsättning, anställda, SNI-kod, adress. INGEN Maps behövs.
 *
 * Ger 5-10x fler bolag per (bransch, ort) jämfört med Maps, och är gratis.
 *
 * Användning:
 *   node discover-allabolag.js                            → alla branscher × alla 290 SE-städer (kör i timmar)
 *   node discover-allabolag.js --branch snickare          → en bransch
 *   node discover-allabolag.js --city Stockholm           → en stad
 *   node discover-allabolag.js --branch snickare --city Stockholm
 *   node discover-allabolag.js --max-pages 3              → max 3 sidor (75 bolag) per kombination
 *   node discover-allabolag.js --dry-run                  → visa jobbet utan att köra
 *
 * Dedup: matchar mot existerande companies via orgnr eller (lower(name), lower(city)).
 *        Existerande bolag uppdateras med corp-data om saknas, nya skapas.
 */

require("dotenv").config({ override: true });
const regions = require("./regions.json");
const { getDb, ensureBrandColumn, setBrand, setSlugIfMissing } = require("./db");

// Brand-mapping: SE/NO/DK → wlm-se, GB/IE → wlm-ie
function brandForCountry(cc) {
  if (cc === "GB" || cc === "IE") return "wlm-ie";
  return "wlm-se";
}

const BASE = "https://www.allabolag.se/api/search";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "sv-SE,sv;q=0.9",
};

const DELAY_MS = 800; // rate-limit, snäll mot allabolag
const TIMEOUT_MS = 15000;
const MAX_PAGES_DEFAULT = 5; // 25 bolag/sida → 125 bolag per (bransch, stad)

// ── DB-helpers ────────────────────────────────────────────────

function findExisting(name, city, orgnr) {
  const db = getDb();
  if (orgnr) {
    const row = db.prepare("SELECT place_id FROM companies WHERE org_nr = ?").get(orgnr);
    if (row) return row.place_id;
  }
  const row = db
    .prepare(
      "SELECT place_id FROM companies WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)"
    )
    .get(name, city);
  return row?.place_id ?? null;
}

function formatOrgNr(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw;
}

function normalizeWebsite(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function mapRevenue(c) {
  // allabolag returnerar revenue i tkr (tusen SEK) → konvertera till kr
  if (c.revenue == null) return null;
  const n = parseFloat(String(c.revenue).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 1000);
}

function pickIndustry(c) {
  const code = c.currentIndustry?.code || c.industries?.[0]?.code || null;
  const name = c.currentIndustry?.name || c.industries?.[0]?.name || null;
  return code ? `${code} ${name || ""}`.trim() : null;
}

function upsert(branch, city, c, brandKey) {
  const orgnr = formatOrgNr(c.orgnr);
  const name = c.name || "";
  if (!name) return { isNew: false, updated: false };

  // Använd visitorAddress city om vi har det, annars input city
  const apiCity = c.location?.municipality || city;
  const phone = c.phone || c.mobile || null;
  const website = normalizeWebsite(c.homePage);
  const email = c.email || null;
  const address = [c.visitorAddress?.addressLine, c.visitorAddress?.zipCode, c.visitorAddress?.postPlace]
    .filter(Boolean)
    .join(" ");
  const revenue = mapRevenue(c);
  const employees = c.employees ? parseInt(c.employees) || null : null;
  const sni = pickIndustry(c);

  const existing = findExisting(name, apiCity, orgnr);
  const db = getDb();
  const now = new Date().toISOString();

  if (existing) {
    // Uppdatera bara fält som saknas + corp-data
    db.prepare(
      `UPDATE companies SET
        phone = COALESCE(NULLIF(phone, ''), ?),
        website = COALESCE(NULLIF(website, ''), ?),
        email = COALESCE(NULLIF(email, ''), ?),
        address = COALESCE(NULLIF(address, ''), ?),
        org_nr = COALESCE(org_nr, ?),
        revenue = COALESCE(revenue, ?),
        employees = COALESCE(employees, ?),
        sni_code = COALESCE(sni_code, ?),
        corp_enriched_at = COALESCE(corp_enriched_at, datetime('now')),
        updated_at = datetime('now')
       WHERE place_id = ?`
    ).run(phone, website, email, address || null, orgnr, revenue, employees, sni, existing);
    return { isNew: false, updated: true };
  }

  const placeId = orgnr
    ? `allabolag_${orgnr.replace(/-/g, "")}`
    : `allabolag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    `INSERT INTO companies
      (place_id, name, branch, city, phone, website, email, address,
       org_nr, revenue, employees, sni_code,
       scraped_at, corp_enriched_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(placeId, name, branch, apiCity, phone, website, email, address || null,
        orgnr, revenue, employees, sni, now, now);
  // Brand: använd CLI-arg om satt, annars default wlm-se (allabolag = svenska bolag)
  setBrand(placeId, brandKey || "wlm-se");
  setSlugIfMissing(placeId, name);
  return { isNew: true, updated: false };
}

// ── API ───────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(industryTerm, city, page) {
  const params = new URLSearchParams({
    industry: industryTerm,
    filter: `municipality:${city}`,
    page: String(page),
  });
  const url = `${BASE}?${params}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function discoverOne(branchName, industryTerm, city, maxPages, dryRun, brandKey) {
  let page = 1;
  let totalNew = 0;
  let totalUpdated = 0;
  let totalHits = 0;
  let totalPages = 0;

  while (page <= maxPages) {
    let data;
    try {
      data = await fetchPage(industryTerm, city, page);
    } catch (err) {
      console.warn(`  ⚠️  ${branchName}/${city} sida ${page}: ${err.message}`);
      break;
    }

    if (page === 1) {
      totalHits = data.hits ?? 0;
      totalPages = data.pages ?? 0;
      if (totalHits === 0) return { branch: branchName, city, hits: 0, new: 0, updated: 0 };
    }

    const companies = data.companies || [];
    if (companies.length === 0) break;

    if (!dryRun) {
      for (const c of companies) {
        const r = upsert(branchName, city, c, brandKey);
        if (r.isNew) totalNew++;
        else if (r.updated) totalUpdated++;
      }
    }

    if (page >= totalPages) break;
    page++;
    await sleep(DELAY_MS);
  }

  return { branch: branchName, city, hits: totalHits, new: totalNew, updated: totalUpdated };
}

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    branch: null,
    city: null,
    maxPages: MAX_PAGES_DEFAULT,
    dryRun: false,
    brand: null, // override default-brand som annars sätts via brandForCountry
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    if (args[i] === "--city" && args[i + 1]) opts.city = args[++i];
    if (args[i] === "--max-pages" && args[i + 1]) opts.maxPages = parseInt(args[++i]);
    if (args[i] === "--dry-run") opts.dryRun = true;
    if (args[i] === "--brand" && args[i + 1]) opts.brand = args[++i];
  }
  return opts;
}

function resolveBranches(filter) {
  // Bara SE-branscher (allabolag är svenska)
  const all = regions.branchesByCountry.SE;
  if (!filter) return all;
  const m = all.find((b) => b.name.toLowerCase().includes(filter.toLowerCase()));
  if (!m) {
    console.error(`❌ Okänd bransch: "${filter}". Tillgängliga: ${all.map((b) => b.name).join(", ")}`);
    process.exit(1);
  }
  return [m];
}

function resolveCities(filter) {
  const all = regions.citiesByCountry.SE;
  if (!filter) return all;
  return [filter];
}

async function main() {
  ensureBrandColumn();
  const opts = parseArgs();
  const branches = resolveBranches(opts.branch);
  const cities = resolveCities(opts.city);

  // För varje bransch: använd första query-termen som industry-sökterm
  // (allabolag matchar fritext mot industri-namn, så "snickare" → snickare-bolag)
  const jobs = [];
  for (const b of branches) {
    const term = b.queries[0];
    for (const c of cities) {
      jobs.push({ branchName: b.name, term, city: c });
    }
  }

  console.log("🔎 allabolag.se discovery");
  console.log(`   Branscher: ${branches.map((b) => b.name).join(", ")}`);
  console.log(`   Städer:    ${cities.length}`);
  console.log(`   Jobb:      ${jobs.length}`);
  console.log(`   Max sidor: ${opts.maxPages} (≤ ${opts.maxPages * 25} bolag/jobb)`);
  console.log(`   Hastighet: ~${Math.round(60000 / DELAY_MS)} req/min`);
  if (opts.dryRun) console.log(`   [DRY-RUN] Ingen DB-write.`);
  console.log();

  let totalNew = 0;
  let totalUpdated = 0;
  let totalHits = 0;
  let i = 0;

  if (opts.brand) console.log(`   Brand:     ${opts.brand}`);

  for (const job of jobs) {
    i++;
    process.stdout.write(`  [${i}/${jobs.length}] ${job.branchName.padEnd(20)} ${job.city.padEnd(20)} `);
    const r = await discoverOne(job.branchName, job.term, job.city, opts.maxPages, opts.dryRun, opts.brand);
    totalNew += r.new;
    totalUpdated += r.updated;
    totalHits += r.hits;
    process.stdout.write(`${r.hits.toString().padStart(5)} träffar · ${r.new.toString().padStart(4)} nya · ${r.updated} uppd\n`);
  }

  console.log();
  console.log("✅ Klart!");
  console.log(`   Träffar totalt: ${totalHits.toLocaleString("sv-SE")}`);
  console.log(`   Nya bolag:      ${totalNew.toLocaleString("sv-SE")}`);
  console.log(`   Uppdaterade:    ${totalUpdated.toLocaleString("sv-SE")}`);
  console.log(`   Sparade SerpAPI-anrop: ~${totalNew} (≈ $${(totalNew * 0.01).toFixed(2)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
