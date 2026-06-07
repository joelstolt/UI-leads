#!/usr/bin/env node
/**
 * mark-chains.js — markerar kedje-bolag (is_chain=1) så de kan filtreras bort.
 *
 * Två detektionsmetoder:
 *   1. Hårdkodad blocklist av kända kedjor (case-insensitive prefix-match)
 *   2. Auto-detection: namn som förekommer 5+ gånger i olika städer
 *
 * Användning:
 *   node mark-chains.js                          → markerar alla matchande bolag
 *   node mark-chains.js --dry-run                → visa vad som SKULLE markeras
 *   node mark-chains.js --threshold 3            → auto-detect vid 3+ förekomster (default 5)
 *   node mark-chains.js --reset                  → nollställ is_chain först
 */

const { getDb } = require("./db");

// ════════════════════════════════════════════════════════════════════
// Hårdkodad blocklist — kända svenska kedjor
// (matchar i lowercase mot bolagsnamnet, även om bolaget heter "X (Stad)" etc)
// ════════════════════════════════════════════════════════════════════

const CHAIN_PATTERNS = [
  // Snabbmat
  "mcdonald", "max hamburger", "max burger", "max ", "burger king",
  "sibylla", "frasses", "bastard burgers", "kfc", "subway",
  "carl's jr", "chick-fil-a", "five guys",
  // Pizza
  "pizza hut", "domino's pizza", "dominos pizza", "vapiano",
  "papa john", "calzone king",
  // Café/coffee
  "espresso house", "wayne's coffee", "waynes coffee", "starbucks",
  "joe and the juice", "café nero", "cafe nero", "stora coffee",
  "mood coffee", "barista fair trade", "il caffè",
  // Sushi-kedjor
  "sushi yama", "sushi way", "sticks'n'sushi", "tako sushi",
  "wok and roll", "yo! sushi", "yo sushi",
  // Restauranger
  "o'learys", "olearys", "harry's", "harrys ", "tgi fridays",
  "texas longhorn", "pinchos", "boulebar", "pizza italia",
  "vapiano", "indian side", "thaikitchen",
  // Pub/Bar-kedjor
  "the bishop", "the bishop's arms", "bishops arms", "tabbouli",
  // Conv/butiker (kan dyka upp i café-sökning)
  "pressbyrån", "pressbyran", "7-eleven", "seven eleven", "7eleven",
  "ica nära", "ica supermarket", "coop konsum",
  // Hotell-kedjor (ofta med restaurang)
  "scandic ", "elite hotel", "first hotel", "best western",
  "radisson", "clarion ", "comfort hotel", "quality hotel",
  // Stora kedjor med "AB" suffix
  "max ab", "sibylla ab", "espresso house sweden", "wayne's coffee sweden",
];

// ════════════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════════════

function ensureColumn() {
  const db = getDb();
  const cols = db
    .prepare("PRAGMA table_info(companies)")
    .all()
    .map((r) => r.name);
  if (!cols.includes("is_chain")) {
    db.exec("ALTER TABLE companies ADD COLUMN is_chain INTEGER DEFAULT 0;");
    console.log("   + Lade till kolumn: is_chain");
  }
  if (!cols.includes("chain_reason")) {
    db.exec("ALTER TABLE companies ADD COLUMN chain_reason TEXT;");
    console.log("   + Lade till kolumn: chain_reason");
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    reset: args.includes("--reset"),
    threshold: parseInt(args[args.indexOf("--threshold") + 1]) || 5,
  };
}

function markByPattern(opts) {
  const db = getDb();
  let total = 0;
  console.log("\n🔍 Markerar via blocklist (kända kedjor):\n");

  for (const pattern of CHAIN_PATTERNS) {
    const escaped = pattern.replace(/'/g, "''");
    const rows = db
      .prepare(
        `SELECT place_id, name FROM companies
         WHERE LOWER(name) LIKE '%${escaped}%'
           AND (is_chain IS NULL OR is_chain = 0)`
      )
      .all();
    if (rows.length === 0) continue;
    console.log(`   ${rows.length.toString().padStart(4)}× "${pattern}"`);
    if (!opts.dryRun) {
      const stmt = db.prepare(
        `UPDATE companies SET is_chain = 1, chain_reason = ?, updated_at = datetime('now') WHERE place_id = ?`
      );
      const tx = db.transaction((items) => {
        for (const r of items) stmt.run(`pattern:${pattern}`, r.place_id);
      });
      tx(rows);
    }
    total += rows.length;
  }
  console.log(`\n   ✅ Totalt via blocklist: ${total.toLocaleString()}`);
  return total;
}

function markByDuplicateName(opts) {
  const db = getDb();
  console.log(
    `\n🔍 Auto-detection: namn som förekommer ${opts.threshold}+ gånger:\n`
  );

  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS antal
       FROM companies
       WHERE name IS NOT NULL
         AND (is_chain IS NULL OR is_chain = 0)
       GROUP BY LOWER(name)
       HAVING antal >= ?
       ORDER BY antal DESC`
    )
    .all(opts.threshold);

  let total = 0;
  for (const r of rows.slice(0, 50)) {
    console.log(`   ${r.antal.toString().padStart(4)}× ${r.name}`);
  }
  if (rows.length > 50) console.log(`   ... och ${rows.length - 50} till`);

  if (!opts.dryRun) {
    const stmt = db.prepare(
      `UPDATE companies SET is_chain = 1, chain_reason = ? WHERE LOWER(name) = LOWER(?) AND (is_chain IS NULL OR is_chain = 0)`
    );
    const tx = db.transaction((items) => {
      for (const r of items)
        total += stmt.run(`duplicate-name:${r.antal}x`, r.name).changes;
    });
    tx(rows);
  } else {
    total = rows.reduce((s, r) => s + r.antal, 0);
  }
  console.log(`\n   ✅ Totalt via auto-detection: ${total.toLocaleString()}`);
  return total;
}

function summary() {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN is_chain = 1 THEN 1 ELSE 0 END) AS chains,
         COUNT(*) AS total,
         SUM(CASE WHEN is_chain = 1 AND branch LIKE 'SE-Hitta-%' THEN 1 ELSE 0 END) AS hitta_chains,
         SUM(CASE WHEN branch LIKE 'SE-Hitta-Restauranger%'
                  OR branch LIKE 'SE-Hitta-Pizzerior%'
                  OR branch LIKE 'SE-Hitta-Kaféer%'
                  OR branch LIKE 'SE-Hitta-Bistros%'
                  OR branch LIKE 'SE-Hitta-Sushi%' THEN 1 ELSE 0 END) AS resto_total,
         SUM(CASE WHEN is_chain = 1 AND (branch LIKE 'SE-Hitta-Restauranger%'
                  OR branch LIKE 'SE-Hitta-Pizzerior%'
                  OR branch LIKE 'SE-Hitta-Kaféer%'
                  OR branch LIKE 'SE-Hitta-Bistros%'
                  OR branch LIKE 'SE-Hitta-Sushi%') THEN 1 ELSE 0 END) AS resto_chains
       FROM companies`
    )
    .get();
  console.log(`\n📊 Sammanfattning:`);
  console.log(`   Totalt bolag i DB:           ${stats.total.toLocaleString()}`);
  console.log(`   Markerade som kedjor:        ${stats.chains.toLocaleString()} (${Math.round(stats.chains/stats.total*100)}%)`);
  console.log(`   Hitta-bolag som kedjor:      ${stats.hitta_chains.toLocaleString()}`);
  console.log(`   Restaurang-bolag totalt:     ${stats.resto_total.toLocaleString()}`);
  console.log(`   Restaurang-bolag som kedjor: ${stats.resto_chains.toLocaleString()}`);
}

async function main() {
  const opts = parseArgs();
  console.log("🔗 mark-chains — markerar kedjor i leads.db\n");
  console.log(`   Mode: ${opts.dryRun ? "DRY-RUN (visa bara)" : "skarp körning"}`);
  console.log(`   Auto-detect threshold: ${opts.threshold}+ förekomster`);

  ensureColumn();

  if (opts.reset && !opts.dryRun) {
    const r = getDb().prepare("UPDATE companies SET is_chain = 0, chain_reason = NULL").run();
    console.log(`\n   🔄 Nollställde is_chain på ${r.changes.toLocaleString()} rader`);
  }

  markByPattern(opts);
  markByDuplicateName(opts);
  summary();
}

main();
