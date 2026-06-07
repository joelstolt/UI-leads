#!/usr/bin/env node
/**
 * export-varma.js — exporterar bara VARMA leads (telefon + mejl + hemsida ifyllda).
 *
 * Skapar 4 CSV-filer på skrivbordet:
 *   varma-leads-sverige.csv
 *   varma-leads-norge.csv
 *   varma-leads-irland.csv
 *   varma-leads-alla-lander.csv
 *
 * Alla filer:
 *   • Bara bolag med tel + mejl + web (alla tre fyllda)
 *   • Kedjor exkluderade (is_chain = 1 filtreras bort)
 *   • Alla 21 kolumner
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

const SE_OLD = [
  "Hantverkare", "Snickare", "Elektriker", "Takläggare", "Målare", "VVS",
  "Plåtslagare", "Glasmästare", "Markarbeten", "Sanering", "Tapetserare",
  "Smed", "Pool & Spa", "Solskydd & Markiser", "Isolering",
  "Trädgård & Anläggning", "Fasadrenovering", "Byggmästare m.fl.",
  "Specialiserade hantverk", "Trävaror & Möbler", "Dörrar & Portar",
];

const HEADERS = [
  "Företag", "VD", "Telefon", "Mejl", "Hemsida", "Orgnr", "Omsättning",
  "Anställda", "Adress", "SNI-kod", "Bransch", "Stad",
  "Tech-stack", "Tech-extra", "HTTPS", "Schema",
  "Chatbot", "Booking", "GA", "FB-pixel", "Cookie-banner",
];

const COLS = `
  name, firmatecknare, phone, email, website, org_nr, revenue, employees,
  address, sni_code, branch, city,
  tech_stack, tech_extra, tech_https, tech_has_schema,
  chatbot, booking, has_ga, has_fb_pixel, has_cookie_banner
`;

function csvEsc(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function yn(v) {
  if (v === 1) return "ja";
  if (v === 0) return "nej";
  return "";
}

function rowToCsv(r) {
  let vd = "";
  if (r.firmatecknare) {
    try {
      const a = JSON.parse(r.firmatecknare);
      vd = Array.isArray(a) ? a[0] || "" : "";
    } catch {
      vd = r.firmatecknare;
    }
  }
  return [
    r.name, vd, r.phone, r.email, r.website, r.org_nr, r.revenue, r.employees,
    r.address, r.sni_code, r.branch, r.city, r.tech_stack, r.tech_extra,
    yn(r.tech_https), yn(r.tech_has_schema), r.chatbot, r.booking,
    yn(r.has_ga), yn(r.has_fb_pixel), yn(r.has_cookie_banner),
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

const home = process.env.HOME;

// VARM-filter: tel + mejl + web alla ifyllda, ingen kedja
const VARM_FILTER = `
  phone IS NOT NULL AND phone != ''
  AND email IS NOT NULL AND email != ''
  AND website IS NOT NULL AND website != ''
  AND (is_chain IS NULL OR is_chain = 0)
`;

// SE: alla SE-branscher (allabolag + Hitta)
const seph = SE_OLD.map(() => "?").join(",");
const seRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies
     WHERE (branch IN (${seph}) OR branch LIKE 'SE-Hitta-%')
       AND ${VARM_FILTER}
     ORDER BY branch, city, name`
  )
  .all(...SE_OLD);

const noRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies WHERE branch LIKE 'NO-%' AND ${VARM_FILTER} ORDER BY branch, city, name`
  )
  .all();

const ieRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies WHERE branch LIKE 'IE-%' AND ${VARM_FILTER} ORDER BY branch, name`
  )
  .all();

const seFile = path.join(home, "Desktop", "varma-leads-sverige.csv");
const noFile = path.join(home, "Desktop", "varma-leads-norge.csv");
const ieFile = path.join(home, "Desktop", "varma-leads-irland.csv");
const allFile = path.join(home, "Desktop", "varma-leads-alla-lander.csv");

const seCount = exportRows(seRows, seFile);
const noCount = exportRows(noRows, noFile);
const ieCount = exportRows(ieRows, ieFile);
const allRows = [...seRows, ...noRows, ...ieRows];
const allCount = exportRows(allRows, allFile);

console.log("📄 VARMA leads exporterade (telefon + mejl + hemsida + ej kedja):\n");
console.log(`   🇸🇪 SVERIGE  ${seCount.toLocaleString().padStart(6)} leads → ${seFile}`);
console.log(`   🇳🇴 NORGE   ${noCount.toLocaleString().padStart(6)} leads → ${noFile}`);
console.log(`   🇮🇪 IRLAND  ${ieCount.toLocaleString().padStart(6)} leads → ${ieFile}`);
console.log(`   🌍 ALLA    ${allCount.toLocaleString().padStart(6)} leads → ${allFile}\n`);

// Branschfördelning
console.log("📊 SVERIGE per bransch:");
const seByBranch = {};
for (const r of seRows) {
  seByBranch[r.branch] = (seByBranch[r.branch] || 0) + 1;
}
Object.entries(seByBranch).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([b, n]) => {
  console.log(`   ${b.padEnd(35)} ${n.toLocaleString()}`);
});

console.log("\n📊 NORGE per bransch:");
const noByBranch = {};
for (const r of noRows) {
  noByBranch[r.branch] = (noByBranch[r.branch] || 0) + 1;
}
Object.entries(noByBranch).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([b, n]) => {
  console.log(`   ${b.padEnd(35)} ${n.toLocaleString()}`);
});

console.log("\n📊 IRLAND per bransch:");
const ieByBranch = {};
for (const r of ieRows) {
  ieByBranch[r.branch] = (ieByBranch[r.branch] || 0) + 1;
}
Object.entries(ieByBranch).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([b, n]) => {
  console.log(`   ${b.padEnd(35)} ${n.toLocaleString()}`);
});

// Tech-stack-fördelning bland varma
console.log("\n📊 Tech-stack i ALLA varma leads:");
const techCount = {};
for (const r of allRows) {
  const t = r.tech_stack || "(saknas)";
  techCount[t] = (techCount[t] || 0) + 1;
}
Object.entries(techCount).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([t, n]) => {
  console.log(`   ${t.padEnd(20)} ${n.toLocaleString()}`);
});
