#!/usr/bin/env node
/**
 * cleanup-ie-duplicates.js — rensar fel-matchningar i IE-data.
 *
 * Problem: domain-guess matchade flera bolag till samma URL via akronym
 *   (ex: "pes.ie" matchade 12 olika bolag som råkar ha akronym "PES").
 *
 * Strategi:
 *   1. För varje hemsida på 2+ bolag: räkna ut name-slug för varje bolag
 *      och behåll bara det bolag vars slug är NÄRMAST domännamnet.
 *   2. Övriga bolag: sätt website=NULL och email=NULL (eftersom mejl
 *      kom från samma fel-matchade sajt).
 *   3. Skräp-mejl filtreras bort separat (user@domain.com, sentry, etc).
 *
 * Användning:
 *   node cleanup-ie-duplicates.js                → kör skarpt
 *   node cleanup-ie-duplicates.js --dry-run      → visa vad som skulle tas bort
 */

const { getDb } = require("./db");

const opts = {
  dryRun: process.argv.includes("--dry-run"),
};

// ════════════════════════════════════════════════════════════════════
// Skräp-mejl-domäner / mönster (utöver det enrich-ie-website redan filtrerade)
// ════════════════════════════════════════════════════════════════════

const TRASH_EMAIL_PATTERNS = [
  /@domain\.com$/i,
  /@example\./i,
  /@sentry-next\.wixpress\.com$/i,
  /^[a-f0-9]{20,}@/i, // hash-baserade tracking-mejl
  /@hostingireland\.ie$/i,
  /@hosting\.ie$/i,
  /@websites\.co$/i,
  /@yourdomain\./i,
  /@mysite\.com$/i,
];

// ════════════════════════════════════════════════════════════════════
// Slug-likhet
// ════════════════════════════════════════════════════════════════════

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(limited|ltd|plc|llc|inc|co|company|the|and|of)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\.\/]/)[0];
  }
}

// Score: 0-1, hur väl bolagsnamn matchar domännamn
function matchScore(name, url) {
  const slug = nameToSlug(name);
  const domain = getDomain(url);
  if (!slug || !domain) return 0;

  // Exakt match
  if (slug === domain) return 1.0;
  // Domain ingår i slug eller vice versa
  if (slug.includes(domain) && domain.length >= 4) return 0.9;
  if (domain.includes(slug) && slug.length >= 4) return 0.85;

  // Akronym-match (3-letter domain matching first letters of name words)
  const tokens = name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(limited|ltd|plc|llc|inc|co|company|the|and|of)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const acronym = tokens.map((t) => t[0]).join("");
  if (domain === acronym) return 0.5; // svagare poäng — akronym kan vara slumpmässigt
  if (acronym.includes(domain)) return 0.4;

  // Första ord matchar
  if (tokens[0] && domain === tokens[0]) return 0.7;
  if (tokens[0] && tokens[0].startsWith(domain) && domain.length >= 5) return 0.6;

  // Inget bra match
  return 0.1;
}

// ════════════════════════════════════════════════════════════════════
// Kör städning
// ════════════════════════════════════════════════════════════════════

const db = getDb();

console.log("🧹 cleanup-ie-duplicates — rensar fel-matchade hemsidor i IE-data\n");
console.log(`   Mode: ${opts.dryRun ? "DRY-RUN" : "skarp"}\n`);

// Hitta alla hemsidor på 2+ IE-bolag
const dupSites = db
  .prepare(
    `SELECT website, COUNT(*) AS antal
     FROM companies
     WHERE branch LIKE 'IE-%' AND website IS NOT NULL AND website != ''
     GROUP BY website
     HAVING antal >= 2
     ORDER BY antal DESC`
  )
  .all();

console.log(`📋 Hemsidor på 2+ IE-bolag: ${dupSites.length}`);
console.log(`   Total bolag som påverkas: ${dupSites.reduce((s, d) => s + d.antal, 0)}\n`);

let kept = 0,
  cleared = 0;

for (const site of dupSites) {
  const bolag = db
    .prepare(
      `SELECT place_id, name, website, email FROM companies
       WHERE branch LIKE 'IE-%' AND website = ?`
    )
    .all(site.website);

  // Beräkna match-score för varje bolag
  const scored = bolag
    .map((b) => ({ ...b, score: matchScore(b.name, b.website) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];

  // Om bästa score är för låg → ALLA är fel-matchade → rensa alla
  const winnerScore = winner.score;
  const keepWinner = winnerScore >= 0.5;

  if (!opts.dryRun) {
    for (const b of scored) {
      if (b.place_id === winner.place_id && keepWinner) {
        kept++;
        continue;
      }
      // Rensa website + email (eftersom mejl kom från samma sajt)
      db.prepare(
        `UPDATE companies SET website = NULL, email = NULL,
         email_scraped_at = NULL, updated_at = datetime('now')
         WHERE place_id = ?`
      ).run(b.place_id);
      cleared++;
    }
  } else {
    if (keepWinner) kept++;
    cleared += scored.length - (keepWinner ? 1 : 0);
  }

  if (dupSites.indexOf(site) < 5) {
    console.log(
      `   ${site.antal}x ${site.website} → behåll: ${keepWinner ? winner.name + " (score " + winnerScore.toFixed(2) + ")" : "INGEN (alla låg score)"}`
    );
  }
}

console.log(`\n   ✅ Behöll: ${kept.toLocaleString()}`);
console.log(`   🧹 Rensade: ${cleared.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════
// Rensa skräp-mejl
// ════════════════════════════════════════════════════════════════════

console.log(`\n📧 Rensar skräp-mejl:`);

const allWithMail = db
  .prepare(
    `SELECT place_id, email FROM companies
     WHERE branch LIKE 'IE-%' AND email IS NOT NULL AND email != ''`
  )
  .all();

let trashCleared = 0;
const trashByPattern = {};

for (const r of allWithMail) {
  for (const pattern of TRASH_EMAIL_PATTERNS) {
    if (pattern.test(r.email)) {
      const key = pattern.toString();
      trashByPattern[key] = (trashByPattern[key] || 0) + 1;
      if (!opts.dryRun) {
        db.prepare(
          `UPDATE companies SET email = NULL, email_scraped_at = NULL,
           updated_at = datetime('now') WHERE place_id = ?`
        ).run(r.place_id);
      }
      trashCleared++;
      break;
    }
  }
}

for (const [pat, n] of Object.entries(trashByPattern).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${n.toString().padStart(4)}x ${pat}`);
}
console.log(`\n   🧹 Total skräp-mejl rensade: ${trashCleared.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════════
// Slutstatus
// ════════════════════════════════════════════════════════════════════

const ie = db
  .prepare(
    `SELECT COUNT(*) AS t,
       SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS tel,
       SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS mejl,
       SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS web,
       SUM(CASE WHEN phone IS NOT NULL AND phone != ''
                AND email IS NOT NULL AND email != ''
                AND website IS NOT NULL AND website != ''
                AND (is_chain IS NULL OR is_chain = 0) THEN 1 ELSE 0 END) AS varma
     FROM companies WHERE branch LIKE 'IE-%'`
  )
  .get();

console.log(`\n📊 IRLAND efter städning:`);
console.log(`   Totalt:          ${ie.t.toLocaleString()}`);
console.log(`   Med telefon:     ${ie.tel.toLocaleString()}`);
console.log(`   Med mejl:        ${ie.mejl.toLocaleString()}`);
console.log(`   Med hemsida:     ${ie.web.toLocaleString()}`);
console.log(`   ⭐ VARMA leads:  ${ie.varma.toLocaleString()}`);
