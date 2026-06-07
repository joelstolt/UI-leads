#!/usr/bin/env node
/**
 * leads-saljbolag-discover.js — Hitta POTENTIELLA KUNDER för lead-tjänsten (segmenterat).
 *
 * Dogfooding: använder leadsgoogle-motorn för att bygga en egen outbound-lista på
 * B2B-bolag som säljer tjänster och därför har nytta av färska leads.
 *
 * Precision via INDUSTRI-whitelist per segment (inte luddig fritext) → inget bygg-brus.
 * Tar BÅDE nystartade (inget bokslut än) och etablerade. Kräver kontaktkanal.
 *
 * Källa: allabolag.se /api/search (gratis). Sparar löpande (efter varje term) så att
 * ett ev. block mitt i körningen inte slänger resultatet.
 *
 *   node leads-saljbolag-discover.js                       # full körning (target 3000)
 *   node leads-saljbolag-discover.js --target 60 --max-pages 3   # smoke-test
 */

const fs = require("node:fs");
const path = require("node:path");

const ALLABOLAG = "https://www.allabolag.se";
const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (b, s = 0.3) => Math.round(b + (Math.random() * 2 - 1) * s * b);
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

const DELAY_MS = 1100;
const DEFAULT_MAX_PAGES = 50;
const DRY_PAGES = 6;
const DEFAULT_TARGET = 3000;

// Segment = (sökord för RECALL) + (industri-regex för PRECISION). Industrin är sanningen.
const SEGMENTS = [
  { key: "Telemarketing/Callcenter", tier: 1,
    terms: ["callcenter", "telemarketing", "mötesbokning", "säljbyrå", "säljbolag", "kundbearbetning"],
    industryRe: /callcenter|kontor- och teletj|telemarketing/i },
  { key: "Bemanning/Rekrytering", tier: 1,
    terms: ["bemanning", "rekrytering", "personaluthyrning", "rekryteringsföretag", "bemanningsföretag"],
    industryRe: /bemanning|rekryter|personaluthyrning|arbetsf[öo]rmedl/i },
  { key: "Reklam/Marknadsföring", tier: 1,
    terms: ["reklambyrå", "marknadsföring", "marknadsföringsbyrå", "mediebyrå", "pr-byrå", "digitalbyrå"],
    industryRe: /reklambyr|marknadsf[öo]ring|mediebyr|mediabyr|pr-?byr|reklam\b|kommunikationsbyr/i },
  { key: "Konsult/Företagsutveckling", tier: 2,
    terms: ["företagsutveckling", "managementkonsult", "affärsutveckling", "organisationskonsult"],
    industryRe: /f[öo]retagsutveckling|managementkonsult|aff[äa]rsutveckl|organisationskonsult|aff[äa]rskonsult/i },
  { key: "Försäkring/Finans", tier: 2,
    terms: ["försäkringsförmedlare", "försäkringsmäklare", "finansiell rådgivning", "försäkringsrådgivning"],
    industryRe: /f[öo]rs[äa]kringsf[öo]rmedl|f[öo]rs[äa]kringsm[äa]kl|finansiell r[åa]dg|f[öo]rs[äa]kringsr[åa]dg|f[öo]rs[äa]kringsbyr/i },
  { key: "Redovisning/Revision", tier: 2,
    terms: ["redovisningsbyrå", "bokföringsbyrå", "redovisning", "revisionsbyrå"],
    industryRe: /redovisning|bokf[öo]ring|revisionsbyr|revisor/i },
  { key: "IT/Webb", tier: 2,
    terms: ["it-konsult", "webbyrå", "systemutveckling", "datakonsult"],
    industryRe: /it-?konsult|webbyr|mjukvar|programvar|systemutveckl|datakonsult/i },
];

// Stark sälj-signal i NAMN → räddar uppenbara säljbolag vars industri är "fel" (t.ex. VIASALES)
const SALES_NAME_RE = /(\bsales\b|sälj(?!.*bygg)|telemarketing|callcenter|call ?center|mötesbok|leadgen|prospekt)/i;
// Säkerhetsnät: industrier som ALDRIG är köpare (WLM:s hantverkar-/industri-/retail-brus)
const NOISE_RE = /byggm[äa]star|elinstall|\bvvs\b|m[åa]leri|takl[äa]gg|snickeri|golv|datacenter|livsmedel|restaurang|caf[eé]|fris[öo]r|tandv[åa]rd|isoler|metall|m[öo]bler|konfektion|legotillverk|transport|[åa]keri|fastighetssk[öo]t|jordbruk|bilar|verkstad|el- och tele/i;

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { maxPages: DEFAULT_MAX_PAGES, target: DEFAULT_TARGET };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--max-pages" && a[i + 1]) o.maxPages = parseInt(a[++i]);
    if (a[i] === "--target" && a[i + 1]) o.target = parseInt(a[++i]);
  }
  return o;
}

let blocks = 0;
async function fetchPage(industry, page) {
  const url = `${ALLABOLAG}/api/search?industry=${encodeURIComponent(industry)}&page=${page}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": pickUA(), Accept: "application/json", "Accept-Language": "sv-SE,sv;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status === 503 || res.status === 403) {
      blocks++;
      const wait = Math.min(30 * Math.pow(2, attempt), 240);
      process.stdout.write(`\n   🚧 HTTP ${res.status} — backar ${wait}s\n`);
      if (blocks >= 8) throw new Error("Allabolag blockerar upprepat — avbryter (delresultat sparat).");
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) return { companies: [], pages: 0 };
    return res.json();
  }
  return { companies: [], pages: 0 };
}

const fmtOrgNr = (raw) => {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : null;
};
const toInt = (v) => {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
};

function classify(industryName, industriesAll, name) {
  const hay = [industryName, ...(industriesAll || [])].filter(Boolean).join(" | ");
  if (NOISE_RE.test(hay)) return null;
  for (const s of SEGMENTS) if (s.industryRe.test(hay)) return s.key;
  if (SALES_NAME_RE.test(name || "")) return "Telemarketing/Callcenter";
  return null;
}

function mapCompany(c) {
  const industriesAll = [...new Set((c.industries || []).map((i) => i.name).filter(Boolean))];
  const industryMain = c.currentIndustry?.name || industriesAll[0] || null;
  const name = c.name || c.legalName || "";
  const segment = classify(industryMain, industriesAll, name);
  if (!segment) return null;

  const va = c.visitorAddress || {};
  const address = [va.addressLine || va.boxAddressLine, va.zipCode, va.postPlace].filter(Boolean).join(", ");
  const bokslut = c.companyAccountsLastUpdatedDate || null;
  const remarks = (c.statusRemarks || []).filter((x) => typeof x === "string");
  const statusText = typeof c.status === "string" ? c.status : remarks.length ? remarks.join("; ") : "Aktiv";

  return {
    orgnr: fmtOrgNr(c.orgnr || c.companyId),
    name, segment,
    isNew: !bokslut,
    phone: c.phone || c.phone2 || null,
    mobile: c.mobile || c.mobile2 || null,
    email: c.email || null,
    homepage: c.homePage || null,
    revenueTkr: toInt(c.revenue),
    profitTkr: toInt(c.profit),
    employees: toInt(c.employees),
    bokslut,
    industryMain,
    sniCode: c.currentIndustry?.code || null,
    county: c.location?.county || null,
    municipality: c.location?.municipality || va.postPlace || null,
    address: address || null,
    contactName: c.contactPerson?.name || null,
    contactRole: c.contactPerson?.role || null,
    description: (c.description || "").replace(/\s+/g, " ").trim() || null,
    marketingBlock: c.marketingProtection === true,
    status: statusText,
  };
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  const headers = ["Företag", "Segment", "Status", "Org.nr", "Bransch", "SNI-kod", "Telefon", "Mobil", "E-post",
    "Hemsida", "Omsättning (Mkr)", "Vinst (tkr)", "Anställda", "Senaste bokslut", "Kontaktperson", "Roll",
    "Ort", "Län", "Adress", "Beskrivning", "Marknadsföringsspärr"];
  const lines = [headers.join(",")];
  for (const m of rows) {
    lines.push([m.name, m.segment, m.isNew ? "Nystartat" : "Etablerat", m.orgnr, m.industryMain, m.sniCode,
      m.phone, m.mobile, m.email, m.homepage, m.revenueTkr != null ? (m.revenueTkr / 1000).toFixed(1) : "",
      m.profitTkr ?? "", m.employees ?? "", m.bokslut ?? "", m.contactName, m.contactRole, m.municipality,
      m.county, m.address, m.description, m.marketingBlock ? "Ja" : "Nej"].map(csvEscape).join(","));
  }
  return lines.join("\n");
}

let OUT_BASE;
function save(seen) {
  const all = [...seen.values()].sort((a, b) => {
    if (a.segment !== b.segment) return a.segment.localeCompare(b.segment, "sv");
    if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
    return (b.revenueTkr || 0) - (a.revenueTkr || 0);
  });
  fs.writeFileSync(`${OUT_BASE}.json`, JSON.stringify(all, null, 2));
  fs.writeFileSync(`${OUT_BASE}.csv`, toCsv(all));
  return all;
}

async function discoverTerm(term, maxPages, target, seen, stats) {
  let page = 1, pages = 1, dry = 0;
  do {
    let data;
    try { data = await fetchPage(term, page); }
    catch (e) { process.stdout.write(`\n   ⚠️  ${term} s${page}: ${e.message}\n`); throw e; }
    const list = data.companies || [];
    pages = data.pages || 0;
    const before = seen.size;
    for (const c of list) {
      stats.raw++;
      const m = mapCompany(c);
      if (!m) { stats.filtered++; continue; }
      if (!m.orgnr) continue;
      if (!(m.phone || m.mobile || m.email || m.homepage)) { stats.noContact++; continue; }
      if (!seen.has(m.orgnr)) seen.set(m.orgnr, m);
    }
    const added = seen.size - before;
    dry = added > 0 ? 0 : dry + 1;
    process.stdout.write(`\r   ${term.padEnd(22)} s${String(page).padStart(2)}/${pages || "?"} — kvalade totalt: ${seen.size}    `);
    if (seen.size >= target) break;
    if (dry >= DRY_PAGES || page >= maxPages || page >= pages) break;
    page++;
    await sleep(jitter(DELAY_MS));
  } while (page <= pages);
  process.stdout.write("\n");
}

async function main() {
  const { maxPages, target } = parseArgs();
  const seen = new Map();
  const stats = { raw: 0, noContact: 0, filtered: 0 };
  const date = new Date().toISOString().slice(0, 10);
  OUT_BASE = path.join(__dirname, "output", `leads-potentiella-kunder-${date}`);
  fs.mkdirSync(path.dirname(OUT_BASE), { recursive: true });

  console.log("🔍 Discover: potentiella KUNDER (segmenterat, industri-filtrerat)\n");
  console.log(`   Mål: ${target} bolag · max ${maxPages} sidor/term\n`);

  try {
    outer: for (const seg of SEGMENTS) {
      console.log(`\n  ── ${seg.key} (tier ${seg.tier}) ──`);
      for (const term of seg.terms) {
        await discoverTerm(term, maxPages, target, seen, stats);
        save(seen); // löpande sparning
        if (seen.size >= target) { console.log(`\n  ✋ Mål (${target}) nått.`); break outer; }
      }
    }
  } catch (e) {
    console.log(`\n⚠️  Avbröt: ${e.message}`);
  }

  const all = save(seen);
  const bySeg = {}; const byNew = { Nystartat: 0, Etablerat: 0 };
  for (const m of all) { bySeg[m.segment] = (bySeg[m.segment] || 0) + 1; byNew[m.isNew ? "Nystartat" : "Etablerat"]++; }
  const ph = all.filter((m) => m.phone || m.mobile).length;

  console.log(`\n\n📊 Resultat: ${all.length} unika bolag`);
  console.log(`   Genomsökt: ${stats.raw} · bortfiltrerat (ej köpar-segment): ${stats.filtered} · (ingen kontakt): ${stats.noContact}`);
  console.log(`   Telefon: ${ph} (${Math.round(ph / all.length * 100)}%) · Etablerade: ${byNew.Etablerat} · Nystartade: ${byNew.Nystartat}`);
  console.log(`\n   Per segment:`);
  for (const [k, v] of Object.entries(bySeg).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}  ${k}`);
  console.log(`\n💾 ${path.relative(__dirname, OUT_BASE)}.csv (+ .json)`);
}

main().catch((e) => { console.error("\n❌", e.message || e); process.exit(1); });
