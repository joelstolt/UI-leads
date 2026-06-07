#!/usr/bin/env node
/**
 * redo-pilot/filter.js — markerar prospects som redovisnings-kedjor och
 * applicerar sweet spot-filter: 5–15 MSEK omsättning + 3–10 anställda.
 *
 * Inget raderas — vi markerar `is_chain=1` så att score-/export-stegen
 * kan filtrera bort dem. Sweet-spot-resultatet rapporteras bara, det
 * appliceras i score-/export-stegen.
 *
 * Användning:
 *   node redo-pilot/filter.js                  → markera kedjor + rapportera sweet spot
 *   node redo-pilot/filter.js --reset          → nollställ is_chain först
 *   node redo-pilot/filter.js --dry-run        → visa utan att uppdatera DB
 */

const { getDb } = require("./db");
const { REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX } = require("./config");

// Redovisnings-kedjor + stora byråer som ej är "lägst hängande"
const CHAIN_PATTERNS = [
  // Big 4 / Top 10
  "pwc", "pricewaterhousecoopers",
  "kpmg",
  "ey", "ernst & young", "ernst och young",
  "deloitte",
  "bdo", " bdo ",
  "grant thornton",
  "mazars",
  "rsm",
  "baker tilly",
  "moore stephens",

  // Kedjor i SE
  "aspia",
  "lrf konsult", "lrf-konsult",
  "ludvig & co", "ludvig och co", "ludvig&co",
  "azets",
  "visma advisor", "visma byrå", "vismabyrå",
  "wint ",
  "björn lundén", "bjorn lunden", "björn lundén information",
  "fortnox byrå", "fortnox advisor",
  "skattegruppen",
  "redovisningshuset",
  "spar finans",
  "ecit ", "ecit ab",
  "leinonen",
  "valegårdh", "valegårdh redovisning",

  // Övriga större (>50 anst eller franchise)
  "matrisen",
  "matrisredovisning",
  "audire", "audire revision",
  "auditcom",
  "frantzén & dahlén",
  "frejs revisorer",
  "mazars set", "mazars setrevision",
  "öhrlings",
  "haglund & son",
];

function ensureColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(prospects)").all().map((r) => r.name);
  if (!cols.includes("is_chain")) {
    db.exec("ALTER TABLE prospects ADD COLUMN is_chain INTEGER DEFAULT 0;");
  }
  if (!cols.includes("chain_reason")) {
    db.exec("ALTER TABLE prospects ADD COLUMN chain_reason TEXT;");
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    reset: args.includes("--reset"),
  };
}

function markChains(opts) {
  const db = getDb();
  let total = 0;
  console.log("🔗 Markerar redovisnings-kedjor:\n");

  for (const pattern of CHAIN_PATTERNS) {
    const escaped = pattern.replace(/'/g, "''");
    const rows = db
      .prepare(
        `SELECT org_nr, name FROM prospects
         WHERE LOWER(name) LIKE '%${escaped}%'
           AND (is_chain IS NULL OR is_chain = 0)`
      )
      .all();
    if (rows.length === 0) continue;
    console.log(`   ${String(rows.length).padStart(3)}× "${pattern}"`);
    if (!opts.dryRun) {
      const stmt = db.prepare(
        `UPDATE prospects SET is_chain = 1, chain_reason = ?, updated_at = datetime('now')
         WHERE org_nr = ?`
      );
      const tx = db.transaction((items) => {
        for (const r of items) stmt.run(`pattern:${pattern}`, r.org_nr);
      });
      tx(rows);
    }
    total += rows.length;
  }
  console.log(`\n   Totalt markerade kedjor: ${total}\n`);
  return total;
}

function reportSweetSpot() {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_chain = 1 THEN 1 ELSE 0 END) AS chains,
        SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS with_site,
        SUM(CASE WHEN revenue BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_revenue,
        SUM(CASE WHEN employees BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_employees,
        SUM(CASE WHEN revenue BETWEEN ? AND ?
                  AND employees BETWEEN ? AND ?
                  AND website IS NOT NULL AND website != ''
                  AND (is_chain IS NULL OR is_chain = 0)
                 THEN 1 ELSE 0 END) AS sweet_spot
      FROM prospects`
    )
    .get(
      REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX,
      REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX
    );

  const msek = (n) => `${(n / 1_000_000).toFixed(0)} MSEK`;
  console.log("📊 Sweet-spot-rapport:");
  console.log(`   Totalt i DB:                       ${r.total}`);
  console.log(`   Kedjor (exkluderas):               ${r.chains}`);
  console.log(`   Med hemsida:                       ${r.with_site}`);
  console.log(`   Inom ${msek(REVENUE_MIN)}–${msek(REVENUE_MAX)}:                  ${r.in_revenue}`);
  console.log(`   Inom ${EMPLOYEES_MIN}–${EMPLOYEES_MAX} anställda:                 ${r.in_employees}`);
  console.log(`   ─────────────────────────────`);
  console.log(`   I SWEET SPOT (alla krav):          ${r.sweet_spot} ← går till enrich`);
}

function main() {
  ensureColumns();
  const opts = parseArgs();

  if (opts.reset && !opts.dryRun) {
    const r = getDb()
      .prepare("UPDATE prospects SET is_chain = 0, chain_reason = NULL")
      .run();
    console.log(`🔄 Nollställde is_chain på ${r.changes} rader\n`);
  }

  markChains(opts);
  reportSweetSpot();
}

main();
