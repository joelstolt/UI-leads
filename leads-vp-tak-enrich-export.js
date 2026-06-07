#!/usr/bin/env node
/**
 * leads-vp-tak-enrich-export.js — Steg 2+3/3 för "100 leads: värmepump + takläggare".
 *
 * Läser output/vp-tak-candidates.json, väljer 100 leads (alla värmepump +
 * största takläggarna efter omsättning), hämtar Google-recensioner via SerpAPI
 * (google_maps), och exporterar en bred CSV + enrich:ad JSON.
 *
 * SerpAPI: 1 anrop per bolag (1 sökning av kvoten). Kräver SERPAPI_KEY i .env.
 *
 * Flaggor:
 *   --limit 100      hur många leads totalt (default 100)
 *   --no-serp        hoppa över Google-enrichment (bara allabolag-data → CSV)
 */

require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");

const API_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE = "https://serpapi.com/search.json";
const CANDIDATES = path.join(__dirname, "output", "vp-tak-candidates.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    limit: 0, maxNew: Infinity, serp: true,
    paceMs: 18000,      // 18s mellan lyckade anrop ≈ 200/h (Starter-planens tak)
    backoffMs: 120000,  // vänta 2 min vid 429 (timfönstret rullar)
    max429: 40,         // ge upp efter så många 429-väntor i rad (~80 min)
    maxMinutes: 0,      // 0 = ingen tidsgräns
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--limit" && a[i + 1]) o.limit = parseInt(a[++i], 10);
    else if (a[i] === "--max-new" && a[i + 1]) o.maxNew = parseInt(a[++i], 10);
    else if (a[i] === "--pace-ms" && a[i + 1]) o.paceMs = parseInt(a[++i], 10);
    else if (a[i] === "--max-minutes" && a[i + 1]) o.maxMinutes = parseInt(a[++i], 10);
    else if (a[i] === "--no-serp") o.serp = false;
  }
  return o;
}

// ── Urval: värmepump först (efter omsättning), sedan takläggare (efter omsättning).
//    limit=0 → alla kandidater. ──
function selectLeads(candidates, limit) {
  const byRev = (a, b) => (b.revenueTkr || 0) - (a.revenueTkr || 0);
  const vp = candidates.filter((c) => c.branch === "Värmepumpar").sort(byRev);
  const tak = candidates.filter((c) => c.branch === "Takläggare").sort(byRev);
  const picked = [...vp, ...tak];
  return limit > 0 ? picked.slice(0, limit) : picked;
}

// ── Cache: återanvänd Google-data från tidigare exporter (per orgnr) ──
function loadCache() {
  const dir = path.join(__dirname, "output");
  const cache = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^leads-varmepump-takl.*\.json$/.test(f));
  } catch {}
  for (const f of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      // Cacha bara lyckade uppslag (matchade ELLER genuint tomma) — INTE fel (t.ex. 429),
      // så att felade anrop görs om vid nästa körning.
      for (const l of arr) if (l.orgnr && l.google && !l.google.error) cache.set(l.orgnr, l.google);
    } catch {}
  }
  return cache;
}

// ── Namnmatchning för att verifiera rätt Google-träff ──
function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\b(ab|aktiebolag|hb|kb|i|och|&)\b/g, " ")
    .replace(/[^a-zåäö0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function nameSim(a, b) {
  const A = new Set(normName(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(normName(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  const common = [...A].filter((w) => B.has(w)).length;
  return common / Math.min(A.size, B.size);
}

async function googleLookup(name, municipality) {
  const params = new URLSearchParams({
    engine: "google_maps",
    q: `${name} ${municipality || ""}`.trim(),
    type: "search",
    hl: "sv",
    gl: "se",
    api_key: API_KEY,
  });
  // Fail-fast på 429 (Starter-planens timgräns på 200/h) — yttre loopen sköter väntan
  const res = await fetch(`${SERPAPI_BASE}?${params}`, { signal: AbortSignal.timeout(25000) });
  if (res.status === 429) throw new Error("HTTP 429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) {
    if (/throttl|per hour|429/i.test(data.error)) throw new Error("HTTP 429");
    throw new Error(data.error);
  }

  // Antingen direkt place_results (exakt träff) eller lista
  let place = data.place_results && Object.keys(data.place_results).length ? data.place_results : null;
  if (!place) {
    const list = data.local_results || [];
    // Välj bästa namnmatch bland topp 5
    let best = null, bestScore = 0;
    for (const p of list.slice(0, 5)) {
      const s = nameSim(name, p.title);
      if (s > bestScore) { best = p; bestScore = s; }
    }
    if (best && bestScore >= 0.5) place = best;
    else if (list[0] && nameSim(name, list[0].title) >= 0.34) place = list[0];
  }
  if (!place) return { matched: false };

  return {
    matched: true,
    matchName: place.title || null,
    rating: place.rating ?? null,
    reviews: place.reviews ?? null,
    category: place.type || (Array.isArray(place.types) ? place.types[0] : null) || null,
    googleWebsite: place.website || null,
    googleAddress: place.address || null,
    openState: place.open_state || place.hours || null,
    placeId: place.place_id || null,
    nameMatchScore: place.title ? Number(nameSim(name, place.title).toFixed(2)) : null,
  };
}

// ── CSV ──
const HEADERS = [
  "Företag", "Bransch", "Telefon", "Mobil", "E-post", "Hemsida",
  "Google-betyg", "Google-recensioner", "Har Google-recensioner", "Google-kategori",
  "Omsättning (Mkr)", "Vinst (tkr)", "Bokslut", "Anställda",
  "Kontaktperson", "Roll", "Ort", "Län", "Adress", "Orgnr",
  "Bransch (allabolag)", "Beskrivning", "Marknadsföringsspärr", "Status", "Google Maps",
];
const esc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toRow(c) {
  const g = c.google || {};
  let hasReviews;
  if (g.reviews != null && g.reviews > 0) hasReviews = "Ja";
  else if (g.matched) hasReviews = "Nej (0 recensioner)";
  else if (g.pending || g.error) hasReviews = "Ej kontrollerad (SerpAPI-timgräns)";
  else hasReviews = "Nej (ej på Google)";
  const mapsUrl = g.placeId ? `https://www.google.com/maps/place/?q=place_id:${g.placeId}` : "";
  return [
    c.name, c.branch, c.phone, c.mobile, c.email, c.homepage || g.googleWebsite,
    g.rating ?? "", g.reviews ?? "", hasReviews, g.category ?? "",
    c.revenueTkr != null ? (c.revenueTkr / 1000).toFixed(1) : "", c.profitTkr ?? "", c.accountsDate, c.employees,
    c.contactName, c.contactRole, c.municipality, c.county, c.address, c.orgnr,
    (c.industriesAll || []).join("; "), c.description, c.marketingBlock ? "JA — spärrad" : "Nej", c.status, mapsUrl,
  ].map(esc).join(",");
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(CANDIDATES)) {
    console.error(`❌ Hittar inte ${path.relative(__dirname, CANDIDATES)} — kör leads-vp-tak-discover.js först.`);
    process.exit(1);
  }
  if (opts.serp && !API_KEY) {
    console.error("❌ Saknar SERPAPI_KEY i .env (eller kör med --no-serp).");
    process.exit(1);
  }

  const candidates = JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));
  let leads = selectLeads(candidates, opts.limit);
  const cache = loadCache();

  const vpN = leads.filter((l) => l.branch === "Värmepumpar").length;
  const takN = leads.filter((l) => l.branch === "Takläggare").length;
  const cachedAvail = leads.filter((l) => cache.has(l.orgnr)).length;
  const uncached = leads.length - cachedAvail;
  const willEnrich = opts.serp ? Math.min(uncached, opts.maxNew) : 0;

  console.log(`🎯 Steg 2+3: ${leads.length} kandidater (Värmepumpar: ${vpN}, Takläggare: ${takN})`);
  console.log(`   Cache (gratis återanvändning): ${cachedAvail}`);
  console.log(`   Nya SerpAPI-anrop: ${opts.serp ? willEnrich : "0 (--no-serp)"}${opts.maxNew !== Infinity ? ` (budgettak ${opts.maxNew})` : ""}`);
  if (opts.serp && uncached > opts.maxNew) {
    console.log(`   ⚠️  ${uncached - opts.maxNew} bolag ryms ej i budgeten — exkluderas ur listan.`);
  }
  console.log("");

  // Output-sökvägar + skrivfunktion (för inkrementell sparning)
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, "output");
  const csvPath = path.join(outDir, `leads-varmepump-takläggare-${stamp}.csv`);
  const jsonPath = path.join(outDir, `leads-varmepump-takläggare-${stamp}.json`);
  const writeOutputs = () => {
    fs.writeFileSync(csvPath, "﻿" + [HEADERS.join(","), ...leads.map(toRow)].join("\n") + "\n");
    fs.writeFileSync(jsonPath, JSON.stringify(leads, null, 2));
  };

  // Pass 1 — återanvänd cache (gratis, inga API-anrop)
  for (const c of leads) if (cache.has(c.orgnr)) c.google = cache.get(c.orgnr);

  // Pass 2 — självpacande ifyllning (≤200/h), retry samma bolag vid 429, inkrementell sparning
  let newCalls = 0;
  if (opts.serp) {
    const todo = leads.filter((c) => !c.google);
    const startMs = Date.now();
    let consec429 = 0, i = 0;
    while (i < todo.length && newCalls < opts.maxNew) {
      if (opts.maxMinutes && (Date.now() - startMs) / 60000 >= opts.maxMinutes) {
        console.log(`\n   ⏱  Tidsbudget (${opts.maxMinutes} min) nådd — stannar, resten markeras ej kontrollerade.`);
        break;
      }
      const c = todo[i];
      try {
        c.google = await googleLookup(c.name, c.municipality);
        consec429 = 0;
        newCalls++; i++;
        const g = c.google;
        const tag = g.matched ? `★${g.rating ?? "–"} (${g.reviews ?? 0} rec)` : "ingen träff";
        process.stdout.write(`\r   [${newCalls}/${todo.length}] ${c.name.slice(0, 30).padEnd(30)} ${tag.padEnd(18)}   `);
        if (newCalls % 10 === 0) writeOutputs(); // spara löpande
        await sleep(opts.paceMs);
      } catch (e) {
        if (/429/.test(e.message)) {
          if (++consec429 > opts.max429) {
            console.log(`\n   🛑 Timgränsen kvarstår efter ${consec429} försök — markerar resten som ej kontrollerade.`);
            break;
          }
          process.stdout.write(`\r   ⏸  SerpAPI-timgräns (200/h) — väntar ${Math.round(opts.backoffMs / 1000)}s, retry samma bolag (försök ${consec429})        `);
          await sleep(opts.backoffMs); // vänta tills timfönstret rullar, försök samma bolag igen
        } else {
          c.google = { matched: false, error: e.message };
          newCalls++; i++;
        }
      }
    }
  }

  // Markera ej-hämtade ärligt som "pending" så hela listan kommer med
  for (const c of leads) if (!c.google) c.google = { matched: false, pending: true };
  writeOutputs();

  const matched = leads.filter((l) => l.google?.matched).length;
  const withReviews = leads.filter((l) => (l.google?.reviews || 0) > 0).length;
  const pending = leads.filter((l) => l.google?.pending).length;
  console.log(`\n\n   ✅ Google: ${matched} matchade, ${withReviews} med recensioner, ${pending} ej kontrollerade (timgräns) — ${newCalls} nya anrop denna körning`);

  console.log(`\n📄 Exporterat:`);
  console.log(`   ${path.relative(__dirname, csvPath)}  (${leads.length} leads)`);
  console.log(`   ${path.relative(__dirname, jsonPath)}`);
  console.log(`\n📊 Sammanfattning:`);
  console.log(`   Med Google-recensioner:      ${withReviews}/${leads.length}`);
  console.log(`   Ej kontrollerade (timgräns): ${pending}/${leads.length}`);
  console.log(`   Med e-post:                  ${leads.filter((l) => l.email).length}/${leads.length}`);
  console.log(`   Med hemsida:                 ${leads.filter((l) => l.homepage || l.google?.googleWebsite).length}/${leads.length}`);
  console.log(`   Marknadsföringsspärr:        ${leads.filter((l) => l.marketingBlock).length}/${leads.length}`);
}

main().catch((e) => { console.error("\n❌ Fel:", e.message || e); process.exit(1); });
