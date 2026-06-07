#!/usr/bin/env node
/**
 * simple-leads-no.js — gratis lead-extraktor för Norge via BRREG
 *
 * Hämtar ALL data direkt från Brønnøysundregistret (norska statens öppna
 * företagsregister). Inget behov av proff.no, inget bot-skydd att navigera,
 * ingen rate-limit. Allt är offentlig myndighetsdata.
 *
 * Kolumner i CSV-output:
 *   Företag, VD, Telefon, Mejl, Hemsida, Orgnr, Aksjekapital,
 *   Adress, NACE-kod, Bransch, Stad, Konkurs
 *
 * Användning:
 *   node simple-leads-no.js                                    → alla bygg/hantverk-AS
 *   node simple-leads-no.js --nace 43.21                       → bara elektriker
 *   node simple-leads-no.js --nace 41,42,43                    → bygg + anläggning + spec
 *   node simple-leads-no.js --concurrency 5                    → snällare mot BRREG
 *   node simple-leads-no.js --skip-email-scrape                → hoppa över hemsida-scrape
 *   node simple-leads-no.js --out ~/Desktop/norge-leads.csv
 *
 * Pipeline:
 *   1. Discover: GET /enheter?naeringskode=X (lista alla bolag i kategorin)
 *   2. Detalj: GET /enheter/{orgnr} parallellt — ger telefon/mejl/adress
 *   3. Roller: GET /enheter/{orgnr}/roller parallellt — ger Daglig leder (VD)
 *   4. Email-fallback: scrape hemsida för bolag utan BRREG-mejl (parallellt)
 *   5. Export: CSV på skrivbordet
 */

require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

const BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api";
const PAGE_SIZE = 200; // max enligt BRREG
const DEFAULT_CONCURRENCY = 10; // BRREG tål mycket men var snäll

// NACE-koder (norska SNI) för bygg/hantverk-sektorn.
// 41 = Oppføring av bygninger
// 42 = Anleggsvirksomhet
// 43 = Spesialisert bygge- og anleggsvirksomhet (alla hantverk-spec)
const DEFAULT_NACE = ["41", "42", "43"];

// NACE → Swedish-style branch label (för att gruppera i CSV/DB)
const NACE_TO_BRANCH = {
  "41": "NO-Bygg",
  "41.1": "NO-Bygg",
  "41.2": "NO-Bygg",
  "42": "NO-Anläggning",
  "42.1": "NO-Anläggning",
  "42.2": "NO-Anläggning",
  "42.9": "NO-Anläggning",
  "43": "NO-Hantverk",
  "43.1": "NO-Hantverk-Rivning",
  "43.11": "NO-Sanering",
  "43.12": "NO-Markarbeten",
  "43.13": "NO-Markarbeten",
  "43.2": "NO-Hantverk-Installation",
  "43.21": "NO-Elektriker",
  "43.22": "NO-VVS",
  "43.29": "NO-Isolering",
  "43.3": "NO-Hantverk-Slutbehandling",
  "43.31": "NO-Murare",
  "43.32": "NO-Snickare",
  "43.33": "NO-Tapetserare",
  "43.34": "NO-Målare",
  "43.39": "NO-Hantverk-Slutbehandling",
  "43.9": "NO-Hantverk-Spec",
  "43.91": "NO-Takläggare",
  "43.99": "NO-Hantverk-Spec",
};

function naceToBranch(code) {
  if (!code) return "NO-Hantverk";
  // Försök matcha mer-specifikt först (43.21 → 43.2 → 43)
  const normalized = code.replace(/^(\d+)\.(\d+).*$/, "$1.$2"); // 43.210 → 43.21
  if (NACE_TO_BRANCH[normalized]) return NACE_TO_BRANCH[normalized];
  const major = normalized.replace(/^(\d+)\..*$/, "$1.$2");
  if (NACE_TO_BRANCH[major]) return NACE_TO_BRANCH[major];
  const top = normalized.split(".")[0];
  return NACE_TO_BRANCH[top] || "NO-Hantverk";
}

// ════════════════════════════════════════════════════════════════════
// safe-fetch (förenklad — BRREG har inga rate-limits, men UA-rotation
// är fortfarande god ton för email-scrape från företagshemsidor)
// ════════════════════════════════════════════════════════════════════

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (b, s = 0.4) => Math.round(b + (Math.random() * 2 - 1) * s * b);
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

async function brregFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "leads-scraper/1.0 (joel@stoltmarketing.se)",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function webFetch(url) {
  return fetch(url, {
    headers: {
      "User-Agent": pickUA(),
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "no-NO,no;q=0.9,sv;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
}

// ════════════════════════════════════════════════════════════════════
// BRREG-anrop
// ════════════════════════════════════════════════════════════════════

async function discoverByNace(nace) {
  let page = 0;
  const orgnrs = [];
  let totalPages = 1;

  while (page < totalPages) {
    const url = `${BRREG_BASE}/enheter?naeringskode=${encodeURIComponent(nace)}&size=${PAGE_SIZE}&page=${page}`;
    let data;
    try {
      data = await brregFetch(url);
    } catch (e) {
      console.warn(`   ⚠️  NACE ${nace} sida ${page}: ${e.message}`);
      break;
    }
    const list = data._embedded?.enheter || [];
    totalPages = data.page?.totalPages ?? 1;

    for (const e of list) {
      // Filtrera: bara aktiva AS, ingen konkurs, ej under avvikling
      if (e.organisasjonsform?.kode !== "AS") continue;
      if (e.konkurs) continue;
      if (e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning) continue;
      orgnrs.push({ orgnr: e.organisasjonsnummer, naceCode: e.naeringskode1?.kode });
    }

    process.stdout.write(
      `\r   NACE ${nace}: sida ${page + 1}/${totalPages} — ${orgnrs.length} bolag samlade   `
    );

    page++;
    await sleep(jitter(300)); // var snäll mot BRREG även om de tål mer
  }
  console.log("");
  return orgnrs;
}

async function fetchEnhet(orgnr) {
  return brregFetch(`${BRREG_BASE}/enheter/${orgnr}`);
}

async function fetchRoller(orgnr) {
  try {
    return await brregFetch(`${BRREG_BASE}/enheter/${orgnr}/roller`);
  } catch {
    return null;
  }
}

function extractDagligLeder(roller) {
  if (!roller?.rollegrupper) return null;
  for (const grp of roller.rollegrupper) {
    const isDaglig =
      grp.type?.kode === "DAGL" ||
      (grp.type?.beskrivelse || "").toLowerCase().includes("daglig");
    if (!isDaglig) continue;
    for (const rolle of grp.roller || []) {
      const p = rolle.person;
      if (!p) continue;
      const navn = [p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn]
        .filter(Boolean)
        .join(" ");
      if (navn) return navn;
    }
  }
  // Fallback: Styrets leder
  for (const grp of roller.rollegrupper) {
    const isStyre = (grp.type?.beskrivelse || "").toLowerCase().includes("styre");
    if (!isStyre) continue;
    for (const rolle of grp.roller || []) {
      const isLeder = (rolle.type?.beskrivelse || "").toLowerCase().includes("leder");
      if (!isLeder) continue;
      const p = rolle.person;
      if (!p) continue;
      const navn = [p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn]
        .filter(Boolean)
        .join(" ");
      if (navn) return navn;
    }
  }
  return null;
}

function formatAdresse(addr) {
  if (!addr) return null;
  const lines = [
    Array.isArray(addr.adresse) ? addr.adresse.join(", ") : addr.adresse,
    `${addr.postnummer || ""} ${addr.poststed || ""}`.trim(),
    addr.land && addr.land !== "Norge" ? addr.land : null,
  ].filter(Boolean);
  return lines.join(", ");
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

function upsertNorwegian(branch, data) {
  const db = getDb();
  const placeId = `brreg_${data.orgnr}`;
  const existing = db
    .prepare("SELECT place_id FROM companies WHERE place_id = ? OR org_nr = ?")
    .get(placeId, data.orgnr);

  const fields = {
    place_id: placeId,
    name: data.name,
    branch,
    city: data.city || null,
    phone: data.phone,
    website: data.website,
    email: data.email,
    address: data.address,
    org_nr: data.orgnr,
    revenue: data.aksjekapital, // använder revenue-fältet för aksjekapital i NOK
    employees: null,
    sni_code: data.naceCode
      ? `${data.naceCode}${data.naceLabel ? " " + data.naceLabel : ""}`
      : null,
    firmatecknare: data.dagligLeder ? JSON.stringify([data.dagligLeder]) : null,
  };

  if (existing) {
    db.prepare(
      `UPDATE companies SET
        name = COALESCE(NULLIF(name,''), ?),
        branch = COALESCE(branch, ?),
        city = COALESCE(NULLIF(city,''), ?),
        phone = COALESCE(NULLIF(phone,''), ?),
        website = COALESCE(NULLIF(website,''), ?),
        email = COALESCE(NULLIF(email,''), ?),
        address = COALESCE(NULLIF(address,''), ?),
        org_nr = COALESCE(org_nr, ?),
        revenue = COALESCE(revenue, ?),
        sni_code = COALESCE(sni_code, ?),
        firmatecknare = COALESCE(firmatecknare, ?),
        corp_enriched_at = datetime('now'),
        updated_at = datetime('now')
       WHERE place_id = ?`
    ).run(
      fields.name,
      fields.branch,
      fields.city,
      fields.phone,
      fields.website,
      fields.email,
      fields.address,
      fields.org_nr,
      fields.revenue,
      fields.sni_code,
      fields.firmatecknare,
      existing.place_id
    );
    return { isNew: false, place_id: existing.place_id };
  }

  db.prepare(
    `INSERT INTO companies
      (place_id, name, branch, city, phone, website, email, address,
       org_nr, revenue, employees, sni_code, firmatecknare,
       scraped_at, corp_enriched_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       datetime('now'), datetime('now'), datetime('now'), datetime('now'))`
  ).run(
    fields.place_id,
    fields.name,
    fields.branch,
    fields.city,
    fields.phone,
    fields.website,
    fields.email,
    fields.address,
    fields.org_nr,
    fields.revenue,
    fields.employees,
    fields.sni_code,
    fields.firmatecknare
  );
  return { isNew: true, place_id: placeId };
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
// Email-scrape (för bolag utan BRREG-mejl)
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
    const res = await webFetch(url);
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
// CSV
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Företag",
  "VD",
  "Telefon",
  "Mejl",
  "Hemsida",
  "Orgnr",
  "Aksjekapital (NOK)",
  "Adress",
  "NACE-kod",
  "Bransch",
  "Stad",
  "Konkurs",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(outPath) {
  const rows = getDb()
    .prepare(
      `SELECT name, firmatecknare, phone, email, website, org_nr,
              revenue, address, sni_code, branch, city
       FROM companies WHERE branch LIKE 'NO-%'
       ORDER BY branch, city, name`
    )
    .all();

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
        r.address,
        r.sni_code,
        r.branch,
        r.city,
        "Nei",
      ]
        .map(csvEsc)
        .join(",")
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return rows.length;
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    nace: null,
    out: null,
    concurrency: DEFAULT_CONCURRENCY,
    skipDiscover: false,
    skipDetail: false,
    skipEmailScrape: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--nace" && args[i + 1])
      opts.nace = args[++i].split(",").map((s) => s.trim());
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
    else if (args[i] === "--skip-discover") opts.skipDiscover = true;
    else if (args[i] === "--skip-detail") opts.skipDetail = true;
    else if (args[i] === "--skip-email-scrape") opts.skipEmailScrape = true;
  }
  return opts;
}

// Kör hela pipelinen (discover → detalj+roller → email-scrape) för EN NACE-kod
// och returnerar stats.
async function processOneNace(nace, naceIndex, totalNaces, opts, limit) {
  console.log(`\n══════════ NACE ${nace}  (${naceIndex + 1}/${totalNaces}) ══════════`);

  // ── Phase 1: Discover ──────────────────────────────────────────
  let orgnrItems = [];
  if (!opts.skipDiscover) {
    console.log(`\n📍 Steg 1/3: Discover via BRREG /enheter?naeringskode=${nace}`);
    orgnrItems = await discoverByNace(nace);
    console.log(`   ✅ ${orgnrItems.length} aktiva AS hittade för NACE ${nace}`);
  } else {
    // Hämta från DB om vi skippar discover (mycket grov filter — NACE-prefix)
    orgnrItems = getDb()
      .prepare(
        `SELECT org_nr AS orgnr, sni_code AS naceCode FROM companies
         WHERE branch LIKE 'NO-%' AND org_nr IS NOT NULL
           AND sni_code LIKE ?`
      )
      .all(nace + "%");
    console.log(`📍 Steg 1: skippad — använder ${orgnrItems.length} bolag från DB`);
  }

  if (orgnrItems.length === 0) {
    console.log(`   ⏭  Inga bolag — hoppar över NACE ${nace}\n`);
    return { discovered: 0, enriched: 0, withEmail: 0 };
  }

  // ── Phase 2: Detalj + roller ───────────────────────────────────
  let added = 0,
    updated = 0,
    failed = 0;
  if (!opts.skipDetail) {
    console.log(`\n👤 Steg 2/3: Detalj + Daglig leder (${opts.concurrency} parallella)`);
    let processed = 0;
    const tasks = orgnrItems.map((item) =>
      limit(async () => {
        const orgnr = item.orgnr;
        try {
          const [enhet, roller] = await Promise.all([
            fetchEnhet(orgnr),
            fetchRoller(orgnr),
          ]);
          if (!enhet) {
            failed++;
            return;
          }
          const dagligLeder = extractDagligLeder(roller);
          const naceCode = enhet.naeringskode1?.kode || item.naceCode || null;
          const naceLabel = enhet.naeringskode1?.beskrivelse || null;
          const branch = naceToBranch(naceCode);
          const data = {
            orgnr,
            name: enhet.navn,
            phone: enhet.mobil || enhet.telefon || null,
            email: enhet.epostadresse || null,
            website: enhet.hjemmeside || null,
            address: formatAdresse(enhet.forretningsadresse),
            city: enhet.forretningsadresse?.poststed || null,
            naceCode,
            naceLabel,
            dagligLeder,
            aksjekapital: enhet.kapital?.belop || null,
          };
          const r = upsertNorwegian(branch, data);
          if (r.isNew) added++;
          else updated++;
        } catch {
          failed++;
        }
        processed++;
        if (processed % 50 === 0 || processed === orgnrItems.length) {
          const pct = Math.round((processed / orgnrItems.length) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${processed}/${orgnrItems.length} (+${added} nya, ${updated} uppdaterade, ${failed} fel)   `
          );
        }
      })
    );
    await Promise.all(tasks);
    console.log(`\n   ✅ Klar: ${added} nya, ${updated} uppdaterade, ${failed} fel`);
  }

  // ── Phase 3: Email-scrape (BARA för denna NACE:s orgnr) ────────
  let withEmail = 0;
  if (!opts.skipEmailScrape) {
    const orgnrSet = new Set(orgnrItems.map((i) => i.orgnr));
    const placeholders = [...orgnrSet].map(() => "?").join(",");
    const need = orgnrSet.size
      ? getDb()
          .prepare(
            `SELECT place_id, name, website FROM companies
             WHERE org_nr IN (${placeholders})
               AND website IS NOT NULL AND website != ''
               AND (email IS NULL OR email = '')`
          )
          .all(...orgnrSet)
      : [];
    console.log(`\n📧 Steg 3/3: Email-scrape — ${need.length} sajter att scanna`);

    let withoutEmail = 0,
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
        if (done % 25 === 0 || done === need.length) {
          const pct = need.length ? Math.round((done / need.length) * 100) : 100;
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${done}/${need.length} (${withEmail} ✓ ${withoutEmail} ✗)   `
          );
        }
      })
    );
    await Promise.all(tasks);
    console.log(`\n   ✅ Email-scrape: +${withEmail} mejl, ${withoutEmail} utan`);
  }

  return { discovered: orgnrItems.length, enriched: added + updated, withEmail };
}

async function main() {
  const opts = parseArgs();
  const naceCodes = opts.nace || DEFAULT_NACE;
  const outPath =
    (opts.out || "~/Desktop/leads-norge-hantverkare.csv").replace(
      /^~/,
      process.env.HOME
    );

  ensureColumns();

  console.log(`🇳🇴 simple-leads-no — gratis bolagsdata via BRREG\n`);
  console.log(`   NACE-koder:  ${naceCodes.join(", ")}  (kör en NACE i taget, alla 3 steg innan nästa)`);
  console.log(`   Concurrency: ${opts.concurrency}`);
  console.log(`   Output:      ${outPath}`);

  const pLimit = require("p-limit");
  const limit = pLimit(opts.concurrency);

  // ── Loopa NACE-koder, fullfölj alla 3 steg per NACE ──
  const grand = { discovered: 0, enriched: 0, withEmail: 0 };
  for (let i = 0; i < naceCodes.length; i++) {
    const result = await processOneNace(naceCodes[i], i, naceCodes.length, opts, limit);
    grand.discovered += result.discovered;
    grand.enriched += result.enriched;
    grand.withEmail += result.withEmail;

    // Inkrementell export efter varje NACE — CSV växer komplett, inte mid-state
    const exported = exportCsv(outPath);
    console.log(`\n📄 CSV uppdaterad efter NACE ${naceCodes[i]}: ${exported.toLocaleString()} rader\n`);
  }

  console.log(`\n═══ Pipeline klar — totalt ${grand.discovered} discovered, ${grand.enriched} enriched, ${grand.withEmail} mejl ═══\n`);

  // ── Sammanfattning per bransch ─────────────────────────────────
  const stats = getDb()
    .prepare(
      `SELECT branch, COUNT(*) AS antal,
         SUM(CASE WHEN firmatecknare IS NOT NULL THEN 1 ELSE 0 END) AS vd,
         SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS tel,
         SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS mejl,
         SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS web,
         SUM(CASE WHEN phone IS NOT NULL AND phone != ''
                   AND email IS NOT NULL AND email != ''
                   AND firmatecknare IS NOT NULL
                   AND website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS komplett
       FROM companies WHERE branch LIKE 'NO-%'
       GROUP BY branch ORDER BY antal DESC`
    )
    .all();

  console.log("📊 Sammanfattning per bransch:");
  let t = { antal: 0, vd: 0, tel: 0, mejl: 0, web: 0, komplett: 0 };
  for (const s of stats) {
    ["antal", "vd", "tel", "mejl", "web", "komplett"].forEach(
      (k) => (t[k] += s[k])
    );
    console.log(
      `   ${s.branch.padEnd(28)} ${String(s.antal).padStart(5)} | VD ${String(s.vd).padStart(5)} | tel ${String(s.tel).padStart(5)} | mejl ${String(s.mejl).padStart(5)} | KOMPL ${String(s.komplett).padStart(4)}`
    );
  }
  console.log(`   ${"─".repeat(82)}`);
  console.log(
    `   ${"TOTALT".padEnd(28)} ${String(t.antal).padStart(5)} | VD ${String(t.vd).padStart(5)} | tel ${String(t.tel).padStart(5)} | mejl ${String(t.mejl).padStart(5)} | KOMPL ${String(t.komplett).padStart(4)}`
  );
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
