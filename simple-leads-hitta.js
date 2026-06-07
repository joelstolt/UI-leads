#!/usr/bin/env node
/**
 * simple-leads-hitta.js — skrap:r hitta.se för svenska hantverkar-bolag.
 *
 * Hittar bolag som INTE finns på allabolag (typ enskilda firmor, små lokala
 * verksamheter). Plus extra-info som inte finns där: kontaktpersoner med
 * roller (telefonnummer märkta "VD", "byggledare", etc).
 *
 * Pipeline:
 *   1. För varje (kategori, stad)-kombo: iterera sidor på hitta.se
 *   2. Extrahera bolag från Next.js __NEXT_DATA__ JSON
 *   3. DEDUP mot leads.db (skippa de vi redan har via allabolag)
 *   4. Spara nya bolag med branch="SE-Hitta-{kategori}"
 *   5. Spara EXTRA telefonnummer (med roll-labels) i extra_phones-kolumn
 *
 * Användning:
 *   node simple-leads-hitta.js                                  → 5 storstäder × 17 branscher
 *   node simple-leads-hitta.js --branches Snickare,Elektriker
 *   node simple-leads-hitta.js --cities Stockholm,Göteborg,Malmö
 *   node simple-leads-hitta.js --max-pages 5                    → max 5 sidor per kombo
 *   node simple-leads-hitta.js --gentle                         → 8s delay (för säker)
 *   node simple-leads-hitta.js --dry-run                        → testar utan att spara
 */

const { getDb } = require("./db");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

const BASE_URL = "https://www.hitta.se";

// Mapping: vår branch → hitta.se-sökterm
const BRANCH_KEYWORDS = {
  // Hantverk
  Hantverkare: "hantverkare",
  Snickare: "snickare",
  Elektriker: "elektriker",
  Takläggare: "takläggare",
  Målare: "målare",
  VVS: "rörmokare",
  Plåtslagare: "plåtslagare",
  Glasmästare: "glasmästare",
  Markarbeten: "markarbeten",
  Sanering: "saneringsfirma",
  Tapetserare: "tapetserare",
  Smed: "smed",
  "Pool & Spa": "poolfirma",
  "Solskydd & Markiser": "markisfirma",
  Isolering: "isoleringsfirma",
  "Trädgård & Anläggning": "trädgårdsanläggare",
  Fasadrenovering: "fasadrenovering",
  // Restauranger (separata söktermer för bredare täckning)
  Restauranger: "restaurang",
  Pizzerior: "pizzeria",
  Kaféer: "café",
  Bistros: "bistro",
  Sushi: "sushi",
};

// Default-städer (storstäder med flest hantverkar-bolag)
const DEFAULT_CITIES = [
  "Stockholm", "Göteborg", "Malmö", "Uppsala", "Västerås",
  "Örebro", "Linköping", "Helsingborg", "Jönköping", "Norrköping",
];

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

// Rate-limit-konfiguration (mutable)
let DELAY_MS = 3000;
let HOST_REQ_LIMIT = 200;
let HOST_PAUSE_MS = 5 * 60 * 1000;

function applyGentleMode() {
  DELAY_MS = 8000;
  HOST_REQ_LIMIT = 100;
  HOST_PAUSE_MS = 15 * 60 * 1000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (b, s = 0.4) => Math.round(b + (Math.random() * 2 - 1) * s * b);
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

// ════════════════════════════════════════════════════════════════════
// safe-fetch (mot hitta.se — CloudFront WAF risk)
// ════════════════════════════════════════════════════════════════════

let totalReq = 0;
let consecutiveErrors = 0;

async function safeFetch(url) {
  totalReq++;
  if (totalReq > 0 && totalReq % HOST_REQ_LIMIT === 0) {
    const min = Math.round(HOST_PAUSE_MS / 60000);
    process.stdout.write(`\n   🧘 ${HOST_REQ_LIMIT} anrop, pausar ${min} min\n`);
    await sleep(HOST_PAUSE_MS);
  }
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "sv-SE,sv;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
  } catch (e) {
    consecutiveErrors++;
    if (consecutiveErrors >= 5) throw new Error(`5 nätverksfel i rad — avbryter`);
    throw e;
  }

  if (res.status === 202 || res.status === 429 || res.status === 403 || res.status === 503) {
    consecutiveErrors++;
    const min = Math.min(0.5 * Math.pow(2, consecutiveErrors - 1), 10);
    process.stdout.write(`\n   🚧 hitta.se HTTP ${res.status} — backar ${min} min\n`);
    await sleep(min * 60 * 1000);
    if (consecutiveErrors >= 5) throw new Error(`hitta.se blockar oss — avbryter`);
    return safeFetch(url);
  }

  if (res.ok) consecutiveErrors = 0;
  return res;
}

// ════════════════════════════════════════════════════════════════════
// Hämta + parsa hitta.se-sida
// ════════════════════════════════════════════════════════════════════

function buildUrl(kategoriKeyword, stad, page) {
  // hitta.se använder pattern: /{kategori}+{stad}/företag/{sida}
  // Sidor börjar vid 2 (hitta:s eget val)
  const slug = `${kategoriKeyword}+${stad.toLowerCase()}`.replace(/\s+/g, "+");
  return `${BASE_URL}/${encodeURI(slug)}/företag/${page}`;
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractCompanies(nextData) {
  // Sök djupt efter "companies"-array
  function find(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== "object") return null;
    if (Array.isArray(obj.companies) && obj.companies.length > 0) return obj.companies;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "object") {
        const r = find(obj[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
  return find(nextData) || [];
}

function extractTotalHits(nextData) {
  // Försök hitta totala antalet träffar
  function find(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== "object") return null;
    if (typeof obj.totalHits === "number") return obj.totalHits;
    if (typeof obj.numFound === "number") return obj.numFound;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "object") {
        const r = find(obj[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
  return find(nextData);
}

// ════════════════════════════════════════════════════════════════════
// Bolags-data → DB-format
// ════════════════════════════════════════════════════════════════════

function pickPrimaryPhone(phones) {
  if (!Array.isArray(phones) || !phones.length) return null;
  // Prio 1: nummer märkt VD/verkställande/ansvarig
  for (const p of phones) {
    const lbl = (p.label || "").toLowerCase();
    if (/\bvd\b|verkst|kundansvarig|ägare/i.test(lbl)) {
      return { number: p.callTo || p.displayAs, label: p.label || "" };
    }
  }
  // Prio 2: första nummer (ofta växel)
  return { number: phones[0].callTo || phones[0].displayAs, label: phones[0].label || "" };
}

function formatAddress(addrs) {
  if (!Array.isArray(addrs) || !addrs.length) return null;
  const a = addrs[0];
  const parts = [
    [a.street, a.number].filter(Boolean).join(" "),
    `${a.zipcode || ""} ${a.city || ""}`.trim(),
    a.county && a.county !== "Stockholms län" ? a.county : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function getCity(addrs) {
  if (!Array.isArray(addrs) || !addrs.length) return null;
  return addrs[0].city || null;
}

// Hitta orgnr i attribute-arrayen om det finns
function extractOrgnr(c) {
  if (!Array.isArray(c.attribute)) return null;
  for (const a of c.attribute) {
    if (a.name === "orgnr" || a.name === "organisationsnummer") return a.value;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════════════

function ensureColumns() {
  const db = getDb();
  const cols = db
    .prepare("PRAGMA table_info(companies)")
    .all()
    .map((r) => r.name);
  const newCols = [
    ["extra_phones", "TEXT"], // JSON-array av {label, number}
    ["hitta_id", "TEXT"], // hitta.se's interna id (för dedup)
    ["hitta_reviews_score", "REAL"],
    ["hitta_reviews_count", "INTEGER"],
  ];
  for (const [name, type] of newCols) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
      console.log(`   + Lade till kolumn: ${name}`);
    }
  }
}

function existsInDb(c, primaryPhone) {
  const db = getDb();
  const orgnr = extractOrgnr(c);

  // 1. Orgnr (säkraste)
  if (orgnr) {
    const r = db
      .prepare("SELECT place_id FROM companies WHERE org_nr = ?")
      .get(orgnr);
    if (r) return r.place_id;
  }

  // 2. Hitta-id (om vi redan sparat samma bolag)
  if (c.id) {
    const r = db
      .prepare("SELECT place_id FROM companies WHERE hitta_id = ?")
      .get(c.id);
    if (r) return r.place_id;
  }

  // 3. Namn + stad (normaliserad)
  const name = c.name || c.displayName;
  const city = getCity(c.address);
  if (name && city) {
    const r = db
      .prepare(
        "SELECT place_id FROM companies WHERE LOWER(REPLACE(REPLACE(REPLACE(name, ' AB', ''), ' Aktiebolag', ''), '  ', ' ')) = LOWER(REPLACE(REPLACE(REPLACE(?, ' AB', ''), ' Aktiebolag', ''), '  ', ' ')) AND LOWER(city) = LOWER(?)"
      )
      .get(name, city);
    if (r) return r.place_id;
  }

  // 4. Telefonnummer (digit-only)
  if (primaryPhone?.number) {
    const digits = primaryPhone.number.replace(/\D/g, "");
    if (digits.length >= 8) {
      const r = db
        .prepare("SELECT place_id FROM companies WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?")
        .get(`%${digits}%`);
      if (r) return r.place_id;
    }
  }

  return null;
}

function saveCompany(branch, c, primaryPhone) {
  const db = getDb();
  const placeId = `hitta_${c.id}`;
  const orgnr = extractOrgnr(c);
  const city = getCity(c.address);
  const address = formatAddress(c.address);
  const name = c.name || c.displayName;

  // Alla extra telefonnummer (med labels) som JSON
  const extraPhones = Array.isArray(c.phone)
    ? JSON.stringify(
        c.phone.map((p) => ({
          label: p.label || "",
          number: p.callTo || p.displayAs,
        }))
      )
    : null;

  const reviews = c.reviews || c.recoReviews || {};

  db.prepare(
    `INSERT OR IGNORE INTO companies
      (place_id, name, branch, city, phone, address, org_nr,
       extra_phones, hitta_id, hitta_reviews_score, hitta_reviews_count,
       scraped_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       datetime('now'), datetime('now'), datetime('now'))`
  ).run(
    placeId,
    name,
    branch,
    city,
    primaryPhone?.number || null,
    address,
    orgnr,
    extraPhones,
    c.id,
    reviews.score || null,
    reviews.count || null
  );

  return placeId;
}

// ════════════════════════════════════════════════════════════════════
// Discover
// ════════════════════════════════════════════════════════════════════

async function discoverOne(kategori, kategoriKeyword, stad, maxPages, dryRun) {
  let page = 2; // hitta börjar paginering vid /2
  let nya = 0,
    dubletter = 0,
    totalProcessed = 0;
  const branchLabel = `SE-Hitta-${kategori}`;

  while (page <= maxPages + 1) {
    const url = buildUrl(kategoriKeyword, stad, page);
    let html;
    try {
      const res = await safeFetch(url);
      html = await res.text();
    } catch (e) {
      process.stdout.write(`\n   ⚠️  ${kategori}/${stad} sida ${page}: ${e.message}\n`);
      break;
    }

    const nextData = extractNextData(html);
    if (!nextData) break;

    const companies = extractCompanies(nextData);
    if (!companies.length) break;

    for (const c of companies) {
      totalProcessed++;
      const phone = pickPrimaryPhone(c.phone);

      if (!dryRun) {
        const existing = existsInDb(c, phone);
        if (existing) {
          dubletter++;
        } else {
          saveCompany(branchLabel, c, phone);
          nya++;
        }
      } else {
        nya++;
      }
    }

    process.stdout.write(
      `\r   [${kategori}/${stad}] sida ${page}: ${companies.length} bolag (totalt: ${nya} nya, ${dubletter} dubletter)   `
    );

    // Om mindre än 25 bolag på sidan → sista sidan
    if (companies.length < 25) break;

    page++;
    await sleep(jitter(DELAY_MS));
  }

  return { kategori, stad, processed: totalProcessed, nya, dubletter };
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    branches: null,
    cities: null,
    maxPages: 100,
    gentle: false,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branches" && args[i + 1])
      opts.branches = args[++i].split(",").map((s) => s.trim());
    else if (args[i] === "--cities" && args[i + 1])
      opts.cities = args[++i].split(",").map((s) => s.trim());
    else if (args[i] === "--max-pages" && args[i + 1])
      opts.maxPages = parseInt(args[++i]);
    else if (args[i] === "--gentle") opts.gentle = true;
    else if (args[i] === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (opts.gentle) applyGentleMode();

  const branches = opts.branches || Object.keys(BRANCH_KEYWORDS);
  const cities = opts.cities || DEFAULT_CITIES;

  // Filtera bort branscher vi inte har keyword för
  const validBranches = branches.filter((b) => BRANCH_KEYWORDS[b]);
  const skipped = branches.filter((b) => !BRANCH_KEYWORDS[b]);

  if (skipped.length) {
    console.log(`⚠️  Skippas (saknar hitta-keyword): ${skipped.join(", ")}`);
  }

  ensureColumns();

  console.log(`\n🎯 simple-leads-hitta — bolagsdata från hitta.se\n`);
  console.log(`   Branscher:  ${validBranches.length} (${validBranches.join(", ")})`);
  console.log(`   Städer:     ${cities.length} (${cities.join(", ")})`);
  console.log(`   Max-pages:  ${opts.maxPages} per (kategori × stad)`);
  console.log(`   Mode:       ${opts.gentle ? "GENTLE (8s delay)" : "NORMAL (3s delay)"}`);
  console.log(`   Dry-run:    ${opts.dryRun ? "ja" : "nej"}`);
  console.log("");

  const total = validBranches.length * cities.length;
  let combo = 0;
  const grand = { nya: 0, dubletter: 0, processed: 0 };

  for (const b of validBranches) {
    for (const c of cities) {
      combo++;
      console.log(`\n[${combo}/${total}] ${b} × ${c}`);
      const r = await discoverOne(b, BRANCH_KEYWORDS[b], c, opts.maxPages, opts.dryRun);
      grand.nya += r.nya;
      grand.dubletter += r.dubletter;
      grand.processed += r.processed;
      console.log(`\n   ✅ ${r.nya} nya, ${r.dubletter} dubletter (av ${r.processed} processade)`);
    }
  }

  console.log(`\n\n📊 SLUTRESULTAT:`);
  console.log(`   Processade:  ${grand.processed.toLocaleString()}`);
  console.log(`   Nya bolag:   ${grand.nya.toLocaleString()}`);
  console.log(`   Dubletter:   ${grand.dubletter.toLocaleString()} (skippade)`);
  console.log(`   Dedup-rate:  ${grand.processed ? Math.round(grand.dubletter / grand.processed * 100) : 0}%`);

  if (!opts.dryRun) {
    console.log(`\n💾 Bolag sparade i leads.db med branch="SE-Hitta-{kategori}"`);
    console.log(`   För export: node export-final.js (eller egen export-skript)`);
  }
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
