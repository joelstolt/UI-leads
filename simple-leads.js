#!/usr/bin/env node
/**
 * simple-leads.js — minimal, gratis lead-extraktor med rate-limit-hardening.
 *
 * Allt-i-ett: discover bolag (allabolag) + firmatecknare/VD + email-scrape → CSV.
 *
 * 100% gratis: ingen SerpAPI, ingen Claude API, inga betalda tjänster alls.
 * Skriver till samma leads.db som resten av pipelinen (kompatibelt).
 *
 * Användning:
 *   node simple-leads.js --branch Hantverkare
 *   node simple-leads.js --branch Hantverkare --cities Stockholm,Göteborg,Malmö
 *   node simple-leads.js --branch Hantverkare --max-pages 5 --out leads.csv
 *   node simple-leads.js --branch Hantverkare --skip-email   (bara discover + VD)
 *   node simple-leads.js --branch Hantverkare --skip-corp    (bara discover + email)
 *
 * Resume: körs alltid mot leads.db, så avbruten körning fortsätter automatiskt
 *         när du kör om — redan hämtade bolag/VDer/mejl skippas.
 *
 * Rate-limit-hardening (för att inte få IP blockad):
 *   • UA-rotation över 5 olika browsers
 *   • Jitter ±40% på alla delays (mer mänsklig pacing)
 *   • Exponential backoff på 429/403/503 (30s → 60s → 120s → 240s → 480s)
 *   • Auto-paus 5 min varje 500:e anrop mot samma host
 *   • Crash efter 5 block i rad mot samma host (skydd mot fortsatt blockad)
 *
 * Kolumner i CSV-output:
 *   Företag, VD, Telefon, Mejl, Hemsida, Orgnr, Omsättning (kr),
 *   Anställda, Adress, SNI-kod, Bransch, Stad
 */

require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");
const regions = require("./regions.json");

// ════════════════════════════════════════════════════════════════════
// safe-fetch: rate-limit-hardening
// ════════════════════════════════════════════════════════════════════

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base, spread = 0.4) =>
  Math.round(base + (Math.random() * 2 - 1) * spread * base);
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

const hostState = new Map(); // host → { backoffUntil, blocks, totalReq }

async function safeFetch(url, opts = {}) {
  const u = new URL(url);
  const host = u.hostname;
  const st = hostState.get(host) || { backoffUntil: 0, blocks: 0, totalReq: 0 };

  if (st.backoffUntil > Date.now()) {
    const wait = st.backoffUntil - Date.now();
    process.stdout.write(`\n   ⏸  ${host}: backoff ${Math.round(wait / 1000)}s…\n`);
    await sleep(wait);
    st.backoffUntil = 0;
  }

  st.totalReq += 1;
  // Soft ceiling: pausa varje N anrop mot samma host
  if (st.totalReq > 0 && st.totalReq % HOST_REQ_LIMIT === 0) {
    const minutes = Math.round(HOST_PAUSE_MS / 60000);
    process.stdout.write(
      `\n   🧘 ${host}: ${HOST_REQ_LIMIT} anrop nådda, pausar ${minutes} min\n`
    );
    await sleep(HOST_PAUSE_MS);
  }
  // Slumpmässig kort paus (gentle-mode) — mimar mänskligt beteende
  if (RANDOM_PAUSE_EVERY > 0 && st.totalReq > 0 && st.totalReq % RANDOM_PAUSE_EVERY === 0) {
    const pauseMs = RANDOM_PAUSE_MS + Math.random() * RANDOM_PAUSE_MS;
    process.stdout.write(
      `\n   ☕ ${host}: kort paus ${Math.round(pauseMs / 1000)}s (gentle-mode)\n`
    );
    await sleep(pauseMs);
  }

  const headers = {
    "User-Agent": pickUA(),
    Accept: opts.json
      ? "application/json"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
    ...(opts.headers || {}),
  };

  let res;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      redirect: opts.redirect ?? "follow",
    });
  } catch (e) {
    hostState.set(host, st);
    throw e;
  }

  // Hård-block-statuskoder
  const isHardBlock = res.status === 429 || res.status === 503 || res.status === 403;

  // Mjuk-block: HTTP 202 från allabolag = "Accepted but processing" → empty body
  // Detekteras genom att läsa body och se om det är tomt eller JSON-fel
  let isSoftBlock = false;
  let bodyClone = null;
  if (res.status === 202 && opts.json) {
    bodyClone = await res.clone().text();
    if (!bodyClone || bodyClone.trim().length < 3) {
      isSoftBlock = true;
    }
  }

  if (isHardBlock || isSoftBlock) {
    st.blocks += 1;
    const minutes = Math.min(0.5 * Math.pow(2, st.blocks - 1), 10);
    st.backoffUntil = Date.now() + minutes * 60 * 1000;
    hostState.set(host, st);
    const reason = isSoftBlock ? `HTTP 202 (tom body — soft-block)` : `HTTP ${res.status}`;
    process.stdout.write(
      `\n   🚧 ${host}: ${reason} (block #${st.blocks}), backar ${minutes} min\n`
    );
    if (st.blocks >= 5) {
      throw new Error(
        `${host} har blockat oss fem gånger i rad. Avbryter — kör om senare.`
      );
    }
    await sleep(minutes * 60 * 1000);
    st.backoffUntil = 0;
    hostState.set(host, st);
    return safeFetch(url, opts); // rekursiv retry efter backoff
  }

  if (res.ok && st.blocks > 0) st.blocks = 0;
  hostState.set(host, st);
  return res;
}

const politeDelay = (baseMs) => sleep(jitter(baseMs));

// ════════════════════════════════════════════════════════════════════
// allabolag: discover + profil-lookup
// ════════════════════════════════════════════════════════════════════

const ALLABOLAG = "https://www.allabolag.se";

// ── Rate-limit-konfiguration (mutable, ändras av --gentle / --ultra-gentle) ──
let DISCOVER_DELAY_MS = 1200; // ~50 req/min mot allabolag
let PROFILE_DELAY_MS = 2200; // ~27 req/min för per-bolags-uppslag
let HOST_REQ_LIMIT = 500; // anrop per host innan auto-paus
let HOST_PAUSE_MS = 5 * 60 * 1000; // 5 min auto-paus
let RANDOM_PAUSE_EVERY = 0; // 0 = ingen extra paus
let RANDOM_PAUSE_MS = 0;

function applyGentleMode() {
  DISCOVER_DELAY_MS = 5000;
  PROFILE_DELAY_MS = 5000;
  HOST_REQ_LIMIT = 100;
  HOST_PAUSE_MS = 15 * 60 * 1000;
  RANDOM_PAUSE_EVERY = 50;
  RANDOM_PAUSE_MS = 30 * 1000;
}

function applyUltraGentleMode() {
  DISCOVER_DELAY_MS = 15000;
  PROFILE_DELAY_MS = 15000;
  HOST_REQ_LIMIT = 50;
  HOST_PAUSE_MS = 30 * 60 * 1000;
  RANDOM_PAUSE_EVERY = 25;
  RANDOM_PAUSE_MS = 60 * 1000;
}

async function discoverPage(industryTerm, city, page) {
  const url = `${ALLABOLAG}/api/search?industry=${encodeURIComponent(
    industryTerm
  )}&filter=${encodeURIComponent(`municipality:${city}`)}&page=${page}`;
  const res = await safeFetch(url, { json: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function profileSearch(name, city) {
  const url = `${ALLABOLAG}/api/search?name=${encodeURIComponent(name)}`;
  const res = await safeFetch(url, { json: true });
  if (!res.ok) return null;
  const data = await res.json();
  const candidates = data.companies || [];
  if (!candidates.length) return null;

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    let score = nameMatchScore(name, c.name || c.legalName || "");
    const muni = c.location?.municipality || "";
    if (city && muni.toLowerCase() === city.toLowerCase()) score += 0.5;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function nameMatchScore(a, b) {
  if (!a || !b) return 0;
  const norm = (s) => s.toLowerCase().replace(/[^a-zåäöéèü0-9]/g, "");
  const A = norm(a);
  const B = norm(b);
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.8;
  const aT = new Set(a.toLowerCase().split(/\s+/));
  const bT = new Set(b.toLowerCase().split(/\s+/));
  const common = [...aT].filter((t) => bT.has(t)).length;
  return common / Math.max(aT.size, bT.size);
}

// ════════════════════════════════════════════════════════════════════
// email-scrape från hemsidor
// ════════════════════════════════════════════════════════════════════

const EMAIL_BLOCK = [
  "@example",
  "@test.",
  "@sentry.",
  "@cdn.",
  "@google",
  "@facebook",
  "@apple",
  "@microsoft",
  "@wix.com",
  "@squarespace",
  "@godaddy",
];

function isValidEmail(e) {
  if (!e || e.length < 5 || !e.includes("@") || !e.includes(".")) return false;
  return !EMAIL_BLOCK.some((b) => e.toLowerCase().includes(b));
}

async function scrapeEmails(website) {
  if (!website) return [];
  let url = website.trim();
  if (!url.startsWith("http")) url = `https://${url}`;
  try {
    const res = await safeFetch(url, { timeoutMs: 10000 });
    if (!res.ok) return [];
    const html = await res.text();
    const found = new Set();
    const mr = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
    let m;
    while ((m = mr.exec(html))) found.add(m[1].toLowerCase());
    const tr = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    while ((m = tr.exec(html))) found.add(m[0].toLowerCase());
    return [...found].filter(isValidEmail).slice(0, 3);
  } catch {
    return [];
  }
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
  if (!cols.includes("firmatecknare")) {
    db.exec("ALTER TABLE companies ADD COLUMN firmatecknare TEXT;");
  }
}

function existing(orgnr, name, city) {
  const db = getDb();
  if (orgnr) {
    const r = db
      .prepare("SELECT place_id FROM companies WHERE org_nr = ?")
      .get(orgnr);
    if (r) return r.place_id;
  }
  const r = db
    .prepare(
      "SELECT place_id FROM companies WHERE LOWER(name)=LOWER(?) AND LOWER(city)=LOWER(?)"
    )
    .get(name, city);
  return r?.place_id ?? null;
}

function formatOrgNr(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

function upsertSimple(branch, city, c) {
  const orgnr = formatOrgNr(c.companyId || c.orgNumber);
  const phone = c.contactPerson?.phone || c.phone || null;
  const website = c.homepage || c.website || null;
  const email = c.email || null;
  const address = c.address
    ? `${c.address.street || ""}, ${c.address.postalCode || ""} ${c.address.city || ""}`
        .trim()
        .replace(/^,\s*/, "")
        .replace(/,\s*$/, "")
    : null;

  let revenue = null;
  if (c.revenue != null) {
    const n = parseFloat(String(c.revenue).replace(/[^\d.]/g, ""));
    if (!Number.isNaN(n)) revenue = Math.round(n * 1000); // tkr → kr
  }
  const employees = c.employeeCount || c.employees || null;
  const sni = c.currentIndustry?.code
    ? `${c.currentIndustry.code} ${c.currentIndustry.name || ""}`.trim()
    : c.industries?.[0]?.code
      ? `${c.industries[0].code} ${c.industries[0].name || ""}`.trim()
      : null;

  // Firmatecknare kommer ibland direkt i discover-svaret också
  const directFt = c.contactPerson?.name || null;

  const db = getDb();
  const ex = existing(orgnr, c.name, city);

  if (ex) {
    db.prepare(
      `UPDATE companies SET
        phone = COALESCE(NULLIF(phone,''), ?),
        website = COALESCE(NULLIF(website,''), ?),
        email = COALESCE(NULLIF(email,''), ?),
        address = COALESCE(NULLIF(address,''), ?),
        org_nr = COALESCE(org_nr, ?),
        revenue = COALESCE(revenue, ?),
        employees = COALESCE(employees, ?),
        sni_code = COALESCE(sni_code, ?),
        firmatecknare = COALESCE(firmatecknare, ?),
        updated_at = datetime('now')
       WHERE place_id = ?`
    ).run(
      phone,
      website,
      email,
      address,
      orgnr,
      revenue,
      employees,
      sni,
      directFt ? JSON.stringify([directFt]) : null,
      ex
    );
    return { isNew: false, place_id: ex };
  }

  const placeId = orgnr
    ? `allabolag_${orgnr.replace(/-/g, "")}`
    : `allabolag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    `INSERT INTO companies
      (place_id, name, branch, city, phone, website, email, address,
       org_nr, revenue, employees, sni_code, firmatecknare,
       scraped_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       datetime('now'), datetime('now'), datetime('now'))`
  ).run(
    placeId,
    c.name,
    branch,
    city,
    phone,
    website,
    email,
    address,
    orgnr,
    revenue,
    employees,
    sni,
    directFt ? JSON.stringify([directFt]) : null
  );
  return { isNew: true, place_id: placeId };
}

function setFirmatecknare(placeId, name) {
  if (!name) return;
  getDb()
    .prepare(
      `UPDATE companies SET firmatecknare = ?, corp_enriched_at = datetime('now'),
       updated_at = datetime('now') WHERE place_id = ?`
    )
    .run(JSON.stringify([name]), placeId);
}

function setEmail(placeId, email) {
  if (!email) return;
  getDb()
    .prepare(
      `UPDATE companies SET email = ?, email_scraped_at = datetime('now'),
       updated_at = datetime('now') WHERE place_id = ?`
    )
    .run(email, placeId);
}

// ════════════════════════════════════════════════════════════════════
// CSV
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Företag",
  "VD",
  "Telefon",
  "Mejl",
  "Hemsida",
  "Orgnr",
  "Omsättning (kr)",
  "Anställda",
  "Adress",
  "SNI-kod",
  "Bransch",
  "Stad",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(branch, outPath) {
  const rows = getDb()
    .prepare(
      `SELECT name, firmatecknare, phone, email, website, org_nr,
              revenue, employees, address, sni_code, branch, city
       FROM companies WHERE branch = ? ORDER BY city, name`
    )
    .all(branch);

  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    let vd = "";
    if (r.firmatecknare) {
      try {
        const arr = JSON.parse(r.firmatecknare);
        vd = Array.isArray(arr) ? arr[0] || "" : String(r.firmatecknare);
      } catch {
        vd = r.firmatecknare;
      }
    }
    lines.push(
      [
        r.name,
        vd,
        r.phone,
        r.email,
        r.website,
        r.org_nr,
        r.revenue,
        r.employees,
        r.address,
        r.sni_code,
        r.branch,
        r.city,
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return rows.length;
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    branch: null,
    cities: null,
    // Default: 100 sidor = effektivt obegränsat. Loopen bryts naturligt
    // när allabolag säger page >= totalPages eller returnerar tom sida.
    // Stora städer som Stockholm kan ha 30-50 sidor i en kategori.
    maxPages: 100,
    limit: null,
    out: null,
    skipEmail: false,
    skipCorp: false,
    skipDiscover: false,
    skipPrecheck: false,
    gentle: false,
    ultraGentle: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    else if (args[i] === "--cities" && args[i + 1])
      opts.cities = args[++i].split(",").map((s) => s.trim());
    else if (args[i] === "--max-pages" && args[i + 1])
      opts.maxPages = parseInt(args[++i]);
    else if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
    else if (args[i] === "--skip-email") opts.skipEmail = true;
    else if (args[i] === "--skip-corp") opts.skipCorp = true;
    else if (args[i] === "--skip-discover") opts.skipDiscover = true;
    else if (args[i] === "--skip-precheck") opts.skipPrecheck = true;
    else if (args[i] === "--gentle") opts.gentle = true;
    else if (args[i] === "--ultra-gentle") opts.ultraGentle = true;
  }
  return opts;
}

// Pre-check: testa allabolag innan körning, abort om rate-limited
async function preCheckAllabolag() {
  process.stdout.write("🔍 Pre-check: pingar allabolag.se… ");
  try {
    const r = await fetch("https://www.allabolag.se/api/search?name=IKEA%20AB", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    if (r.status === 200 && text.length > 100) {
      console.log(`✅ allabolag svarar 200 (${text.length} bytes) — kör igång`);
      return true;
    }
    console.log(`❌ allabolag returnerade HTTP ${r.status} (body: ${text.length} bytes)`);
    console.log("   Allabolag rate-limitar oss fortfarande. Vänta några timmar.");
    console.log("   Eller kör med --skip-precheck om du vill köra ändå.");
    return false;
  } catch (e) {
    console.log(`❌ Nätverksfel: ${e.message}`);
    return false;
  }
}

function pad(label, max = 38) {
  return label.slice(0, max).padEnd(max);
}

async function main() {
  const opts = parseArgs();

  if (!opts.branch) {
    console.error(
      "Användning: node simple-leads.js --branch <namn> [--cities Stockholm,Göteborg] [--max-pages 5] [--out leads.csv]"
    );
    console.error(
      `\nFlaggor:`
    );
    console.error(`  --gentle           Snälla mode: 5s delay, paus efter 100 req`);
    console.error(`  --ultra-gentle     Mycket snäll: 15s delay, paus efter 50 req (för IP-banrisk)`);
    console.error(`  --skip-precheck    Hoppa över pre-check mot allabolag`);
    console.error(
      `\nTillgängliga branches:\n  ${(regions.branchesByCountry?.SE || [])
        .map((b) => b.name)
        .join(", ")}`
    );
    process.exit(1);
  }

  // Aktivera rate-limit-mode
  if (opts.ultraGentle) applyUltraGentleMode();
  else if (opts.gentle) applyGentleMode();

  // Pre-check mot allabolag (hoppas över med --skip-precheck eller om vi bara skippar discover/corp)
  const willHitAllabolag =
    !opts.skipPrecheck && (!opts.skipDiscover || !opts.skipCorp);
  if (willHitAllabolag) {
    const ok = await preCheckAllabolag();
    if (!ok) process.exit(1);
    console.log("");
  }

  const seBranches = regions.branchesByCountry?.SE || [];
  const branchDef = seBranches.find(
    (b) => b.name.toLowerCase() === opts.branch.toLowerCase()
  );
  if (!branchDef) {
    console.error(`❌ Branch "${opts.branch}" finns inte i regions.json`);
    console.error(`   Tillgängliga: ${seBranches.map((b) => b.name).join(", ")}`);
    process.exit(1);
  }

  const queries = branchDef.queries;
  const cities = opts.cities || regions.citiesByCountry?.SE || [];
  if (!cities.length) {
    console.error("❌ Inga städer att söka i");
    process.exit(1);
  }

  ensureColumns();

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = opts.branch.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "och");
  const outPath = opts.out || `output/leads-${slug}-${stamp}.csv`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const mode = opts.ultraGentle ? "ULTRA-GENTLE" : opts.gentle ? "GENTLE" : "NORMAL";
  console.log(`🎯 simple-leads — gratis bolagsdata via allabolag.se\n`);
  console.log(`   Branch:     ${opts.branch} (${queries.length} queries: ${queries.join(", ")})`);
  console.log(`   Städer:     ${cities.length}${cities.length <= 5 ? " (" + cities.join(", ") + ")" : ""}`);
  console.log(`   Max-pages:  ${opts.maxPages} per (query × stad)`);
  console.log(`   Mode:       ${mode}`);
  console.log(`   Delays:     discover ${DISCOVER_DELAY_MS}ms, profile ${PROFILE_DELAY_MS}ms`);
  console.log(`   Auto-paus:  varje ${HOST_REQ_LIMIT}:e req → ${Math.round(HOST_PAUSE_MS / 60000)} min`);
  if (RANDOM_PAUSE_EVERY > 0) {
    console.log(`   Mikropaus:  varje ${RANDOM_PAUSE_EVERY}:e req → ~${Math.round(RANDOM_PAUSE_MS / 1000)}s`);
  }
  console.log(`   Output:     ${outPath}`);
  console.log("");

  // ── Steg 1: Discover ─────────────────────────────────────────
  if (!opts.skipDiscover) {
    console.log("📍 Steg 1/3: Discover via allabolag.se /api/search");
    if (opts.limit) console.log(`   Limit:      stoppar vid ${opts.limit} nya bolag`);
    let nyaCount = 0,
      dubletter = 0;
    const totalCombos = queries.length * cities.length;
    let combo = 0;
    let limitHit = false;

    for (const q of queries) {
      if (limitHit) break;
      for (const city of cities) {
        if (limitHit) break;
        combo++;
        let page = 1;
        while (page <= opts.maxPages) {
          let data;
          try {
            data = await discoverPage(q, city, page);
          } catch (e) {
            process.stdout.write(`\n   ⚠️  ${q}/${city} sida ${page}: ${e.message}\n`);
            break;
          }
          const list = data.companies || [];
          if (!list.length) break;

          for (const c of list) {
            const r = upsertSimple(opts.branch, city, c);
            if (r.isNew) nyaCount++;
            else dubletter++;
            if (opts.limit && nyaCount >= opts.limit) {
              limitHit = true;
              break;
            }
          }

          const pct = Math.round((combo / totalCombos) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${pad(q + " / " + city)} sida ${page}: ${list.length} bolag (totalt: ${nyaCount} nya, ${dubletter} dubletter)   `
          );

          if (limitHit) break;
          const totalPages = data.pages ?? 0;
          if (page >= totalPages) break;
          page++;
          await politeDelay(DISCOVER_DELAY_MS);
        }
        if (!limitHit) await politeDelay(DISCOVER_DELAY_MS);
      }
    }
    console.log(`\n   ✅ Discover klar: ${nyaCount} nya bolag, ${dubletter} fanns redan i DB${limitHit ? " (limit nåddes)" : ""}`);
  }

  // ── Steg 2: Firmatecknare/VD ─────────────────────────────────
  if (!opts.skipCorp) {
    console.log("\n👤 Steg 2/3: Firmatecknare/VD per bolag");
    const need = getDb()
      .prepare(
        `SELECT place_id, name, city FROM companies
         WHERE branch = ? AND firmatecknare IS NULL
         ORDER BY name`
      )
      .all(opts.branch);
    console.log(`   Bolag att slå upp: ${need.length}`);

    let matched = 0,
      missed = 0;
    for (let i = 0; i < need.length; i++) {
      const c = need[i];
      try {
        const profile = await profileSearch(c.name, c.city);
        const ftName = profile?.contactPerson?.name;
        if (ftName) {
          setFirmatecknare(c.place_id, ftName);
          matched++;
        } else {
          missed++;
        }
      } catch {
        missed++;
      }
      const pct = Math.round(((i + 1) / need.length) * 100);
      process.stdout.write(
        `\r   [${String(pct).padStart(3)}%] ${i + 1}/${need.length} (${matched} ✓ ${missed} ✗)   `
      );
      await politeDelay(PROFILE_DELAY_MS);
    }
    console.log(`\n   ✅ Firmatecknare: ${matched} hittade, ${missed} ej matchade`);
  }

  // ── Steg 3: Email-scrape (parallell, 8 samtidiga sajter) ─────
  if (!opts.skipEmail) {
    console.log("\n📧 Steg 3/3: Email-scrape från hemsidor (parallell)");
    const need = getDb()
      .prepare(
        `SELECT place_id, name, website FROM companies
         WHERE branch = ? AND website IS NOT NULL AND website != ''
           AND (email IS NULL OR email = '')
         ORDER BY name`
      )
      .all(opts.branch);
    console.log(`   Sajter att scanna: ${need.length}  (parallellt: 8 åt gången)`);

    const pLimit = require("p-limit");
    const limit = pLimit(8);

    let withEmail = 0,
      withoutEmail = 0,
      done = 0;

    const tasks = need.map((c) =>
      limit(async () => {
        try {
          const emails = await scrapeEmails(c.website);
          if (emails.length) {
            setEmail(c.place_id, emails[0]);
            withEmail++;
          } else {
            withoutEmail++;
          }
        } catch {
          withoutEmail++;
        }
        done++;
        const pct = Math.round((done / need.length) * 100);
        process.stdout.write(
          `\r   [${String(pct).padStart(3)}%] ${done}/${need.length} (${withEmail} ✓ ${withoutEmail} ✗)   `
        );
      })
    );
    await Promise.all(tasks);
    console.log(`\n   ✅ Email-scrape: ${withEmail} mejl hittade, ${withoutEmail} utan mejl`);
  }

  // ── CSV-export ───────────────────────────────────────────────
  const exported = exportCsv(opts.branch, outPath);
  console.log(`\n📄 CSV exporterad: ${outPath}  (${exported} rader)`);

  // ── Sammanfattning ───────────────────────────────────────────
  const stats = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS with_phone,
         SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS with_email,
         SUM(CASE WHEN firmatecknare IS NOT NULL THEN 1 ELSE 0 END) AS with_vd,
         SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS with_web,
         SUM(CASE WHEN phone IS NOT NULL AND phone != ''
                   AND email IS NOT NULL AND email != ''
                   AND firmatecknare IS NOT NULL
                   AND website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS complete
       FROM companies WHERE branch = ?`
    )
    .get(opts.branch);

  const pctOf = (n) =>
    stats.total > 0 ? `${Math.round((n / stats.total) * 100)}%` : "0%";
  console.log(`\n📊 Sammanfattning för "${opts.branch}":`);
  console.log(`   Totalt:           ${stats.total}`);
  console.log(`   Med telefon:      ${stats.with_phone} (${pctOf(stats.with_phone)})`);
  console.log(`   Med mejl:         ${stats.with_email} (${pctOf(stats.with_email)})`);
  console.log(`   Med VD:           ${stats.with_vd} (${pctOf(stats.with_vd)})`);
  console.log(`   Med hemsida:      ${stats.with_web} (${pctOf(stats.with_web)})`);
  console.log(`   Kompletta (alla 4): ${stats.complete} (${pctOf(stats.complete)})`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
