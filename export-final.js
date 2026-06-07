#!/usr/bin/env node
/**
 * export-final.js — exporterar alla 4 CSV-filer med alla 21 kolumner.
 *   ~/Desktop/hantverkare-sverige-med-telefon.csv  (SE, bara med tel)
 *   ~/Desktop/leads-norge-hantverkare.csv          (NO)
 *   ~/Desktop/leads-ireland-hantverkare.csv        (IE)
 *   ~/Desktop/leads-alla-lander.csv                (SE+NO+IE)
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

const SE = [
  "Hantverkare", "Snickare", "Elektriker", "Takläggare", "Målare", "VVS",
  "Plåtslagare", "Glasmästare", "Markarbeten", "Sanering", "Tapetserare",
  "Smed", "Pool & Spa", "Solskydd & Markiser", "Isolering",
  "Trädgård & Anläggning", "Fasadrenovering", "Byggmästare m.fl.",
  "Specialiserade hantverk", "Trävaror & Möbler", "Dörrar & Portar",
];

const HEADERS = [
  "Företag",
  "VD",
  "Telefon",
  "Mejl",
  "Hemsida",
  "Orgnr",
  "Omsättning",
  "Anställda",
  "Adress",
  "SNI-kod",
  "Bransch",
  "Stad",
  "Tech-stack",
  "Tech-extra",
  "HTTPS",
  "Schema",
  "Chatbot",
  "Booking",
  "GA",
  "FB-pixel",
  "Cookie-banner",
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
    r.tech_stack,
    r.tech_extra,
    yn(r.tech_https),
    yn(r.tech_has_schema),
    r.chatbot,
    r.booking,
    yn(r.has_ga),
    yn(r.has_fb_pixel),
    yn(r.has_cookie_banner),
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

const seph = SE.map(() => "?").join(",");
const seRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies
     WHERE branch IN (${seph}) AND phone IS NOT NULL AND phone != ''
       AND (is_chain IS NULL OR is_chain = 0)
     ORDER BY branch, city, name`
  )
  .all(...SE);

const noRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies WHERE branch LIKE 'NO-%'
       AND (is_chain IS NULL OR is_chain = 0)
     ORDER BY branch, city, name`
  )
  .all();

const ieRows = getDb()
  .prepare(
    `SELECT ${COLS} FROM companies WHERE branch LIKE 'IE-%'
       AND (is_chain IS NULL OR is_chain = 0)
     ORDER BY branch, name`
  )
  .all();

console.log("📄 Exporterar CSV-filer med alla 21 kolumner:\n");
console.log(`  🇸🇪 SE: ${exportRows(seRows, path.join(home, "Desktop", "hantverkare-sverige-med-telefon.csv")).toLocaleString()} rader`);
console.log(`  🇳🇴 NO: ${exportRows(noRows, path.join(home, "Desktop", "leads-norge-hantverkare.csv")).toLocaleString()} rader`);
console.log(`  🇮🇪 IE: ${exportRows(ieRows, path.join(home, "Desktop", "leads-ireland-hantverkare.csv")).toLocaleString()} rader`);

const allRows = [...seRows, ...noRows, ...ieRows];
console.log(`  🌍 ALLA: ${exportRows(allRows, path.join(home, "Desktop", "leads-alla-lander.csv")).toLocaleString()} rader\n`);

// Sammanfattning per land
console.log("📊 Statistik per land:\n");
function stat(label, rows) {
  const t = rows.length;
  const web = rows.filter((r) => r.website).length;
  const mejl = rows.filter((r) => r.email).length;
  const tech = rows.filter((r) => r.tech_stack).length;
  const chatbot = rows.filter((r) => r.chatbot).length;
  const ga = rows.filter((r) => r.has_ga === 1).length;
  const fb = rows.filter((r) => r.has_fb_pixel === 1).length;
  const pct = (n) => (t > 0 ? Math.round((n / t) * 100) + "%" : "0%");
  console.log(`  ${label}`);
  console.log(`    Totalt:        ${t.toLocaleString()}`);
  console.log(`    Med hemsida:   ${web.toLocaleString()} (${pct(web)})`);
  console.log(`    Med mejl:      ${mejl.toLocaleString()} (${pct(mejl)})`);
  console.log(`    Tech-stack:    ${tech.toLocaleString()}`);
  console.log(`    Chatbot:       ${chatbot.toLocaleString()}`);
  console.log(`    Google Analytics: ${ga.toLocaleString()}`);
  console.log(`    FB Pixel:      ${fb.toLocaleString()}`);
  console.log("");
}

stat("🇸🇪 SVERIGE (med telefon)", seRows);
stat("🇳🇴 NORGE", noRows);
stat("🇮🇪 IRLAND", ieRows);

// Top tech-stack per land
console.log("📊 Top tech-stack i alla 3 länder:");
const techCount = {};
for (const r of allRows) {
  if (r.tech_stack) techCount[r.tech_stack] = (techCount[r.tech_stack] || 0) + 1;
}
const sorted = Object.entries(techCount).sort((a, b) => b[1] - a[1]);
for (const [stack, n] of sorted.slice(0, 10)) {
  console.log(`  ${stack.padEnd(15)} ${n.toLocaleString()}`);
}
