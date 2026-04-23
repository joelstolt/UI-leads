/**
 * sync-to-turso.js — Pushar lokal leads.db till Turso cloud DB
 *
 * Idempotent. Kör första gången för att skapa tabellerna. Kör efter
 * varje batch (scrape/discover/enrich) för att synka nya ändringar.
 *
 * Workflow:
 *   1. Engångssetup (du gör detta en gång):
 *      brew install tursodatabase/tap/turso
 *      turso auth login
 *      turso db create leadsgoogle
 *      turso db show leadsgoogle --url       # → sätt i .env: TURSO_DATABASE_URL=...
 *      turso db tokens create leadsgoogle    # → sätt i .env: TURSO_AUTH_TOKEN=...
 *
 *   2. Första syncen (skapar schemat):
 *      node sync-to-turso.js
 *
 *   3. Efter varje batch (pushar nya/ändrade rader):
 *      node sync-to-turso.js
 *
 * Använder CREATE TABLE IF NOT EXISTS + INSERT OR REPLACE, så samma script
 * fungerar för både initial migration och inkrementell sync. PRIMARY KEY
 * (place_id/id) avgör upsert.
 */

require("dotenv").config({ override: true });
const Database = require("better-sqlite3");
const path = require("path");
const { createClient } = require("@libsql/client");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("❌ Sätt TURSO_DATABASE_URL och TURSO_AUTH_TOKEN i .env");
  console.error("\nSetup:");
  console.error("  1. brew install tursodatabase/tap/turso");
  console.error("  2. turso auth login");
  console.error("  3. turso db create leadsgoogle");
  console.error("  4. turso db show leadsgoogle --url    → TURSO_DATABASE_URL");
  console.error("  5. turso db tokens create leadsgoogle → TURSO_AUTH_TOKEN");
  process.exit(1);
}

const local = new Database(path.join(__dirname, "leads.db"));
const remote = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

function getCreateSql(table) {
  const row = local
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return row?.sql ?? null;
}

async function ensureSchema(table) {
  const sql = getCreateSql(table);
  if (!sql) throw new Error(`Kan inte hitta schema för ${table}`);
  // CREATE TABLE ... kommer att ge fel om tabellen redan finns — använd IF NOT EXISTS
  const idempotent = sql.replace(/^CREATE TABLE(?! IF NOT EXISTS)/, "CREATE TABLE IF NOT EXISTS");
  await remote.execute(idempotent);
  await ensureColumns(table);
}

async function ensureColumns(table) {
  const localCols = local.prepare(`PRAGMA table_info(${table})`).all();
  const remoteRes = await remote.execute(`PRAGMA table_info(${table})`);
  const remoteCols = new Set(remoteRes.rows.map((r) => String(r.name)));

  for (const col of localCols) {
    if (remoteCols.has(col.name)) continue;
    const typePart = col.type ? ` ${col.type}` : "";
    const defPart = col.dflt_value != null ? ` DEFAULT ${col.dflt_value}` : "";
    try {
      await remote.execute(`ALTER TABLE ${table} ADD COLUMN ${col.name}${typePart}${defPart}`);
      console.log(`  + ${table}.${col.name}${typePart}`);
    } catch (e) {
      if (!/duplicate column/i.test(String(e.message || e))) throw e;
    }
  }
}

async function ensureIndexes() {
  const indexes = local
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    .all();
  for (const i of indexes) {
    const idempotent = i.sql.replace(/^CREATE INDEX(?! IF NOT EXISTS)/, "CREATE INDEX IF NOT EXISTS");
    try {
      await remote.execute(idempotent);
    } catch {
      /* index redan finns — OK */
    }
  }
}

async function syncTable(table) {
  console.log(`\n📦 ${table}`);
  await ensureSchema(table);

  const rows = local.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) {
    console.log("  (tomt)");
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => "?").join(", ");
  const insertSql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  const BATCH = 50;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const stmts = slice.map((r) => ({
      sql: insertSql,
      args: columns.map((c) => r[c]),
    }));
    await remote.batch(stmts, "write");
    done += slice.length;
    process.stdout.write(`\r  ${done}/${rows.length}   `);
  }
  console.log("");
  return rows.length;
}

async function main() {
  const t0 = Date.now();
  console.log("🚀 Sync: lokal leads.db → Turso");
  console.log(`   URL: ${TURSO_URL}`);

  const companies = await syncTable("companies");
  const runs = await syncTable("runs");
  await ensureIndexes();

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Klart på ${dur}s — ${companies} companies, ${runs} runs synkade.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
