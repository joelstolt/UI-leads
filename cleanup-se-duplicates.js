#!/usr/bin/env node
/**
 * cleanup-se-duplicates.js — rensar fel-matchade hemsidor/mejl i SE-data.
 *
 * Strategi: för varje hemsida på 2+ bolag, behåll det med BÄST namn-match.
 *           För övriga: NULL:a website + email (de hade fel-matchade båda).
 *           Plus skräp-mejl-blocklist (telepathy.com etc).
 */

const { getDb } = require("./db");

const SE_BRANCHES = [
  "Hantverkare", "Snickare", "Elektriker", "Takläggare", "Målare", "VVS",
  "Plåtslagare", "Glasmästare", "Markarbeten", "Sanering", "Tapetserare",
  "Smed", "Pool & Spa", "Solskydd & Markiser", "Isolering",
  "Trädgård & Anläggning", "Fasadrenovering", "Byggmästare m.fl.",
  "Specialiserade hantverk", "Trävaror & Möbler", "Dörrar & Portar",
];

// Skräp-domäner som NEVER ska vara hemsida
const TRASH_HOSTS = new Set([
  "telepathy.com",
  "stockholmsnation.se",
  "wixsite.com",
  "wix.com",
  "godaddy.com",
  "godaddysites.com",
  "weebly.com",
  "site123.me",
]);

// Skräp-mejl-mönster
const TRASH_EMAIL_PATTERNS = [
  /@telepathy\.com$/i,
  /@stockholmsnation\.se$/i,
  /@domain\.com$/i,
  /@example\./i,
  /@sentry-next\.wixpress\.com$/i,
  /^[a-f0-9]{20,}@/i,
  /@hostingireland\.ie$/i,
  /@yourdomain\./i,
  /@mysite\.com$/i,
  /@minhemsida\.se$/i,
  /^name@/i,
  /^namn@/i,
];

const opts = {
  dryRun: process.argv.includes("--dry-run"),
};

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(ab|aktiebolag|hb|handelsbolag|kb|the|and|och)\b/gi, "")
    .replace(/[^a-zåäö0-9]/g, "")
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");
}

function getDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\.\/]/)[0];
  }
}

function getFullHost(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function matchScore(name, url) {
  const slug = nameToSlug(name);
  const domain = getDomain(url);
  if (!slug || !domain) return 0;
  if (slug === domain) return 1.0;
  if (slug.includes(domain) && domain.length >= 4) return 0.9;
  if (domain.includes(slug) && slug.length >= 4) return 0.85;

  const tokens = name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(ab|aktiebolag|hb|kb|the|and|och)\b/gi, "")
    .replace(/[^a-zåäö0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const acronym = tokens.map((t) => t[0]).join("").replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");
  if (domain === acronym) return 0.5;
  if (acronym.includes(domain)) return 0.4;
  if (tokens[0] && tokens[0].replace(/å/g,"a").replace(/ä/g,"a").replace(/ö/g,"o") === domain) return 0.7;
  return 0.1;
}

const db = getDb();
const phl = SE_BRANCHES.map(() => "?").join(",");

console.log("🧹 cleanup-se-duplicates — rensar fel-matchade hemsidor i SE-data\n");
console.log(`   Mode: ${opts.dryRun ? "DRY-RUN" : "skarp"}\n`);

// ── Steg 1: Rensa skräp-hostar (helt fel domäner) ──
console.log("🚮 Steg 1: Rensa skräp-hostar (telepathy.com etc):");
let trashHostCleared = 0;
for (const host of TRASH_HOSTS) {
  const r = db
    .prepare(
      `SELECT place_id, name, website FROM companies
       WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%')
         AND website LIKE ?`
    )
    .all(...SE_BRANCHES, `%${host}%`);
  if (r.length > 0) {
    console.log(`   ${r.length}x ${host}`);
    if (!opts.dryRun) {
      const stmt = db.prepare(
        `UPDATE companies SET website = NULL, email = NULL,
         email_scraped_at = NULL, updated_at = datetime('now')
         WHERE place_id = ?`
      );
      const tx = db.transaction((items) => {
        for (const r of items) stmt.run(r.place_id);
      });
      tx(r);
    }
    trashHostCleared += r.length;
  }
}
console.log(`   ✅ Rensade: ${trashHostCleared}\n`);

// ── Steg 2: Per-website dedup (behåll bästa name-match) ──
console.log("🔍 Steg 2: Per-website dedup (slug-match):");
const dupSites = db
  .prepare(
    `SELECT website, COUNT(*) AS antal
     FROM companies
     WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%')
       AND website IS NOT NULL AND website != ''
     GROUP BY website
     HAVING antal >= 2
     ORDER BY antal DESC`
  )
  .all(...SE_BRANCHES);

console.log(`   Hemsidor på 2+ bolag: ${dupSites.length}`);
let kept = 0,
  cleared = 0;

for (const site of dupSites) {
  const bolag = db
    .prepare(
      `SELECT place_id, name, website, email FROM companies
       WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%') AND website = ?`
    )
    .all(...SE_BRANCHES, site.website);

  const scored = bolag
    .map((b) => ({ ...b, score: matchScore(b.name, b.website) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const keepWinner = winner.score >= 0.5;

  if (!opts.dryRun) {
    for (const b of scored) {
      if (b.place_id === winner.place_id && keepWinner) {
        kept++;
        continue;
      }
      db.prepare(
        `UPDATE companies SET website = NULL, email = NULL,
         email_scraped_at = NULL, updated_at = datetime('now')
         WHERE place_id = ?`
      ).run(b.place_id);
      cleared++;
    }
  }
}
console.log(`   ✅ Behöll: ${kept.toLocaleString()}`);
console.log(`   🧹 Rensade: ${cleared.toLocaleString()}\n`);

// ── Steg 3: Skräp-mejl ──
console.log("📧 Steg 3: Rensa skräp-mejl:");
const allWithMail = db
  .prepare(
    `SELECT place_id, email FROM companies
     WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%')
       AND email IS NOT NULL AND email != ''`
  )
  .all(...SE_BRANCHES);

let trashEmailCleared = 0;
for (const r of allWithMail) {
  for (const pattern of TRASH_EMAIL_PATTERNS) {
    if (pattern.test(r.email)) {
      if (!opts.dryRun) {
        db.prepare(
          `UPDATE companies SET email = NULL, email_scraped_at = NULL,
           updated_at = datetime('now') WHERE place_id = ?`
        ).run(r.place_id);
      }
      trashEmailCleared++;
      break;
    }
  }
}
console.log(`   ✅ Rensade: ${trashEmailCleared}\n`);

// ── Slutstatus ──
const VARM = `phone IS NOT NULL AND phone != ''
  AND email IS NOT NULL AND email != ''
  AND website IS NOT NULL AND website != ''
  AND (is_chain IS NULL OR is_chain = 0)`;

const after = db
  .prepare(
    `SELECT COUNT(*) AS varma, COUNT(DISTINCT website) AS unika_web,
            COUNT(DISTINCT email) AS unika_mejl, COUNT(DISTINCT phone) AS unika_tel
     FROM companies
     WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%') AND ${VARM}`
  )
  .get(...SE_BRANCHES);

console.log("📊 SVERIGE varma efter rensning:");
console.log(`   Totalt varma:        ${after.varma.toLocaleString()}`);
console.log(`   Unika hemsidor:      ${after.unika_web.toLocaleString()}`);
console.log(`   Unika mejl:          ${after.unika_mejl.toLocaleString()}`);
console.log(`   Unika telefoner:     ${after.unika_tel.toLocaleString()}`);
