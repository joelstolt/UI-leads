#!/usr/bin/env node
/**
 * redo-pilot/discover.js — hämtar redovisnings-/bokförings-/revisionsbyråer
 * från allabolag.se för Malmö (eller annan stad via --city).
 *
 * Använder allabolag.se/api/search (samma som discover-allabolag.js gör).
 * Resultat sparas i leads-redo.db (separat DB).
 *
 * Användning:
 *   node redo-pilot/discover.js                    → Malmö, alla 3 queries
 *   node redo-pilot/discover.js --city Lund
 *   node redo-pilot/discover.js --max-pages 10     → max 10 sidor/query (250 bolag)
 */

require("dotenv").config({ override: true });
const { upsertProspect } = require("./db");
const { QUERIES } = require("./config");

const BASE = "https://www.allabolag.se/api/search";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "sv-SE,sv;q=0.9",
};

const DELAY_MS = 800;
const TIMEOUT_MS = 15000;
const MAX_PAGES_DEFAULT = 8; // 25/sida × 8 = 200 bolag/query

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatOrgNr(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw;
}

function normalizeWebsite(url) {
  if (!url) return null;
  const t = url.trim();
  if (!t) return null;
  return t.startsWith("http") ? t : `https://${t}`;
}

function mapRevenue(c) {
  if (c.revenue == null) return null;
  const n = parseFloat(String(c.revenue).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : Math.round(n * 1000); // tkr → kr
}

function pickIndustry(c) {
  const code = c.currentIndustry?.code || c.industries?.[0]?.code || null;
  const name = c.currentIndustry?.name || c.industries?.[0]?.name || null;
  return code ? `${code} ${name || ""}`.trim() : null;
}

function toProspect(c, city, query) {
  const orgnr = formatOrgNr(c.orgnr || c.customerId);
  if (!orgnr) return null;
  const address = [
    c.visitorAddress?.addressLine,
    c.visitorAddress?.zipCode,
    c.visitorAddress?.postPlace,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    org_nr: orgnr,
    name: c.name || c.legalName,
    city: c.location?.municipality || city,
    address: address || null,
    phone: c.phone || c.mobile || null,
    email: c.email || null,
    website: normalizeWebsite(c.homePage),
    sni_code: pickIndustry(c),
    revenue: mapRevenue(c),
    employees: c.employees ? parseInt(c.employees) || null : null,
    contact_person: c.contactPerson?.name || null,
    discovered_query: query,
  };
}

async function fetchPage(query, city, page) {
  const params = new URLSearchParams({
    industry: query,
    filter: `municipality:${city}`,
    page: String(page),
  });
  const url = `${BASE}?${params}`;
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function discoverQuery(query, city, maxPages) {
  let page = 1;
  let totalHits = 0;
  let totalPages = 0;
  let newCount = 0;
  let updCount = 0;

  while (page <= maxPages) {
    let data;
    try {
      data = await fetchPage(query, city, page);
    } catch (err) {
      console.warn(`   ⚠️  ${query}/${city} sida ${page}: ${err.message}`);
      break;
    }

    if (page === 1) {
      totalHits = data.hits ?? 0;
      totalPages = data.pages ?? 0;
      if (totalHits === 0) return { hits: 0, new: 0, updated: 0 };
    }

    const companies = data.companies || [];
    if (companies.length === 0) break;

    for (const c of companies) {
      const p = toProspect(c, city, query);
      if (!p) continue;
      const r = upsertProspect(p);
      if (r.isNew) newCount++;
      else updCount++;
    }

    if (page >= totalPages) break;
    page++;
    await sleep(DELAY_MS);
  }

  return { hits: totalHits, new: newCount, updated: updCount };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { city: "Malmö", maxPages: MAX_PAGES_DEFAULT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--city" && args[i + 1]) opts.city = args[++i];
    if (args[i] === "--max-pages" && args[i + 1])
      opts.maxPages = parseInt(args[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log("🔎 redo-pilot/discover — allabolag.se");
  console.log(`   Stad:      ${opts.city}`);
  console.log(`   Queries:   ${QUERIES.join(", ")}`);
  console.log(`   Max sidor: ${opts.maxPages}/query`);
  console.log();

  let grandNew = 0;
  let grandUpd = 0;
  let grandHits = 0;

  for (const q of QUERIES) {
    process.stdout.write(`   ${q.padEnd(20)} `);
    const r = await discoverQuery(q, opts.city, opts.maxPages);
    grandHits += r.hits;
    grandNew += r.new;
    grandUpd += r.updated;
    process.stdout.write(
      `${String(r.hits).padStart(4)} träffar · ${String(r.new).padStart(3)} nya · ${r.updated} uppd\n`
    );
    await sleep(DELAY_MS);
  }

  console.log();
  console.log(`✅ Discovery klar`);
  console.log(`   Träffar:     ${grandHits.toLocaleString("sv-SE")}`);
  console.log(`   Nya bolag:   ${grandNew.toLocaleString("sv-SE")}`);
  console.log(`   Uppdaterade: ${grandUpd.toLocaleString("sv-SE")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
