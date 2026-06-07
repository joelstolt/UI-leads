#!/usr/bin/env node
/**
 * detect-electrician-chains.js
 *
 * Fetchar hemsidan för alla elektriker i givet segment och flaggar
 * is_chain=1 på de som visar koncern-signaler (Instalco, Storskogen,
 * Bravida-ägt, flera kontor, etc).
 *
 * Användning: node detect-electrician-chains.js
 */

const { getDb } = require("./db");
const pLimit = require("p-limit");

const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 8;

const CHAIN_KEYWORDS = [
  // Holding-koncerner
  "instalco",
  "storskogen",
  // Stora installation-koncerner
  "bravida",
  "caverion",
  "assemblin",
  "elajo",
  "rejlers",
  "imtech",
  "one nordic",
  "vattenfall services",
  "eitech",
  "fortum",
  "sandbäckens",
  // Grossister (om de skulle dyka upp)
  "rexel",
  "ahlsell",
  "elektroskandia",
  "selga",
  "storel",
  "onninen",
];

const CHAIN_PHRASES = [
  "del av instalco",
  "ingår i instalco",
  "instalcokoncernen",
  "del av storskogen",
  "ingår i storskogen",
  "storskogen-koncernen",
  "ett bolag i instalco",
  "ett bolag inom instalco",
  "del av bravida",
  "del av caverion",
  "del av assemblin",
  "del av elajo",
  "moderbolag",
  "moderbolaget",
  "vi är en del av",
];

const SWEDISH_CITIES = [
  "stockholm", "göteborg", "malmö", "uppsala", "västerås", "örebro",
  "linköping", "helsingborg", "jönköping", "norrköping", "lund", "umeå",
  "gävle", "borås", "eskilstuna", "halmstad", "växjö", "karlstad",
  "sundsvall", "luleå", "skellefteå", "trollhättan", "östersund",
  "kristianstad", "kalmar", "falun", "skövde", "karlskrona", "varberg",
  "uddevalla", "ängelholm", "motala", "trelleborg", "ystad", "visby",
];

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 250_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function detectChain(html, ownName) {
  if (!html) return null;
  const lower = html.toLowerCase();
  const reasons = [];

  for (const phrase of CHAIN_PHRASES) {
    if (lower.includes(phrase)) {
      reasons.push(`phrase:"${phrase}"`);
      break;
    }
  }

  const ownLower = (ownName || "").toLowerCase();
  for (const kw of CHAIN_KEYWORDS) {
    if (ownLower.includes(kw)) continue;
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const context = lower.slice(Math.max(0, idx - 80), idx + 120);
    if (
      /(del av|ingår i|koncern|ägar|moderbolag|bolag i|del i|ägs av|tillhör)/.test(
        context
      )
    ) {
      reasons.push(`keyword-in-ownership-context:${kw}`);
    }
  }

  const cityHits = new Set();
  for (const city of SWEDISH_CITIES) {
    const pattern = new RegExp(`\\b${city}\\b`, "g");
    const matches = lower.match(pattern);
    if (matches && matches.length > 0) cityHits.add(city);
  }
  if (cityHits.size >= 5) {
    reasons.push(`multi-city:${cityHits.size}`);
  }

  if (/(våra kontor|våra avdelningar|kontor i hela|kontor över hela|filialer i)/i.test(
    html
  )) {
    reasons.push("multi-location-text");
  }

  return reasons.length > 0 ? reasons.join("; ") : null;
}

async function main() {
  const db = getDb();

  const targets = db
    .prepare(
      `SELECT place_id, name, website
       FROM companies
       WHERE branch = 'Elektriker'
         AND website IS NOT NULL AND website != ''
         AND (is_chain IS NULL OR is_chain = 0)
         AND revenue BETWEEN 5000000 AND 50000000
         AND employees >= 7
       ORDER BY (COALESCE(rating,0) * COALESCE(reviews,0)) DESC`
    )
    .all();

  console.log(`\n🔍 Skannar ${targets.length} elektriker-sajter...\n`);

  const limit = pLimit(CONCURRENCY);
  const updateStmt = db.prepare(
    `UPDATE companies SET is_chain = 1, chain_reason = ?, updated_at = datetime('now') WHERE place_id = ?`
  );

  let done = 0;
  let chains = 0;
  let failed = 0;

  const results = await Promise.all(
    targets.map((row) =>
      limit(async () => {
        const html = await fetchHtml(row.website);
        if (!html) {
          failed++;
          done++;
          if (done % 25 === 0)
            console.log(`   ${done}/${targets.length}  (kedjor: ${chains}, fail: ${failed})`);
          return { ...row, reason: null, failed: true };
        }
        const reason = detectChain(html, row.name);
        if (reason) {
          chains++;
          updateStmt.run(reason, row.place_id);
        }
        done++;
        if (done % 25 === 0)
          console.log(`   ${done}/${targets.length}  (kedjor: ${chains}, fail: ${failed})`);
        return { ...row, reason };
      })
    )
  );

  console.log(`\n✅ Klart. Skannat ${done} sajter.`);
  console.log(`   Kedjor flaggade:  ${chains}`);
  console.log(`   Sajter som dog:   ${failed}\n`);

  if (chains > 0) {
    console.log(`📋 Flaggade som kedja:\n`);
    for (const r of results.filter((r) => r.reason)) {
      console.log(`   - ${r.name}`);
      console.log(`     ${r.website}`);
      console.log(`     → ${r.reason}\n`);
    }
  }
}

main().catch((err) => {
  console.error("FEL:", err);
  process.exit(1);
});
