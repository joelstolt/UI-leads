#!/usr/bin/env node
/**
 * export-hantverkare.js — Exportera ALLA hantverkar-relaterade leads
 * från leads.db till ett kombinerat CSV.
 *
 * Användning:
 *   node export-hantverkare.js                                  → ~/Desktop/hantverkare-alla.csv
 *   node export-hantverkare.js --out /annan/sökväg.csv
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

const BRANCHES = [
  // Originalbranscherna
  "Hantverkare",
  "Snickare",
  "Elektriker",
  "Takläggare",
  "Målare",
  "VVS",
  // Nya branscher (tillagda 2026-05-02)
  "Plåtslagare",
  "Glasmästare",
  "Markarbeten",
  "Sanering",
  "Tapetserare",
  "Smed",
  "Pool & Spa",
  "Solskydd & Markiser",
  "Isolering",
  "Trädgård & Anläggning",
  "Fasadrenovering",
  // Smart-search (industri-namn-baserade, från allabolag-taxonomin)
  "Byggmästare m.fl.",
  "Specialiserade hantverk",
  "Trävaror & Möbler",
  "Dörrar & Portar",
];

const HEADERS = [
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

function main() {
  const outIdx = process.argv.indexOf("--out");
  const outPath =
    outIdx !== -1 && process.argv[outIdx + 1]
      ? process.argv[outIdx + 1].replace(/^~/, process.env.HOME)
      : path.join(process.env.HOME, "Desktop", "hantverkare-alla.csv");

  const placeholders = BRANCHES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT name, firmatecknare, phone, email, website, org_nr,
              revenue, employees, address, sni_code, branch, city
       FROM companies WHERE branch IN (${placeholders})
       ORDER BY branch, city, name`
    )
    .all(...BRANCHES);

  const lines = [HEADERS.join(",")];
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

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");

  // Per-bransch sammanfattning
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
       FROM companies WHERE branch IN (${placeholders})
       GROUP BY branch ORDER BY antal DESC`
    )
    .all(...BRANCHES);

  console.log(`📄 Exporterad: ${outPath}  (${rows.length} rader)\n`);
  console.log("Per bransch:");
  let t = { antal: 0, vd: 0, tel: 0, mejl: 0, web: 0, komplett: 0 };
  for (const s of stats) {
    ["antal", "vd", "tel", "mejl", "web", "komplett"].forEach((k) => (t[k] += s[k]));
    console.log(
      `  ${s.branch.padEnd(13)} ${String(s.antal).padStart(5)} | VD ${String(s.vd).padStart(5)} | tel ${String(s.tel).padStart(5)} | web ${String(s.web).padStart(5)} | mejl ${String(s.mejl).padStart(5)} | KOMPL ${String(s.komplett).padStart(4)}`
    );
  }
  console.log(`  ${"─".repeat(82)}`);
  console.log(
    `  ${"TOTALT".padEnd(13)} ${String(t.antal).padStart(5)} | VD ${String(t.vd).padStart(5)} | tel ${String(t.tel).padStart(5)} | web ${String(t.web).padStart(5)} | mejl ${String(t.mejl).padStart(5)} | KOMPL ${String(t.komplett).padStart(4)}`
  );
}

main();
