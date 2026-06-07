/**
 * redo-pilot/db.js — Egen SQLite isolerad från leads.db
 *
 * Schemat hyllar prospects för det nya redovisningsbyrå-projektet.
 * Inga kopplingar till wlm-se/wlm-ie/Turso/CRM-sync.
 */

const Database = require("better-sqlite3");
const path = require("node:path");

const DB_PATH = path.join(__dirname, "leads-redo.db");

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      org_nr            TEXT PRIMARY KEY,        -- "559280-1186"
      name              TEXT NOT NULL,
      city              TEXT,
      address           TEXT,
      phone             TEXT,
      email             TEXT,
      website           TEXT,
      sni_code          TEXT,

      -- Allabolag-data
      revenue           INTEGER,                 -- SEK (omräknat från tkr)
      employees         INTEGER,
      contact_person    TEXT,                    -- firmatecknare (proxy "VD")
      board_count       INTEGER,                 -- antal styrelseledamöter (proxy "1 grundare")
      board_members     TEXT,                    -- JSON-array

      -- Chain-flagga
      is_chain          INTEGER DEFAULT 0,
      chain_reason      TEXT,

      -- Discovery-source
      discovered_query  TEXT,                    -- 'redovisningsbyrå' | 'bokföringsbyrå' | 'revisionsbyrå'
      discovered_at     TEXT,

      -- Sajt-enrichment
      site_status       TEXT,                    -- 'ok' | 'error' | 'no-website'
      tech_stack        TEXT,                    -- wix|wp|sqsp|webflow|one.com|hemsida24|jimdo|custom|...
      wp_theme          TEXT,                    -- detekterad tema-slug om WP
      wp_theme_generic  INTEGER,                 -- 1 om mall (astra/divi/generatepress/twentyXX/hello-elementor)
      has_schema        INTEGER,
      has_og_image      INTEGER,
      has_ga            INTEGER,
      has_fb_pixel      INTEGER,
      has_viewport      INTEGER,
      meta_description  INTEGER,                 -- 1 om finns + >40 tecken + ej generic
      title_has_city    INTEGER,                 -- 1 om title innehåller "redovisning"/"bokföring" + Malmö
      cert_age_days     INTEGER,                 -- TLS NotBefore-ålder i dagar
      blog_last_iso     TEXT,                    -- senaste blog-/nyhets-datum ISO
      blog_stale_months INTEGER,                 -- månader sen senaste post (null om ingen blogg)
      enrich_error      TEXT,
      enriched_at       TEXT,

      -- PageSpeed (mobile)
      ps_performance    INTEGER,
      ps_seo            INTEGER,
      ps_accessibility  INTEGER,
      ps_mobile_ok      INTEGER,                 -- 0/1
      ps_at             TEXT,

      -- Score
      score             INTEGER,
      score_breakdown   TEXT,                    -- JSON: {kriterium: poäng}

      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_prospects_city     ON prospects(city);
    CREATE INDEX IF NOT EXISTS idx_prospects_score    ON prospects(score);
    CREATE INDEX IF NOT EXISTS idx_prospects_revenue  ON prospects(revenue);
    CREATE INDEX IF NOT EXISTS idx_prospects_is_chain ON prospects(is_chain);
  `);

  return _db;
}

function upsertProspect(p) {
  const db = getDb();
  const existing = db.prepare("SELECT org_nr FROM prospects WHERE org_nr = ?").get(p.org_nr);
  if (existing) {
    db.prepare(
      `UPDATE prospects SET
        name             = COALESCE(?, name),
        city             = COALESCE(?, city),
        address          = COALESCE(?, address),
        phone            = COALESCE(?, phone),
        email            = COALESCE(?, email),
        website          = COALESCE(?, website),
        sni_code         = COALESCE(?, sni_code),
        revenue          = COALESCE(?, revenue),
        employees        = COALESCE(?, employees),
        contact_person   = COALESCE(?, contact_person),
        discovered_query = COALESCE(discovered_query, ?),
        updated_at       = datetime('now')
       WHERE org_nr = ?`
    ).run(
      p.name, p.city, p.address, p.phone, p.email, p.website, p.sni_code,
      p.revenue, p.employees, p.contact_person, p.discovered_query, p.org_nr
    );
    return { isNew: false };
  }
  db.prepare(
    `INSERT INTO prospects
      (org_nr, name, city, address, phone, email, website, sni_code,
       revenue, employees, contact_person, discovered_query, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    p.org_nr, p.name, p.city, p.address || null, p.phone, p.email, p.website, p.sni_code,
    p.revenue, p.employees, p.contact_person, p.discovered_query
  );
  return { isNew: true };
}

module.exports = { getDb, upsertProspect, DB_PATH };
