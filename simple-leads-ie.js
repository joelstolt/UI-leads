#!/usr/bin/env node
/**
 * simple-leads-ie.js — gratis lead-extraktor för Irland via CRO open data
 *
 * Använder Companies Registration Office (CRO) open data som dump:
 *   https://data.gov.ie → Company Records (44 MB CSV med 800k+ bolag)
 *
 * Filtrerar för aktiva (Status="Normal") hantverkar-bolag via NACE 41/42/43
 * eller namn-keywords (electrical, plumber, carpenter etc).
 *
 * Begränsningar (CRO ger ingen kontaktinfo):
 *   ❌ ingen telefon
 *   ❌ ingen mejl
 *   ❌ ingen hemsida
 *   ❌ ingen VD/director-info
 *
 * Vad du FÅR (för 22-25k irländska hantverkar-bolag):
 *   ✅ namn, orgnr, adress, NACE-kod, status, bolagsform, regdatum, eircode
 *
 * Användning:
 *   node simple-leads-ie.js                      → ladda CSV automatiskt + processa
 *   node simple-leads-ie.js --csv /path/to.csv   → använd lokal CSV-fil
 *   node simple-leads-ie.js --out fil.csv        → välj output-path
 *   node simple-leads-ie.js --skip-download      → använd /tmp/companies.csv om finns
 *   node simple-leads-ie.js --include-name-only  → även bolag utan NACE men med hantverk-namn
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { getDb } = require("./db");

// ════════════════════════════════════════════════════════════════════
// CRO data download
// ════════════════════════════════════════════════════════════════════

const CRO_URL =
  "https://opendata.cro.ie/dataset/bf6f837d-0946-4c14-9a99-82cd6980c121/resource/3fef41bc-b8f4-4b10-8434-ce51c29b1bba/download/companies.csv.zip";
const TMP_ZIP = "/tmp/cro-companies.csv.zip";
const TMP_CSV = "/tmp/companies.csv";

function downloadCroCsv() {
  if (fs.existsSync(TMP_CSV)) {
    const stat = fs.statSync(TMP_CSV);
    const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600;
    if (ageHours < 24 && stat.size > 100_000_000) {
      console.log(`   ✅ CSV finns redan (${Math.round(stat.size / 1e6)} MB, ${ageHours.toFixed(1)}h gammal)`);
      return TMP_CSV;
    }
  }
  console.log(`   ⬇️  Laddar ner CRO open data (~44 MB)…`);
  execSync(`curl -sL -A "Mozilla/5.0" -o "${TMP_ZIP}" "${CRO_URL}"`, {
    stdio: "inherit",
  });
  console.log(`   📦 Packar upp…`);
  execSync(`unzip -o -d /tmp "${TMP_ZIP}"`, { stdio: "ignore" });
  return TMP_CSV;
}

// ════════════════════════════════════════════════════════════════════
// CSV-parsing + filtrering
// ════════════════════════════════════════════════════════════════════

const HANTVERK_NACE = /^4[123]/; // 41, 42, 43.x

const HANTVERK_KEYWORDS = {
  Electrical: /\b(electric|electrical|electricians?)\b/i,
  Plumbing: /\b(plumb|plumbing|plumbers?)\b/i,
  Carpentry: /\b(carpent|carpenters?|joiner|joinery)\b/i,
  Painting: /\b(paint|painters?|painting)\b/i,
  Roofing: /\b(roof|roofing|roofers?)\b/i,
  Building: /\b(builder|building|construct|construction)\b/i,
  Tiling: /\b(tile|tiling|tilers?)\b/i,
  Plastering: /\b(plaster|plastering|plasterers?)\b/i,
  Decorating: /\b(decorat)/i,
  Glazing: /\b(glaz|glass)\b/i,
  Landscaping: /\b(landscap|landscaping)\b/i,
  HVAC: /\b(hvac|heating|ventilation)\b/i,
};

// Mappar NACE-kod → svensk-style branch-namn för konsistens
function naceToBranch(naceRaw) {
  if (!naceRaw) return "IE-Hantverk";
  const code = String(naceRaw).replace(/\.0$/, "").trim();
  // 4-cifferkoder: 4321 = Electrical, 4322 = Plumbing/HVAC, etc
  if (/^432[12]/.test(code)) return code.startsWith("4321") ? "IE-Electrical" : "IE-Plumbing";
  if (/^4329/.test(code)) return "IE-Insulation";
  if (/^4331/.test(code)) return "IE-Plastering";
  if (/^4332/.test(code)) return "IE-Carpentry";
  if (/^4333/.test(code)) return "IE-Tiling";
  if (/^4334/.test(code)) return "IE-Painting";
  if (/^4339/.test(code)) return "IE-Hantverk-Finishing";
  if (/^4391/.test(code)) return "IE-Roofing";
  if (/^4399/.test(code)) return "IE-Hantverk-Special";
  if (/^4311/.test(code)) return "IE-Demolition";
  if (/^431[23]/.test(code)) return "IE-Earthworks";
  if (/^41/.test(code)) return "IE-Building";
  if (/^42/.test(code)) return "IE-Civil";
  if (/^43/.test(code)) return "IE-Hantverk";
  return "IE-Hantverk";
}

function nameToBranch(name) {
  for (const [k, re] of Object.entries(HANTVERK_KEYWORDS)) {
    if (re.test(name)) return `IE-${k}`;
  }
  return null;
}

function parseCsvRow(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function joinAddress(c) {
  return [c.address1, c.address2, c.address3, c.address4]
    .filter((s) => s && !s.startsWith("***"))
    .join(", ")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .trim();
}

function processCsv(csvPath, opts) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath, "utf8");
    let header = null,
      buf = "";
    let active = 0,
      hits = 0,
      byNace = 0,
      byName = 0;
    const rows = [];

    stream.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!header) {
          header = parseCsvRow(line);
          continue;
        }
        const cols = parseCsvRow(line);
        if ((cols[3] || "").trim() !== "Normal") continue;
        active++;

        const c = {
          companyNum: cols[0],
          name: cols[1] || "",
          statusCode: cols[2],
          status: (cols[3] || "").trim(),
          typeCode: cols[4],
          type: cols[5],
          regDate: cols[6],
          address1: cols[8],
          address2: cols[9],
          address3: cols[10],
          address4: cols[11],
          naceCode: (cols[16] || "").replace(/\.0$/, "").trim(),
          eircode: cols[17],
        };

        let branch = null;
        if (c.naceCode && HANTVERK_NACE.test(c.naceCode)) {
          branch = naceToBranch(c.naceCode);
          byNace++;
        } else if (opts.includeNameOnly) {
          branch = nameToBranch(c.name);
          if (branch) byName++;
        }

        if (branch) {
          c.branch = branch;
          rows.push(c);
          hits++;
        }
      }
    });

    stream.on("end", () => {
      console.log(`   Aktiva bolag scannade:    ${active.toLocaleString()}`);
      console.log(`   Träff via NACE 41/42/43: ${byNace.toLocaleString()}`);
      if (opts.includeNameOnly)
        console.log(`   Träff via namn-keyword:  ${byName.toLocaleString()}`);
      console.log(`   TOTALT hantverkar-bolag: ${hits.toLocaleString()}`);
      resolve(rows);
    });

    stream.on("error", reject);
  });
}

// ════════════════════════════════════════════════════════════════════
// DB-write
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

function bulkUpsert(rows) {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO companies
      (place_id, name, branch, city, address, org_nr, sni_code,
       scraped_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
       datetime('now'), datetime('now'), datetime('now'))`
  );
  const update = db.prepare(
    `UPDATE companies SET
      name = COALESCE(NULLIF(name,''), ?),
      branch = COALESCE(branch, ?),
      city = COALESCE(NULLIF(city,''), ?),
      address = COALESCE(NULLIF(address,''), ?),
      org_nr = COALESCE(org_nr, ?),
      sni_code = COALESCE(sni_code, ?),
      updated_at = datetime('now')
     WHERE place_id = ?`
  );

  let added = 0,
    existing = 0;
  const tx = db.transaction((items) => {
    for (const c of items) {
      const placeId = `cro_ie_${c.companyNum}`;
      const address = joinAddress(c);
      const city = c.address4 || c.address3 || c.address2 || null;
      const sniCode = c.naceCode || null;

      const r = insert.run(placeId, c.name, c.branch, city, address, c.companyNum, sniCode);
      if (r.changes > 0) {
        added++;
      } else {
        update.run(c.name, c.branch, city, address, c.companyNum, sniCode, placeId);
        existing++;
      }
    }
  });

  // Process in chunks of 1000 for transaction performance
  for (let i = 0; i < rows.length; i += 1000) {
    tx(rows.slice(i, i + 1000));
  }
  return { added, existing };
}

// ════════════════════════════════════════════════════════════════════
// CSV-export
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Company",
  "Number",
  "Address",
  "Eircode",
  "NACE Code",
  "Branch",
  "Type",
  "Reg Date",
  "Status",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(rows, outPath) {
  const lines = [CSV_HEADERS.join(",")];
  rows.sort((a, b) => (a.branch || "").localeCompare(b.branch) || a.name.localeCompare(b.name));
  for (const c of rows) {
    lines.push(
      [
        c.name,
        c.companyNum,
        joinAddress(c),
        c.eircode,
        c.naceCode,
        c.branch,
        c.type,
        c.regDate,
        c.status,
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
    csv: null,
    out: null,
    skipDownload: false,
    includeNameOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--csv" && args[i + 1]) opts.csv = args[++i];
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
    else if (args[i] === "--skip-download") opts.skipDownload = true;
    else if (args[i] === "--include-name-only") opts.includeNameOnly = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const outPath = (opts.out || "~/Desktop/leads-ireland-hantverkare.csv").replace(
    /^~/,
    process.env.HOME
  );

  console.log("🇮🇪 simple-leads-ie — gratis bolagsdata via CRO open data\n");
  console.log(`   Output:           ${outPath}`);
  console.log(`   Inkludera namn-only: ${opts.includeNameOnly ? "ja" : "nej (bara NACE 41/42/43)"}`);
  console.log("");

  // ── Ladda data ──
  let csvPath = opts.csv;
  if (!csvPath) {
    if (opts.skipDownload && fs.existsSync(TMP_CSV)) {
      csvPath = TMP_CSV;
      console.log(`📂 Använder ${TMP_CSV} (skip-download)\n`);
    } else {
      console.log("⬇️  Steg 1/3: Hämta CRO open data");
      csvPath = downloadCroCsv();
      console.log("");
    }
  }

  // ── Processa CSV ──
  console.log("🔍 Steg 2/3: Filtrera hantverkar-bolag");
  ensureColumns();
  const rows = await processCsv(csvPath, opts);
  console.log("");

  // ── DB + CSV-export ──
  console.log("💾 Steg 3/3: Spara till leads.db + exportera CSV");
  const { added, existing } = bulkUpsert(rows);
  const exported = exportCsv(rows, outPath);
  console.log(`   DB:  +${added} nya, ${existing} uppdaterade`);
  console.log(`   CSV: ${exported.toLocaleString()} rader → ${outPath}`);
  console.log("");

  // ── Sammanfattning per branch ──
  const stats = getDb()
    .prepare(
      `SELECT branch, COUNT(*) AS antal
       FROM companies WHERE branch LIKE 'IE-%'
       GROUP BY branch ORDER BY antal DESC`
    )
    .all();
  console.log("📊 Sammanfattning per bransch:");
  let t = 0;
  for (const s of stats) {
    t += s.antal;
    console.log(`   ${s.branch.padEnd(25)} ${String(s.antal).padStart(6).toLocaleString()}`);
  }
  console.log(`   ${"─".repeat(35)}`);
  console.log(`   ${"TOTALT".padEnd(25)} ${String(t).padStart(6).toLocaleString()}`);
  console.log("");
  console.log("⚠️  Notera: CRO ger inte telefon/mejl/hemsida/VD.");
  console.log("    Detta är en lista med namn+adress. För kontaktinfo behövs");
  console.log("    SerpAPI/Google Maps eller manuell research per bolag.");
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
