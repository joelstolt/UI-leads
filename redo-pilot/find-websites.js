#!/usr/bin/env node
/**
 * redo-pilot/find-websites.js — hittar saknade hemsidor via SerpAPI.
 *
 * Allabolag underrapporterar website (bara ~13% av byråerna har det
 * registrerat). Verklig andel är 80–90%. Detta script söker via Google
 * Search för bolag i sweet spot som saknar hemsida.
 *
 * Filtrerar bort directories (allabolag, hitta, eniro, etc.) och plockar
 * första riktiga organic-result. Validerar med HEAD-request innan save.
 *
 * Användning:
 *   node redo-pilot/find-websites.js              → alla i sweet spot utan website
 *   node redo-pilot/find-websites.js --all        → alla i DB utan website
 *   node redo-pilot/find-websites.js --limit 5
 *   node redo-pilot/find-websites.js --dry-run    → visa utan att uppdatera/anropa
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");
const { REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX } = require("./config");

const SERPAPI_KEY = process.env.SERPAPI_KEY;
if (!SERPAPI_KEY) {
  console.error("❌ SERPAPI_KEY saknas i .env");
  process.exit(1);
}

// Sajter att SKIPPA — directories, sociala medier, branschnätverk, myndigheter, jobb
// Matchas med endsWith så subdomäner (se.linkedin.com) också fångas.
const SKIP_DOMAINS = [
  // Svenska directories
  "allabolag.se", "hitta.se", "eniro.se", "ratsit.se", "merinfo.se",
  "nordicnet.se", "syna.se", "cylex.se", "bolagsfakta.se", "bolagsverket.se",
  "proff.se", "largestcompanies.se", "vainu.com", "vainu.io",
  "company-information.se", "starkabolag.se", "krafman.se", "infotorg.se",
  "infoom.se", "redovisare.se",
  // Sociala medier
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "pinterest.com",
  // Jobb / rekrytering
  "vakanser.se", "jobb-malmo.se", "indeed.se", "indeed.com", "blocket.se",
  "monster.se", "stepstone.se", "arbetsformedlingen.se", "jobbland.se",
  "jobbsafari.se", "metrojobb.se",
  // Branschnätverk
  "tagalliances.com", "pkf.com", "yelp.com", "bytredovisning.se",
  "zervant.com", "vismaspcs.se", "fortnox.se", "wikipedia.org",
  // Konkurrent-byråer / "bästa byrå"-listor
  "talenom.com", "azets.se", "aspia.se", "pwc.se", "kpmg.se",
  "ey.com", "deloitte.com", "grantthornton.se", "mazars.se",
  "redovisninghelsingborg.se", "helsingborgredovisning.se",
  "dinekonomiskane.se", "revizion.se", "phsekonomi.se",
  // Myndigheter
  "skatteverket.se", "lansstyrelsen.se", "domstol.se", "regeringen.se", "scb.se",
];

function isDirectorySite(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Filtrera PDF/dokument-länkar
    if (/\.(pdf|docx?|xlsx?|pptx?)($|\?)/i.test(u.pathname)) return true;
    // endsWith så subdomäner matchas (se.linkedin.com → linkedin.com)
    return SKIP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

// Generiska branschord — får inte ge domain-match (för många false positives)
const GENERIC_TOKENS = new Set([
  "redovisning", "redovisningsbyra", "redovisningsbyrå", "redovisningsbyran",
  "redovisningsbyrån", "revision", "revisionsbyra", "revisionsbyrå",
  "revisionsbyran", "revisionsbyrån", "bokforing", "bokföring",
  "byra", "byrå", "byran", "byrån", "konsult", "konsulter", "consulting",
  "ekonomi", "ekonomer", "finans", "skatt", "skatter", "skatterådgivning",
  "advisor", "rådgivning", "radgivning", "partners", "group", "holding",
  "service", "tjänster", "tjanster", "company", "förvaltning", "forvaltning",
]);

function nameTokens(name) {
  // "Axion Revisionsbyrå AB" → ["axion"] (utan generiska branschord)
  return name
    .toLowerCase()
    .replace(/\b(ab|hb|kb|ef|ekf|aktiebolag)\b/g, "")
    .replace(/[^a-zåäö0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !GENERIC_TOKENS.has(w));
}

function domainMatchesName(url, name) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const domainPart = host.split(".")[0]; // "axion" från "axion.se"
    const tokens = nameTokens(name);
    if (tokens.length === 0) return false;
    // Domänen ska innehålla någon av tokens (i båda riktningar)
    return tokens.some(
      (t) => domainPart.includes(t.slice(0, 5)) || t.includes(domainPart.slice(0, 5))
    );
  } catch {
    return false;
  }
}

async function serpSearch(query) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "sv");
  url.searchParams.set("gl", "se");
  url.searchParams.set("num", "10");
  url.searchParams.set("api_key", SERPAPI_KEY);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const data = await res.json();
  return data.organic_results || [];
}

async function validateUrl(url) {
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(target, {
      method: "HEAD",
      signal: AbortSignal.timeout(7000),
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinder/1.0)" },
    });
    return res.ok || res.status === 405; // 405 = HEAD not supported, still likely valid
  } catch {
    return false;
  }
}

function rankCandidates(results, name) {
  // KRAV: domännamnet måste matcha bolagsnamnet — annars är det inte deras sajt.
  // Filtrerar bort directories + jobb-/social-/myndighetssidor.
  const real = results.filter((r) => r.link && !isDirectorySite(r.link));
  const matched = real.filter((r) => domainMatchesName(r.link, name));
  // Dedupe på hostname, plocka roten (axion.se/sv/kontakt → axion.se)
  const seen = new Set();
  const out = [];
  for (const r of matched) {
    try {
      const u = new URL(r.link);
      const host = u.hostname;
      if (seen.has(host)) continue;
      seen.add(host);
      out.push(`${u.protocol}//${u.hostname}/`);
    } catch {
      // ignore
    }
  }
  return out;
}

function getProspects(opts) {
  const where = [
    "(website IS NULL OR website = '')",
  ];
  if (!opts.all) {
    where.push(`revenue BETWEEN ${REVENUE_MIN} AND ${REVENUE_MAX}`);
    where.push(`employees BETWEEN ${EMPLOYEES_MIN} AND ${EMPLOYEES_MAX}`);
  }
  where.push("(is_chain IS NULL OR is_chain = 0)");
  const sql = `SELECT org_nr, name, city FROM prospects
               WHERE ${where.join(" AND ")}
               ORDER BY revenue DESC NULLS LAST
               ${opts.limit ? "LIMIT ?" : ""}`;
  const stmt = getDb().prepare(sql);
  return opts.limit ? stmt.all(opts.limit) : stmt.all();
}

function saveWebsite(orgnr, url) {
  // Normalisera till https://www.xxx.se
  let normalized = url.trim();
  if (!normalized.startsWith("http")) normalized = `https://${normalized}`;
  getDb()
    .prepare(
      `UPDATE prospects SET website = ?, updated_at = datetime('now')
       WHERE org_nr = ?`
    )
    .run(normalized, orgnr);
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    all: args.includes("--all"),
    dryRun: args.includes("--dry-run"),
    limit: args.includes("--limit")
      ? parseInt(args[args.indexOf("--limit") + 1])
      : null,
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opts = parseArgs();
  const prospects = getProspects(opts);

  console.log("🔍 redo-pilot/find-websites — SerpAPI website-lookup");
  console.log(`   Bolag att checka: ${prospects.length}`);
  console.log(`   Mode:             ${opts.all ? "ALLA (även utanför sweet spot)" : "Sweet spot"}`);
  if (opts.dryRun) console.log(`   [DRY-RUN] Inga API-anrop, ingen DB-write.`);
  console.log();

  if (prospects.length === 0) {
    console.log("Inget att göra.");
    return;
  }

  let found = 0;
  let notFound = 0;
  let invalid = 0;
  let errors = 0;
  let i = 0;

  for (const p of prospects) {
    i++;
    process.stdout.write(
      `   [${i}/${prospects.length}] ${p.name.slice(0, 38).padEnd(38)} ${p.city.padEnd(12)} `
    );

    if (opts.dryRun) {
      process.stdout.write("(dry-run)\n");
      continue;
    }

    try {
      // Strippa bolagsform — företagets riktiga sajt säger sällan "AB"/"Aktiebolag"
      const cleanName = p.name
        .replace(/\b(aktiebolag|ab|hb|kb)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const query = `${cleanName} ${p.city} redovisning OR revision OR bokföring`;
      const results = await serpSearch(query);
      const candidates = rankCandidates(results, p.name);

      if (candidates.length === 0) {
        process.stdout.write("✗ ingen träff\n");
        notFound++;
        await sleep(500);
        continue;
      }

      // Försök första kandidaten, fallback till nästa om den inte svarar
      let savedUrl = null;
      let triedAll = [];
      for (const url of candidates.slice(0, 4)) {
        triedAll.push(url);
        if (await validateUrl(url)) {
          savedUrl = url;
          break;
        }
      }

      if (!savedUrl) {
        process.stdout.write(`⚠️  ingen svarade (${triedAll.length} testade)\n`);
        invalid++;
        await sleep(500);
        continue;
      }

      saveWebsite(p.org_nr, savedUrl);
      process.stdout.write(`✓ ${savedUrl}\n`);
      found++;
    } catch (err) {
      process.stdout.write(`✗ ${err.message}\n`);
      errors++;
    }
    await sleep(500); // snäll mot SerpAPI
  }

  console.log();
  console.log("✅ Klart");
  console.log(`   Hittade hemsidor:      ${found}`);
  console.log(`   Inga träffar:          ${notFound}`);
  console.log(`   Hittade men svarar ej: ${invalid}`);
  console.log(`   Fel:                   ${errors}`);
  console.log(`   Uppskattad kostnad:    $${(prospects.length * 0.01).toFixed(2)} (SerpAPI ~$0.01/anrop)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
