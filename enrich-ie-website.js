#!/usr/bin/env node
/**
 * enrich-ie-website.js — försök hitta hemsida + mejl för irländska bolag
 *
 * För varje bolag i leads.db med branch LIKE 'IE-%' och saknar hemsida:
 *   1. Domän-gissning: testa www.{slug}.{ie|com|co.ie|...}
 *   2. DuckDuckGo HTML search (om domän-gissning miss): hitta bolag-hemsida
 *   3. Email-scrape från hemsidan
 *
 * Användning:
 *   node enrich-ie-website.js                     → kör båda faserna
 *   node enrich-ie-website.js --skip-ddg          → bara domän-gissning (snabbt)
 *   node enrich-ie-website.js --limit 1000        → testa på en delmängd
 *   node enrich-ie-website.js --concurrency 20    → snabbare för domain-guess
 *   node enrich-ie-website.js --skip-email        → hoppa email-scrape
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");
const pLimit = require("p-limit");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

const TLDS = [".ie", ".com", ".co.ie", ".eu"];
const DDG_URL = "https://html.duckduckgo.com/html/?q=";

// Directory-sajter att filtrera bort när vi söker företagshemsidor
const DIRECTORY_HOSTS = new Set([
  "solocheck.ie",
  "globaldatabase.com",
  "opencorporates.com",
  "creditsafe.com",
  "companycheck.ie",
  "vision-net.ie",
  "cro.ie",
  "data.gov.ie",
  "goldenpages.ie",
  "yelp.com",
  "yelp.ie",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "indeed.ie",
  "indeed.com",
  "glassdoor.com",
  "wikipedia.org",
  "duckduckgo.com",
  "google.com",
  "bing.com",
  "trustpilot.com",
  "trustpilot.ie",
  "checkbusiness.ie",
  "europages.ie",
  "europages.com",
  "kompass.com",
  "manta.com",
  "ie.dnb.com",
  "dnb.com",
  "businessfocus.ie",
]);

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════
// Slug-generering — flera kandidater per bolag (strikt-läge)
// ════════════════════════════════════════════════════════════════════

// Generiska enord som matchar för många domäner — ALDRIG som enstaka slug
const GENERIC_BLOCKLIST = new Set([
  "team", "tech", "web", "building", "construction", "build", "service",
  "services", "group", "construct", "scaffolding", "scaffold", "electric",
  "electrical", "plumbing", "paint", "painting", "tile", "roofing", "carpentry",
  "design", "studio", "works", "ltd", "limited", "plc", "global", "international",
  "ireland", "irish", "professional", "expert", "specialists", "specialist",
  "solutions", "agency", "company", "industries", "industry", "national",
  "northern", "southern", "central", "ireland", "europe", "european",
  "premier", "elite", "premium", "quality", "best", "first",
]);

function slugCandidates(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/\b(limited|ltd|plc|llc|inc|co|company|the|and|of)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const candidates = new Set();

  // Hela namnet ihop (alltid bra om 8+ tecken)
  const joined = tokens.join("");
  if (joined.length >= 6 && joined.length <= 35) candidates.add(joined);

  // Med bindestreck (för flerords-namn med 2-3 tokens)
  if (tokens.length >= 2 && tokens.length <= 4) {
    const dashed = tokens.join("-");
    if (dashed.length >= 8) candidates.add(dashed);
  }

  // Första 2 ord ihop (vanligt mönster för bolag som "robinson builds" → robinson + builds)
  if (tokens.length >= 2) {
    const twoWord = tokens[0] + tokens[1];
    if (twoWord.length >= 8 && !GENERIC_BLOCKLIST.has(twoWord)) candidates.add(twoWord);
  }

  // Bara första ordet OM det är specifikt nog (8+ chars, inte i blocklist)
  if (tokens[0].length >= 8 && !GENERIC_BLOCKLIST.has(tokens[0])) {
    candidates.add(tokens[0]);
  }

  // Akronym (3+ tokens, 3-5 bokstäver) — exempel: PES för Powertech Electrical Services
  if (tokens.length >= 3) {
    const acronym = tokens.map((t) => t[0]).join("");
    if (acronym.length >= 3 && acronym.length <= 5) candidates.add(acronym);
  }

  return [...candidates];
}

// ════════════════════════════════════════════════════════════════════
// Domän-gissning
// ════════════════════════════════════════════════════════════════════

// Domäner att aldrig acceptera (parking, news, domain-säljare, generiska)
const BAD_FINAL_HOSTS = new Set([
  "independent.ie", "irishtimes.com", "rte.ie", "thejournal.ie",
  "businesspost.ie", "irishnews.com", "fruits.co", "sedo.com",
  "godaddy.com", "namecheap.com", "hugedomains.com", "dan.com",
  "domainmarket.com", "buydomains.com", "saw.com", "afternic.com",
  "tech.eu", "scaffolding.com", "team.ie", "web.ie",
  "facebook.com", "linkedin.com", "twitter.com", "instagram.com",
  "youtube.com", "wikipedia.org",
]);

function isBadFinalHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (BAD_FINAL_HOSTS.has(host)) return true;
    if (host.endsWith(".gov.ie") || host.endsWith(".gov")) return true;
    if (/^(sedo|godaddy|park|hugedomains|dan|afternic|fruits)\./i.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

// Heuristik: validerar att URL faktiskt är bolagets sajt, inte en parkering/nyhet
async function validateAndFetchUrl(url, companyName) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return null;

    const finalUrl = r.url || url;
    if (isBadFinalHost(finalUrl)) return null;

    const html = (await r.text()).toLowerCase();

    // Innehållsvalidering: skippa domain-säljare och parkering
    if (/this domain (is for sale|may be for sale)/i.test(html)) return null;
    if (/buy this domain/i.test(html)) return null;
    if (/<title>[^<]*(domain (parking|for sale|expired))/i.test(html)) return null;
    if (html.length < 500) return null; // för kort = parking-page

    // Heuristik: åtminstone EN av bolagets distinkta tokens (4+ chars) bör finnas
    const tokens = companyName
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !["limited", "company", "ireland"].includes(t));

    if (tokens.length === 0) return finalUrl; // kan inte validera, acceptera

    const matchCount = tokens.filter((t) => html.includes(t)).length;
    if (matchCount === 0) return null; // namnet INGENSTANS på sidan = fel match

    return finalUrl;
  } catch {
    return null;
  }
}

async function guessDomain(name) {
  const slugs = slugCandidates(name);
  if (slugs.length === 0) return null;

  // Testa varje slug × TLD med GET + validering
  for (const slug of slugs) {
    for (const tld of TLDS) {
      const variants = [`https://www.${slug}${tld}`, `https://${slug}${tld}`];
      for (const url of variants) {
        const validated = await validateAndFetchUrl(url, name);
        if (validated) return validated;
      }
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// DuckDuckGo HTML search
// ════════════════════════════════════════════════════════════════════

function decodeDdgRedirect(href) {
  // href är /l/?uddg=https%3A%2F%2Fexample.com%2F
  try {
    const m = href.match(/uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return null;
}

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function ddgSearchWebsite(name, address) {
  const query = `${name} Ireland`;
  try {
    const r = await fetch(DDG_URL + encodeURIComponent(query), {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html",
        "Accept-Language": "en-IE,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Plocka ut alla resultat-URLer
    const matches = [...html.matchAll(/<a[^>]+class="result__url[^"]*"[^>]+href="([^"]+)"/g)];
    for (const m of matches) {
      const realUrl = decodeDdgRedirect(m[1]);
      if (!realUrl) continue;
      const host = extractHostname(realUrl);
      if (!host) continue;
      // Filtrera bort directory-sajter
      if (DIRECTORY_HOSTS.has(host)) continue;
      if (BAD_FINAL_HOSTS.has(host)) continue;
      if (host.endsWith(".gov.ie") || host.endsWith(".gov")) continue;
      // Validera att sidan faktiskt nämner bolaget
      const validated = await validateAndFetchUrl(realUrl, name);
      if (validated) return validated;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Email-scrape (delas med simple-leads.js)
// ════════════════════════════════════════════════════════════════════

const EMAIL_BLOCK = [
  "@example",
  "@test.",
  "@sentry.",
  "@cdn.",
  "@google",
  "@facebook",
  "@apple",
  "@microsoft",
  "@wix.com",
  "@squarespace",
  "@godaddy",
];

function isValidEmail(e) {
  if (!e || e.length < 5 || !e.includes("@") || !e.includes(".")) return false;
  return !EMAIL_BLOCK.some((b) => e.toLowerCase().includes(b));
}

async function scrapeEmails(website) {
  if (!website) return [];
  let url = website.trim();
  if (!url.startsWith("http")) url = `https://${url}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-IE,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const found = new Set();
    const mr = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
    let m;
    while ((m = mr.exec(html))) found.add(m[1].toLowerCase());
    const tr = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    while ((m = tr.exec(html))) found.add(m[0].toLowerCase());
    return [...found].filter(isValidEmail).slice(0, 3);
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
// DB-helpers
// ════════════════════════════════════════════════════════════════════

function setWebsite(placeId, website) {
  if (!website) return;
  getDb()
    .prepare("UPDATE companies SET website = ?, updated_at = datetime('now') WHERE place_id = ?")
    .run(website, placeId);
}

function setEmail(placeId, email) {
  if (!email) return;
  getDb()
    .prepare(
      "UPDATE companies SET email = ?, email_scraped_at = datetime('now'), updated_at = datetime('now') WHERE place_id = ?"
    )
    .run(email, placeId);
}

// ════════════════════════════════════════════════════════════════════
// CSV-export (uppdatera Irlands CSV med nya hemsidor + mejl)
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Company",
  "Number",
  "Phone",
  "Email",
  "Website",
  "Address",
  "Eircode",
  "NACE Code",
  "Branch",
  "Type",
  "Reg Date",
  "Status",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportIrlandCsv(outPath) {
  const rows = getDb()
    .prepare(
      `SELECT name, org_nr, phone, email, website, address, sni_code, branch
       FROM companies WHERE branch LIKE 'IE-%' ORDER BY branch, name`
    )
    .all();
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.org_nr,
        r.phone,
        r.email,
        r.website,
        r.address,
        "", // eircode (inte i DB)
        r.sni_code,
        r.branch,
        "",
        "",
        "Normal",
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return rows.length;
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: null,
    concurrency: 15,
    skipGuess: false,
    skipDdg: false,
    skipEmail: false,
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
    else if (args[i] === "--skip-guess") opts.skipGuess = true;
    else if (args[i] === "--skip-ddg") opts.skipDdg = true;
    else if (args[i] === "--skip-email") opts.skipEmail = true;
    else if (args[i] === "--email-only") {
      opts.skipGuess = true;
      opts.skipDdg = true;
    }
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const outPath = (opts.out || "~/Desktop/leads-ireland-hantverkare.csv").replace(
    /^~/,
    process.env.HOME
  );

  console.log("🇮🇪 enrich-ie-website — hemsida + mejl för irländska bolag\n");
  console.log(`   Concurrency:  ${opts.concurrency}`);
  console.log(`   DuckDuckGo:   ${opts.skipDdg ? "nej" : "ja (efter domän-gissning)"}`);
  console.log(`   Email-scrape: ${opts.skipEmail ? "nej" : "ja (på funna sajter)"}`);
  console.log("");

  // Bolag att processa: irländska utan hemsida
  const baseQuery = `SELECT place_id, name, address FROM companies
                     WHERE branch LIKE 'IE-%' AND (website IS NULL OR website = '')
                     ORDER BY name`;
  const need = opts.limit
    ? getDb().prepare(`${baseQuery} LIMIT ?`).all(opts.limit)
    : getDb().prepare(baseQuery).all();

  console.log(`📋 Bolag att enricha: ${need.length.toLocaleString()}\n`);

  const limit = pLimit(opts.concurrency);
  const ddgLimit = pLimit(Math.min(opts.concurrency, 5)); // DDG vill vi ha snällare på

  // ── Fas 1: Domän-gissning ────────────────────────────────────
  const websiteFound = new Map(); // place_id → url
  if (!opts.skipGuess) {
    console.log("🎯 Fas 1/3: Domän-gissning");
    let guessedHits = 0,
      guessedDone = 0;

    await Promise.all(
      need.map((c) =>
        limit(async () => {
          const url = await guessDomain(c.name);
          if (url) {
            websiteFound.set(c.place_id, url);
            setWebsite(c.place_id, url);
            guessedHits++;
          }
          guessedDone++;
          if (guessedDone % 100 === 0 || guessedDone === need.length) {
            const pct = Math.round((guessedDone / need.length) * 100);
            process.stdout.write(
              `\r   [${String(pct).padStart(3)}%] ${guessedDone.toLocaleString()}/${need.length.toLocaleString()} (${guessedHits.toLocaleString()} hemsidor hittade)   `
            );
          }
        })
      )
    );
    console.log(`\n   ✅ Domän-gissning: ${guessedHits.toLocaleString()} hemsidor hittade\n`);
  } else {
    console.log("🎯 Fas 1/3: Skippas (--skip-guess)\n");
  }

  // ── Fas 2: DuckDuckGo för dem som inte fick träff ────────────
  if (!opts.skipDdg) {
    const stillMissing = need.filter((c) => !websiteFound.has(c.place_id));
    console.log(`🦆 Fas 2/3: DuckDuckGo för ${stillMissing.length.toLocaleString()} bolag utan domän-träff`);
    let ddgHits = 0,
      ddgDone = 0;

    await Promise.all(
      stillMissing.map((c) =>
        ddgLimit(async () => {
          const url = await ddgSearchWebsite(c.name, c.address);
          if (url) {
            websiteFound.set(c.place_id, url);
            setWebsite(c.place_id, url);
            ddgHits++;
          }
          ddgDone++;
          if (ddgDone % 50 === 0 || ddgDone === stillMissing.length) {
            const pct = Math.round((ddgDone / stillMissing.length) * 100);
            process.stdout.write(
              `\r   [${String(pct).padStart(3)}%] ${ddgDone.toLocaleString()}/${stillMissing.length.toLocaleString()} (${ddgHits.toLocaleString()} hemsidor)   `
            );
          }
          // DDG vill vi vara snälla mot — lägg in extra delay
          await sleep(500 + Math.random() * 500);
        })
      )
    );
    console.log(`\n   ✅ DuckDuckGo: ${ddgHits.toLocaleString()} ytterligare hemsidor hittade\n`);
  }

  // ── Fas 3: Email-scrape (DB-baserat — alla IE-bolag med web utan mejl) ──
  if (!opts.skipEmail) {
    const dbSites = getDb()
      .prepare(
        `SELECT place_id, website FROM companies
         WHERE branch LIKE 'IE-%' AND website IS NOT NULL AND website != ''
           AND (email IS NULL OR email = '')`
      )
      .all();
    const sites = dbSites.map((r) => [r.place_id, r.website]);
    console.log(`📧 Fas 3/3: Email-scrape från ${sites.length.toLocaleString()} hemsidor`);
    let emailHits = 0,
      emailDone = 0;

    await Promise.all(
      sites.map(([placeId, url]) =>
        limit(async () => {
          const emails = await scrapeEmails(url);
          if (emails.length) {
            setEmail(placeId, emails[0]);
            emailHits++;
          }
          emailDone++;
          if (emailDone % 100 === 0 || emailDone === sites.length) {
            const pct = Math.round((emailDone / sites.length) * 100);
            process.stdout.write(
              `\r   [${String(pct).padStart(3)}%] ${emailDone.toLocaleString()}/${sites.length.toLocaleString()} (${emailHits.toLocaleString()} mejl)   `
            );
          }
        })
      )
    );
    console.log(`\n   ✅ Email-scrape: ${emailHits.toLocaleString()} mejl hittade\n`);
  }

  // ── Export ──
  const exported = exportIrlandCsv(outPath);
  console.log(`📄 CSV uppdaterad: ${outPath}  (${exported.toLocaleString()} rader)\n`);

  // ── Sammanfattning ──
  const stats = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS web,
         SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS mejl
       FROM companies WHERE branch LIKE 'IE-%'`
    )
    .get();
  const pct = (n) =>
    stats.total > 0 ? Math.round((n / stats.total) * 100) + "%" : "0%";
  console.log("📊 Slutstatus för irländska bolag:");
  console.log(`   Totalt:        ${stats.total.toLocaleString()}`);
  console.log(`   Med hemsida:   ${stats.web.toLocaleString()} (${pct(stats.web)})`);
  console.log(`   Med mejl:      ${stats.mejl.toLocaleString()} (${pct(stats.mejl)})`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
