#!/usr/bin/env node
/**
 * export-ehandel.js — CSV-leads för granska.io (tillgänglighetsdirektivet)
 *
 * Skriver tre filer till ~/Desktop:
 *   leads-ehandel-eaa-omfattas.csv   → omfattas av EAA (>10 anst ELLER >2M EUR)
 *   leads-ehandel-frivilligt.csv     → mindre bolag (frivillig anpassning)
 *   leads-ehandel-alla.csv           → båda i en fil med eaa_omfattas-kolumn
 *
 * EAA-tröskel: ≥10 anställda ELLER ≥2 000 000 EUR omsättning (≈22 MSEK).
 * Kommer från direktiv (EU) 2019/882 — micro-enterprise undantag.
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

const BRANCH = "E-handel";
const EAA_REVENUE_THRESHOLD_KR = 22_000_000; // ≈ 2M EUR @ 11 SEK/EUR
const EAA_EMPLOYEES_THRESHOLD = 10;

const HEADERS = [
  "Företag",
  "Hemsida",
  "Telefon",
  "Mejl",
  "Orgnr",
  "Omsättning (kr)",
  "Anställda",
  "Kommun",
  "Adress",
  "Primär bransch",
  "EAA omfattas",
  "Allabolag-länk",
];

function csvEsc(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isEaaCovered(r) {
  const emp = r.employees ?? 0;
  const rev = r.revenue ?? 0;
  return emp >= EAA_EMPLOYEES_THRESHOLD || rev >= EAA_REVENUE_THRESHOLD_KR;
}

function allabolagUrl(orgnr) {
  if (!orgnr) return "";
  const digits = String(orgnr).replace(/\D/g, "");
  return digits ? `https://www.allabolag.se/${digits}` : "";
}

function rowToCsv(r) {
  return [
    r.name,
    r.website,
    r.phone,
    r.email,
    r.org_nr,
    r.revenue,
    r.employees,
    r.city,
    r.address,
    r.sni_code,
    isEaaCovered(r) ? "ja" : "nej",
    allabolagUrl(r.org_nr),
  ]
    .map(csvEsc)
    .join(",");
}

function exportRows(rows, outPath) {
  const lines = [HEADERS.join(",")];
  for (const r of rows) lines.push(rowToCsv(r));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return rows.length;
}

const rows = getDb()
  .prepare(
    `SELECT name, website, phone, email, org_nr, revenue, employees,
            city, address, sni_code
       FROM companies
      WHERE branch = ?
      ORDER BY revenue DESC NULLS LAST, employees DESC NULLS LAST, name`
  )
  .all(BRANCH);

if (rows.length === 0) {
  console.log("Inga E-handel-bolag i DB ännu. Kör först:");
  console.log("  node simple-leads-ehandel.js");
  process.exit(0);
}

const eaa = rows.filter(isEaaCovered);
const voluntary = rows.filter((r) => !isEaaCovered(r));

const home = process.env.HOME;
const eaaPath = path.join(home, "Desktop", "leads-ehandel-eaa-omfattas.csv");
const volPath = path.join(home, "Desktop", "leads-ehandel-frivilligt.csv");
const allPath = path.join(home, "Desktop", "leads-ehandel-alla.csv");

console.log("📄 Exporterar E-handel-leads → granska.io\n");
console.log(`  EAA-omfattas:    ${exportRows(eaa, eaaPath).toLocaleString("sv-SE").padStart(6)} → ${eaaPath}`);
console.log(`  Frivillig:       ${exportRows(voluntary, volPath).toLocaleString("sv-SE").padStart(6)} → ${volPath}`);
console.log(`  Alla:            ${exportRows(rows, allPath).toLocaleString("sv-SE").padStart(6)} → ${allPath}`);
console.log();

const withSite = eaa.filter((r) => r.website).length;
const withPhone = eaa.filter((r) => r.phone).length;
const withEmail = eaa.filter((r) => r.email).length;
const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) + "%" : "0%");

console.log("📊 EAA-omfattas-bucketen:");
console.log(`   Totalt:        ${eaa.length.toLocaleString("sv-SE")}`);
console.log(`   Med hemsida:   ${withSite.toLocaleString("sv-SE")} (${pct(withSite, eaa.length)})`);
console.log(`   Med telefon:   ${withPhone.toLocaleString("sv-SE")} (${pct(withPhone, eaa.length)})`);
console.log(`   Med mejl:      ${withEmail.toLocaleString("sv-SE")} (${pct(withEmail, eaa.length)})`);

const noSite = eaa.filter((r) => !r.website).length;
if (noSite > 0) {
  console.log(`\n💡 ${noSite.toLocaleString("sv-SE")} EAA-bolag saknar hemsida i DB.`);
  console.log("   Kör: node enrich-se-website.js   för att hitta dem.");
}
