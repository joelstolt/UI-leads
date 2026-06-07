/**
 * simple-leads-ehandel.js — svenska e-handlare via allabolag.se
 *
 * Skrapar bolag taggade med "Postorder/e-handel" (allabolag industry-kod
 * 10004483, motsvarar SNI 47.91). Sorterat efter omsättning fallande så de
 * största e-handlarna kommer först — de som omfattas av Tillgänglighets-
 * direktivet (EAA, krav fr.o.m. 2025-06-28) ligger i toppen.
 *
 * Pipeline (samma DB som resten):
 *   1. Pulla 400 sidor × 25 bolag = ~10 000 records sorterat på revenueDesc
 *   2. Upsert till companies med branch="E-handel"
 *   3. Sätt brand="wlm-se"
 *
 * Användning:
 *   node simple-leads-ehandel.js                        → alla 400 sidor
 *   node simple-leads-ehandel.js --max-pages 50         → bara topp ~1250
 *   node simple-leads-ehandel.js --min-revenue 22000000 → bara över EAA-tröskel (≈2M EUR)
 *   node simple-leads-ehandel.js --dry-run              → ingen DB-write
 *
 * Efteråt:
 *   node export-ehandel.js                              → CSV på ~/Desktop
 *   node enrich-se-website.js                           → fyll i homepage där den saknas
 *   node enrich-corp.js                                 → komplettera bolagsinfo
 */

require("dotenv").config({ override: true });
const { getDb, ensureBrandColumn, setBrand, setSlugIfMissing } = require("./db");

const BASE = "https://www.allabolag.se/api/search";
const INDUSTRY_TERM = "Postorder/e-handel"; // allabolag-kod 10004483 ≈ SNI 47.91
const SORT = "revenueDesc"; // störst först → EAA-relevanta kommer tidigt
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "sv-SE,sv;q=0.9",
};

const DELAY_MS = 800; // snäll mot allabolag
const TIMEOUT_MS = 15000;
const PAGE_HARD_CAP = 400; // API:t cappar ändå här (≈10 000 records)
const BRANCH = "E-handel";
const BRAND = "wlm-se";

// ── helpers ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatOrgNr(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw;
}

function normalizeWebsite(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function mapRevenueKr(c) {
  // allabolag revenue är i tkr → konvertera till kr
  if (c.revenue == null) return null;
  const n = parseFloat(String(c.revenue).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 1000);
}

function parseEmployees(c) {
  if (c.employees == null) return null;
  const s = String(c.employees).trim();
  if (!s) return null;
  // "4000-4999" → 4000 (lower bound)
  const m = s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function pickPrimaryIndustry(c) {
  const code = c.currentIndustry?.code || c.industries?.[0]?.code || null;
  const name = c.currentIndustry?.name || c.industries?.[0]?.name || null;
  return code ? `${code} ${name || ""}`.trim() : null;
}

function hasEhandelTag(c) {
  // Allabolag-kod 10004483 = Postorder/e-handel
  return (c.industries || []).some(
    (i) => i.code === "10004483" || i.name === "Postorder/e-handel"
  );
}

// ── DB ──────────────────────────────────────────────────────────

function findExisting(name, city, orgnr) {
  const db = getDb();
  if (orgnr) {
    const r = db.prepare("SELECT place_id FROM companies WHERE org_nr = ?").get(orgnr);
    if (r) return r.place_id;
  }
  const r = db
    .prepare(
      "SELECT place_id FROM companies WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)"
    )
    .get(name, city || "");
  return r?.place_id ?? null;
}

function upsert(c) {
  if (!c.name) return { status: "skipped" };

  const orgnr = formatOrgNr(c.orgnr);
  const city = c.location?.municipality || "";
  const phone = c.phone || c.mobile || null;
  const website = normalizeWebsite(c.homePage);
  const email = c.email || null;
  const address = [
    c.visitorAddress?.addressLine,
    c.visitorAddress?.zipCode,
    c.visitorAddress?.postPlace,
  ]
    .filter(Boolean)
    .join(" ");
  const revenue = mapRevenueKr(c);
  const employees = parseEmployees(c);
  const sni = pickPrimaryIndustry(c);

  const db = getDb();
  const existing = findExisting(c.name, city, orgnr);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE companies SET
        branch = COALESCE(NULLIF(branch, ''), ?),
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
    ).run(
      BRANCH,
      phone,
      website,
      email,
      address || null,
      orgnr,
      revenue,
      employees,
      sni,
      existing
    );
    setBrand(existing, BRAND);
    return { status: "updated", placeId: existing };
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
  ).run(
    placeId,
    c.name,
    BRANCH,
    city,
    phone,
    website,
    email,
    address || null,
    orgnr,
    revenue,
    employees,
    sni,
    now,
    now
  );
  setBrand(placeId, BRAND);
  setSlugIfMissing(placeId, c.name);
  return { status: "new", placeId };
}

// ── fetch ───────────────────────────────────────────────────────

async function fetchPage(page) {
  const params = new URLSearchParams({
    industry: INDUSTRY_TERM,
    page: String(page),
    sort: SORT,
  });
  const url = `${BASE}?${params}`;
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── CLI ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxPages: PAGE_HARD_CAP,
    minRevenue: 0, // i kr (22M SEK ≈ 2M EUR är EAA-tröskel)
    minEmployees: 0,
    requireEhandelTag: true, // bara behåll bolag med Postorder/e-handel-tag
    dryRun: false,
    startPage: 1,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-pages" && args[i + 1]) opts.maxPages = parseInt(args[++i]);
    if (args[i] === "--min-revenue" && args[i + 1])
      opts.minRevenue = parseInt(args[++i]);
    if (args[i] === "--min-employees" && args[i + 1])
      opts.minEmployees = parseInt(args[++i]);
    if (args[i] === "--start-page" && args[i + 1])
      opts.startPage = parseInt(args[++i]);
    if (args[i] === "--no-tag-filter") opts.requireEhandelTag = false;
    if (args[i] === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

async function main() {
  ensureBrandColumn();
  const opts = parseArgs();

  console.log("🛒 allabolag.se → svenska e-handlare");
  console.log(`   Industri:        ${INDUSTRY_TERM}`);
  console.log(`   Sortering:       ${SORT} (störst först)`);
  console.log(`   Sidor:           ${opts.startPage}–${opts.maxPages} (≤ ${(opts.maxPages - opts.startPage + 1) * 25} bolag)`);
  if (opts.minRevenue > 0)
    console.log(`   Min oms.:        ${opts.minRevenue.toLocaleString("sv-SE")} kr`);
  if (opts.minEmployees > 0) console.log(`   Min anst.:       ${opts.minEmployees}`);
  console.log(`   Endast e-tag:    ${opts.requireEhandelTag ? "ja" : "nej"}`);
  console.log(`   Branch:          ${BRANCH} / brand ${BRAND}`);
  if (opts.dryRun) console.log("   [DRY-RUN] Ingen DB-write.");
  console.log();

  let totalSeen = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalKept = 0;
  let totalHits = null;
  let lastPages = null;
  const start = Date.now();

  for (let page = opts.startPage; page <= opts.maxPages; page++) {
    let data;
    try {
      data = await fetchPage(page);
    } catch (err) {
      console.warn(`  ⚠️  sida ${page}: ${err.message}`);
      await sleep(2000);
      continue;
    }

    if (totalHits == null) {
      totalHits = data.hits ?? 0;
      lastPages = data.pages ?? 0;
      console.log(`   API meddelar:    ${totalHits.toLocaleString("sv-SE")} totalt, ${lastPages} sidor\n`);
    }

    const companies = data.companies || [];
    if (companies.length === 0) {
      console.log(`  sida ${page}: tom — stannar`);
      break;
    }

    let pageNew = 0;
    let pageUpdated = 0;
    let pageSkipped = 0;
    let pageKept = 0;

    for (const c of companies) {
      totalSeen++;
      if (opts.requireEhandelTag && !hasEhandelTag(c)) {
        pageSkipped++;
        totalSkipped++;
        continue;
      }
      const rev = mapRevenueKr(c);
      const emp = parseEmployees(c);
      // EAA-relevans: anställda ELLER omsättning. Om båda 0/null → behåll men markera.
      if (opts.minRevenue > 0 || opts.minEmployees > 0) {
        const meetsRev = rev != null && rev >= opts.minRevenue;
        const meetsEmp = emp != null && emp >= opts.minEmployees;
        if (!meetsRev && !meetsEmp) {
          pageSkipped++;
          totalSkipped++;
          continue;
        }
      }
      pageKept++;
      totalKept++;
      if (opts.dryRun) continue;

      const r = upsert(c);
      if (r.status === "new") {
        pageNew++;
        totalNew++;
      } else if (r.status === "updated") {
        pageUpdated++;
        totalUpdated++;
      }
    }

    const top = companies[0];
    const topRev = mapRevenueKr(top);
    const topLabel = top ? `${(top.name || "").slice(0, 32)} (${topRev ? Math.round(topRev / 1e6) + "M" : "–"})` : "";

    console.log(
      `  [${String(page).padStart(3)}/${lastPages || "?"}] kept ${String(pageKept).padStart(2)} · new ${String(pageNew).padStart(2)} · upd ${String(pageUpdated).padStart(2)} · skip ${String(pageSkipped).padStart(2)}   top: ${topLabel}`
    );

    if (lastPages && page >= lastPages) break;
    await sleep(DELAY_MS);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log();
  console.log("✅ Klart!");
  console.log(`   Tid:           ${elapsed}s`);
  console.log(`   Setta records: ${totalSeen.toLocaleString("sv-SE")}`);
  console.log(`   Skippade:      ${totalSkipped.toLocaleString("sv-SE")}`);
  console.log(`   Behållna:      ${totalKept.toLocaleString("sv-SE")}`);
  console.log(`   Nya i DB:      ${totalNew.toLocaleString("sv-SE")}`);
  console.log(`   Uppdaterade:   ${totalUpdated.toLocaleString("sv-SE")}`);
  console.log();
  console.log("Nästa steg:");
  console.log("  node enrich-se-website.js          # hitta hemsidor för dem som saknar");
  console.log("  node export-ehandel.js              # CSV med EAA-bucketing");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
