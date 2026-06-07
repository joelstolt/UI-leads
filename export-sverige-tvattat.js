#!/usr/bin/env node
/**
 * export-sverige-tvattat.js — strikt-filtrerade SE-listor med kvalitetsfilter.
 *
 * Producerar 4 filer:
 *   1. sverige-tvattat-mobil.csv          → mobil + mejl + hemsida (VD om finns)
 *   2. sverige-tvattat-mobil-rengjord.csv → samma som (1) men med skräpfiltrering
 *   3. sverige-tvattat-misstankt.csv      → de som filtrerades bort (manuell granskning)
 *   4. sverige-tvattat-alla-tel.csv       → fast OCH mobil (bredare net)
 *
 * Skräpfilter:
 *   • Mejl-domäner som är placeholders/template (loopia.com, minhemsida.se, etc)
 *   • Mejl till kommun/registrator (kommunstyrelsen@*, info@kommun*, etc)
 *   • Hemsidor på kommun-domäner (XX.kommun.se, kommun-namn.se)
 *   • Tracking/Sentry-skräp (2x.png, sentry-next.wixpress.com)
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");

const SE_BRANCHES = [
  "Hantverkare", "Snickare", "Elektriker", "Takläggare", "Målare", "VVS",
  "Plåtslagare", "Glasmästare", "Markarbeten", "Sanering", "Tapetserare",
  "Smed", "Pool & Spa", "Solskydd & Markiser", "Isolering",
  "Trädgård & Anläggning", "Fasadrenovering", "Byggmästare m.fl.",
  "Specialiserade hantverk", "Trävaror & Möbler", "Dörrar & Portar",
];

// ════════════════════════════════════════════════════════════════════
// Skräpfilter
// ════════════════════════════════════════════════════════════════════

// Mejl-domäner som är placeholders / template-skräp / tracking
const JUNK_EMAIL_DOMAINS = new Set([
  "loopia.com",
  "minhemsida.se",
  "domain.com",
  "example.com",
  "exempel.se",
  "mysite.com",
  "yourdomain.com",
  "2x.png",
  "1x.png",
  "telepathy.com",
  "stockholmsnation.se", // student-organisation, fångad fel
  "sentry-next.wixpress.com",
  "ingest.de.sentry.io",
  "ingest.us.sentry.io",
  "godaddy.com",
  "wix.com",
  "wixpress.com",
  "squarespace.com",
  "test.se",
  "testdomain.com",
]);

// Lokala-delar (innan @) som är registrator/kommun/admin
const JUNK_EMAIL_LOCALPARTS = [
  "kommunstyrelsen",
  "registrator",
  "kommun@",
  "kontaktcenter",
  "kommunenkontakt",
  "info@kommun",
  "kundtjanst@kommun",
  "diarium",
  "sentry",
  "name@",
  "namn@",
  "noreply",
  "no-reply",
  "donotreply",
];

// Kända svenska kommun-domäner som råkat matchas felaktigt
const KOMMUN_HOSTS = new Set([
  "alingsas.se","arvidsjaur.se","arvika.se","ekero.se","eksjo.se","eskilstuna.se",
  "eslov.se","gavle.se","goteborg.se","halmstad.se","helsingborg.se","huddinge.se",
  "jonkoping.se","kalmar.se","karlskrona.se","karlstad.se","kristianstad.se",
  "kungsbacka.se","linkoping.se","lund.se","malmo.se","malmö.se","malme.se",
  "norrkoping.se","orebro.se","sodertalje.se","solna.se","stockholm.se",
  "sundsvall.se","trelleborg.se","umea.se","uppsala.se","vasteras.se","växjö.se",
  "vaxjo.se","vasterbotten.se","ystad.se","angelholm.se","arrjang.se",
]);

function emailDomain(e) {
  if (!e) return "";
  const first = (e.split(",")[0] || "").trim();
  const m = first.match(/@([\w\.\-]+)/);
  return m ? m[1].toLowerCase() : "";
}

function emailLocal(e) {
  if (!e) return "";
  const first = (e.split(",")[0] || "").trim();
  return first.split("@")[0].toLowerCase();
}

function getHost(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function isMobile(phone) {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  if (/^07[0-9]/.test(digits)) return true;
  if (/^467[0-9]/.test(digits)) return true;
  if (/^00467[0-9]/.test(digits)) return true;
  return false;
}

function findIssues(row) {
  const issues = [];
  const ed = emailDomain(row.email);
  const el = emailLocal(row.email);
  const wh = getHost(row.website);

  // Mejl-domän
  if (JUNK_EMAIL_DOMAINS.has(ed)) issues.push(`junk-mejl-domän:${ed}`);
  for (const part of JUNK_EMAIL_LOCALPARTS) {
    if (el.includes(part) || row.email.toLowerCase().includes(part)) {
      issues.push(`generisk-mejl:${part}`);
      break;
    }
  }

  // Hemsida på kommun
  if (KOMMUN_HOSTS.has(wh)) issues.push(`kommun-domän:${wh}`);
  if (wh.endsWith(".kommun.se")) issues.push(`kommun-domän:${wh}`);
  if (wh.endsWith(".region.se")) issues.push(`region-domän:${wh}`);
  if (wh.endsWith(".gov.se") || wh.includes(".regeringen.se")) issues.push(`gov:${wh}`);

  // Mejl-domän skiljer sig FRÅN bolaget men matchar en känd skräp-domän?
  if (ed === wh && KOMMUN_HOSTS.has(ed)) issues.push(`kommun-mejl:${ed}`);

  return issues;
}

// ════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════

const HEADERS = [
  "Företag",
  "VD",
  "Mobil",
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

const HEADERS_MISSTANKT = [...HEADERS, "Anledning"];

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

function rowToCsvFields(r) {
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
  ];
}

function exportRows(rows, outPath, withReason = false, headers = HEADERS) {
  const lines = [headers.join(",")];
  for (const r of rows) {
    const fields = rowToCsvFields(r);
    if (withReason) fields.push(r._issues ? r._issues.join("; ") : "");
    lines.push(fields.map(csvEsc).join(","));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return rows.length;
}

const COLS = `
  name, firmatecknare, phone, email, website, org_nr, revenue, employees,
  address, sni_code, branch, city,
  tech_stack, tech_extra, tech_https, tech_has_schema,
  chatbot, booking, has_ga, has_fb_pixel, has_cookie_banner
`;

const seph = SE_BRANCHES.map(() => "?").join(",");

// Filter: mobil + mejl + hemsida (VD är NU optional, kedjor exkluderade)
const baseQuery = `
  SELECT ${COLS} FROM companies
  WHERE branch IN (${seph})
    AND phone IS NOT NULL AND phone != ''
    AND email IS NOT NULL AND email != ''
    AND website IS NOT NULL AND website != ''
    AND (is_chain IS NULL OR is_chain = 0)
  ORDER BY branch, city, name
`;

const allWithContacts = getDb().prepare(baseQuery).all(...SE_BRANCHES);

// Splitta i mobil-only vs alla-tel
const allMobile = allWithContacts.filter((r) => isMobile(r.phone));

// Tillämpa kvalitetsfilter på mobil-listan
const mobileClean = [];
const mobileSuspicious = [];
for (const r of allMobile) {
  const issues = findIssues(r);
  if (issues.length === 0) {
    mobileClean.push(r);
  } else {
    r._issues = issues;
    mobileSuspicious.push(r);
  }
}

const home = process.env.HOME;

const file1 = path.join(home, "Desktop", "sverige-tvattat-mobil.csv");
const file2 = path.join(home, "Desktop", "sverige-tvattat-mobil-rengjord.csv");
const file3 = path.join(home, "Desktop", "sverige-tvattat-misstankt.csv");
const file4 = path.join(home, "Desktop", "sverige-tvattat-alla-tel.csv");

const c1 = exportRows(allMobile, file1);
const c2 = exportRows(mobileClean, file2);
const c3 = exportRows(mobileSuspicious, file3, true, HEADERS_MISSTANKT);
const c4 = exportRows(allWithContacts, file4);

console.log("📄 Tvättade SE-listor exporterade:\n");
console.log(`   1. ${file1}`);
console.log(`        ${c1.toLocaleString()} bolag — alla med mobil + mejl + hemsida (VD valfritt)`);
console.log(`   2. ${file2}`);
console.log(`        ${c2.toLocaleString()} bolag — RENGJORD (skräp filtrerat bort) ⭐ använd den här`);
console.log(`   3. ${file3}`);
console.log(`        ${c3.toLocaleString()} bolag — MISSTÄNKT data (för manuell granskning)`);
console.log(`   4. ${file4}`);
console.log(`        ${c4.toLocaleString()} bolag — vilken telefon som helst (mobil + fast)\n`);

// Sammanfattning av varför saker filtrerats
console.log("📊 Anledningar varför bolag hamnade i MISSTÄNKT-listan:");
const reasonCount = {};
for (const r of mobileSuspicious) {
  for (const issue of r._issues) {
    const key = issue.split(":")[0];
    reasonCount[key] = (reasonCount[key] || 0) + 1;
  }
}
const sorted = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]);
for (const [reason, n] of sorted) {
  console.log(`   ${reason.padEnd(25)} ${n}`);
}

// Branschfördelning för rengjord-listan
console.log("\n📊 RENGJORD mobil-lista per bransch:");
const byBranch = {};
for (const r of mobileClean) {
  byBranch[r.branch] = (byBranch[r.branch] || 0) + 1;
}
const sortedBranches = Object.entries(byBranch).sort((a, b) => b[1] - a[1]);
for (const [b, n] of sortedBranches) {
  console.log(`   ${b.padEnd(28)} ${n}`);
}

// VD-stats
const withVd = mobileClean.filter((r) => r.firmatecknare).length;
const withoutVd = mobileClean.length - withVd;
console.log("\n📊 VD-fördelning i RENGJORD-listan:");
console.log(`   Med VD:    ${withVd}`);
console.log(`   Utan VD:   ${withoutVd}`);
