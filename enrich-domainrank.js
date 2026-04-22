/**
 * enrich-domainrank.js — Hämtar Domain Rank från OpenPageRank
 *
 * Free 1000 lookups/dag (registrering krävs).
 * Stark SEO-signal: hur "auktoritativ" Google ser sajten (0-10-skala).
 *   0-1   = ny eller dålig sajt
 *   2-3   = liten lokal närvaro
 *   4-5   = etablerat lokalt företag
 *   6+    = stark närvaro, dålig pitch (de behöver inte oss)
 *
 * Använder batch-anrop (upp till 100 domäner per request) → 1000 lookups/dag = 100 000 domäner/dag.
 *
 * Användning:
 *   node enrich-domainrank.js                → alla bolag med hemsida som inte är checkade
 *   node enrich-domainrank.js --branch snickare
 *   node enrich-domainrank.js --limit 1000
 *   node enrich-domainrank.js --recheck
 *
 * Skaffa nyckel: https://www.domcop.com/openpagerank/auth/signup
 * Sätt sen OPENPAGERANK_API_KEY i .env
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");

const KEY = process.env.OPENPAGERANK_API_KEY;
if (!KEY) {
  console.error("❌ Saknar OPENPAGERANK_API_KEY i .env");
  console.error("   Skaffa gratis: https://www.domcop.com/openpagerank/auth/signup");
  process.exit(1);
}

const API = "https://openpagerank.com/api/v1.0/getPageRank";
const BATCH_SIZE = 100; // OpenPageRank tar upp till 100 domäner per request
const DELAY_MS = 1000;

// ── DB-helpers ────────────────────────────────────────────────

function ensureColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  const adds = [
    ["domain_rank", "REAL"], // 0-10 från OpenPageRank
    ["domain_rank_int", "INTEGER"], // avrundad rank för enklare query/sort
    ["domain_rank_at", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
    }
  }
}

function getLeadsToCheck(opts) {
  const conditions = ["website IS NOT NULL AND website != ''"];
  const params = [];
  if (!opts.recheck) conditions.push("domain_rank_at IS NULL");
  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }
  return getDb()
    .prepare(
      `SELECT place_id, name, website
       FROM companies WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE priority WHEN '🔥 A+' THEN 1 WHEN '🟡 A' THEN 2 WHEN '🔵 B' THEN 3 ELSE 4 END,
         created_at ASC
       LIMIT ?`
    )
    .all(...params, opts.limit);
}

function saveResult(placeId, decimal, intVal) {
  getDb()
    .prepare(
      `UPDATE companies
       SET domain_rank      = ?,
           domain_rank_int  = ?,
           domain_rank_at   = datetime('now'),
           updated_at       = datetime('now')
       WHERE place_id = ?`
    )
    .run(decimal, intVal, placeId);
}

// ── API ───────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchBatch(domains) {
  const params = new URLSearchParams();
  domains.forEach((d) => params.append("domains[]", d));
  const url = `${API}?${params}`;
  const res = await fetch(url, {
    headers: { "API-OPR": KEY },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.status_code !== 200) {
    throw new Error(`API: ${json.error || JSON.stringify(json).slice(0, 200)}`);
  }
  return json.response || [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── CLI ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { branch: null, limit: 1000, recheck: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === "--recheck") opts.recheck = true;
  }
  return opts;
}

async function main() {
  ensureColumns();
  const opts = parseArgs();
  const leads = getLeadsToCheck(opts);

  // Mappa varje lead till domän — flera leads kan dela domän, vi hanterar det
  const byDomain = new Map();
  for (const lead of leads) {
    const domain = extractDomain(lead.website);
    if (!domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(lead);
  }

  const domains = [...byDomain.keys()];
  console.log("📈 Domain Rank scan (OpenPageRank)");
  console.log(`   Leads:        ${leads.length}`);
  console.log(`   Unika domäner: ${domains.length}`);
  console.log(`   Batchar à ${BATCH_SIZE}: ${Math.ceil(domains.length / BATCH_SIZE)}`);
  console.log();

  const distrib = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6+": 0 };
  let done = 0;
  let errors = 0;

  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE);
    try {
      const results = await fetchBatch(batch);
      for (const r of results) {
        // OpenPageRank sätter status_code per domän — 200 = data finns,
        // 404 = ingen data (ej rankad domän). Spara null för 404 så det
        // syns att vi försökte men inte fick svar — annars hamnar de
        // som "DR 0" och blir felaktigt klassade som låg-auktoritet.
        const ok = r.status_code === 200 && r.page_rank_decimal != null;
        const decimal = ok ? parseFloat(r.page_rank_decimal) : null;
        const intVal = decimal != null ? Math.round(decimal) : null;
        const leadsForDomain = byDomain.get(r.domain) || [];
        for (const lead of leadsForDomain) {
          saveResult(lead.place_id, decimal, intVal);
          done++;
        }
        if (intVal != null) {
          const bucket = intVal >= 6 ? "6+" : String(intVal);
          distrib[bucket] = (distrib[bucket] || 0) + leadsForDomain.length;
        }
      }
      process.stdout.write(`\r  ${done}/${leads.length} klara   `);
    } catch (err) {
      errors++;
      console.error(`\n  ✗ Batch ${i / BATCH_SIZE + 1}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log("\n\n📊 Domain Rank-fördelning:");
  for (const [k, n] of Object.entries(distrib)) {
    if (n === 0) continue;
    const pct = Math.round((n / done) * 100);
    console.log(`   DR ${k.padEnd(2)}: ${String(n).padStart(5)} (${pct}%)`);
  }
  if (errors > 0) console.log(`\n   ✗ Fel batchar: ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
