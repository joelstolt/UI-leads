/**
 * SQLite-setup och hjälpfunktioner
 * Använder better-sqlite3 (synkron) för enkelhet
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "leads.db");

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      place_id          TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      branch            TEXT,
      city              TEXT,
      phone             TEXT,
      website           TEXT,
      address           TEXT,
      rating            REAL,
      reviews           INTEGER,
      status            TEXT,

      -- Email-enrichment
      email             TEXT,

      -- PageSpeed-resultat
      performance       INTEGER,
      seo               INTEGER,
      accessibility     INTEGER,
      mobile_friendly   TEXT,
      load_time         TEXT,
      priority          TEXT,

      -- Bolagsinfo (enrich-corp.js)
      org_nr            TEXT,
      firmatecknare     TEXT,   -- JSON-array: ["Förnamn Efternamn", ...]
      revenue           INTEGER,
      employees         INTEGER,
      sni_code          TEXT,

      -- Tidsstämplar för inkrementell körning
      scraped_at        TEXT,
      email_scraped_at  TEXT,
      pagespeed_at      TEXT,
      corp_enriched_at  TEXT,

      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),
      slug              TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      branch        TEXT,
      city          TEXT,
      query         TEXT,
      found         INTEGER DEFAULT 0,
      new_count     INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_companies_branch  ON companies(branch);
    CREATE INDEX IF NOT EXISTS idx_companies_city    ON companies(city);
    CREATE INDEX IF NOT EXISTS idx_companies_priority ON companies(priority);
    CREATE INDEX IF NOT EXISTS idx_companies_scraped ON companies(scraped_at);
  `);

  return _db;
}

/**
 * Upsert ett bolag — INSERT om nytt, UPDATE om place_id finns sedan tidigare.
 * Returnerar true om det var ett nytt bolag.
 */
function upsertCompany(data) {
  const db = getDb();

  const existing = db
    .prepare("SELECT place_id, scraped_at FROM companies WHERE place_id = ?")
    .get(data.place_id);

  if (existing) {
    db.prepare(`
      UPDATE companies SET
        name = ?, branch = ?, city = ?, phone = ?, website = ?,
        address = ?, rating = ?, reviews = ?, status = ?,
        scraped_at = ?, updated_at = datetime('now')
      WHERE place_id = ?
    `).run(
      data.name, data.branch, data.city, data.phone ?? null,
      data.website ?? null, data.address ?? null,
      data.rating ?? null, data.reviews ?? null, data.status ?? null,
      new Date().toISOString(), data.place_id
    );
    return false;
  }

  db.prepare(`
    INSERT INTO companies
      (place_id, name, branch, city, phone, website, address, rating, reviews, status, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.place_id, data.name, data.branch, data.city,
    data.phone ?? null, data.website ?? null, data.address ?? null,
    data.rating ?? null, data.reviews ?? null, data.status ?? null,
    new Date().toISOString()
  );
  setSlugIfMissing(data.place_id, data.name);
  return true;
}

/**
 * Hämta bolag som saknar email-enrichment och har hemsida
 */
function getCompaniesNeedingEmail(limit = 500) {
  return getDb()
    .prepare(`
      SELECT * FROM companies
      WHERE website IS NOT NULL AND website != ''
        AND email_scraped_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit);
}

/**
 * Hämta bolag som saknar PageSpeed-analys och har hemsida
 */
function getCompaniesNeedingPagespeed(limit = 500) {
  return getDb()
    .prepare(`
      SELECT * FROM companies
      WHERE website IS NOT NULL AND website != ''
        AND pagespeed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit);
}

/**
 * Hämta bolag som saknar bolagsinfo-enrichment
 */
function getCompaniesNeedingCorp(limit = 500) {
  return getDb()
    .prepare(`
      SELECT * FROM companies
      WHERE corp_enriched_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(limit);
}

/**
 * Uppdatera email-enrichment
 */
function updateEmail(placeId, email) {
  getDb()
    .prepare(`
      UPDATE companies
      SET email = ?, email_scraped_at = datetime('now'), updated_at = datetime('now')
      WHERE place_id = ?
    `)
    .run(email ?? null, placeId);
}

/**
 * Uppdatera PageSpeed-resultat och prioritet
 */
function updatePagespeed(placeId, data) {
  getDb()
    .prepare(`
      UPDATE companies
      SET performance = ?, seo = ?, accessibility = ?,
          mobile_friendly = ?, load_time = ?, priority = ?,
          pagespeed_at = datetime('now'), updated_at = datetime('now')
      WHERE place_id = ?
    `)
    .run(
      data.performance, data.seo, data.accessibility,
      data.mobile_friendly, data.load_time, data.priority,
      placeId
    );
}

/**
 * Uppdatera bolagsinfo
 */
function updateCorp(placeId, data) {
  getDb()
    .prepare(`
      UPDATE companies
      SET org_nr = ?, firmatecknare = ?, revenue = ?, employees = ?, sni_code = ?,
          corp_enriched_at = datetime('now'), updated_at = datetime('now')
      WHERE place_id = ?
    `)
    .run(
      data.org_nr ?? null,
      data.firmatecknare ? JSON.stringify(data.firmatecknare) : null,
      data.revenue ?? null,
      data.employees ?? null,
      data.sni_code ?? null,
      placeId
    );
}

/**
 * Logga en run-session
 */
function insertRun(data) {
  return getDb()
    .prepare(`
      INSERT INTO runs (started_at, branch, city, query)
      VALUES (datetime('now'), ?, ?, ?)
    `)
    .run(data.branch ?? null, data.city ?? null, data.query ?? null)
    .lastInsertRowid;
}

function finishRun(id, found, newCount) {
  getDb()
    .prepare(`
      UPDATE runs
      SET finished_at = datetime('now'), found = ?, new_count = ?
      WHERE id = ?
    `)
    .run(found, newCount, id);
}

/**
 * Hämta statistik
 */
function getStats() {
  const db = getDb();
  return {
    total:           db.prepare("SELECT COUNT(*) as n FROM companies").get().n,
    withPhone:       db.prepare("SELECT COUNT(*) as n FROM companies WHERE phone IS NOT NULL").get().n,
    withWebsite:     db.prepare("SELECT COUNT(*) as n FROM companies WHERE website IS NOT NULL").get().n,
    withEmail:       db.prepare("SELECT COUNT(*) as n FROM companies WHERE email IS NOT NULL").get().n,
    withPagespeed:   db.prepare("SELECT COUNT(*) as n FROM companies WHERE pagespeed_at IS NOT NULL").get().n,
    withCorp:        db.prepare("SELECT COUNT(*) as n FROM companies WHERE corp_enriched_at IS NOT NULL").get().n,
    hotLeads:        db.prepare("SELECT COUNT(*) as n FROM companies WHERE priority = '🔥 A+'").get().n,
  };
}

/**
 * Säkerställ brand-kolumn (varumärket leaden tillhör).
 * Idempotent — kan köras vid varje script-start.
 */
function ensureBrandColumn() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  if (!cols.includes("brand")) {
    db.exec("ALTER TABLE companies ADD COLUMN brand TEXT;");
  }
}

/**
 * Sätt brand på en lead om den saknas (eller överskriv om force=true).
 */
function setBrand(placeId, brandKey, force = false) {
  ensureBrandColumn();
  const sql = force
    ? "UPDATE companies SET brand = ?, updated_at = datetime('now') WHERE place_id = ?"
    : "UPDATE companies SET brand = ?, updated_at = datetime('now') WHERE place_id = ? AND brand IS NULL";
  return getDb().prepare(sql).run(brandKey, placeId).changes;
}

function ensureSlugColumn() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  if (!cols.includes("slug")) {
    db.exec("ALTER TABLE companies ADD COLUMN slug TEXT;");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);");
}

function slugifyName(s) {
  const subs = { "å": "a", "ä": "a", "ö": "o", "é": "e", "è": "e", "ü": "u", "ß": "ss", "&": "and" };
  let out = (s || "").toLowerCase();
  for (const [k, v] of Object.entries(subs)) out = out.split(k).join(v);
  out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "lead";
}

/**
 * Sätt unik slug på en lead om den saknas. Hanterar kollisioner med -2, -3, …
 */
function setSlugIfMissing(placeId, name) {
  ensureSlugColumn();
  const db = getDb();
  const existing = db.prepare("SELECT slug FROM companies WHERE place_id = ?").get(placeId);
  if (!existing || existing.slug) return existing ? existing.slug : null;

  const base = slugifyName(name);
  let candidate = base;
  let n = 1;
  while (db.prepare("SELECT 1 FROM companies WHERE slug = ? AND place_id != ?").get(candidate, placeId)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  db.prepare("UPDATE companies SET slug = ?, updated_at = datetime('now') WHERE place_id = ?").run(candidate, placeId);
  return candidate;
}

module.exports = {
  getDb,
  upsertCompany,
  getCompaniesNeedingEmail,
  getCompaniesNeedingPagespeed,
  getCompaniesNeedingCorp,
  updateEmail,
  updatePagespeed,
  updateCorp,
  insertRun,
  finishRun,
  getStats,
  ensureBrandColumn,
  setBrand,
  ensureSlugColumn,
  setSlugIfMissing,
  slugifyName,
};
