#!/usr/bin/env node
/**
 * enrich-no-website.js — försök hitta hemsida + mejl för norska bolag som
 * inte har hemsida registrerad i BRREG.
 *
 * Samma 3-fas-pipeline som enrich-ie-website.js, anpassad för Norge:
 *   1. Domän-gissning: testa www.{slug}.{no|com|eu}
 *   2. DuckDuckGo HTML search (om domän-gissning miss): hitta bolag-hemsida
 *   3. Email-scrape från hemsidan (utöver det BRREG redan gav)
 *
 * Användning:
 *   node enrich-no-website.js                     → kör båda faserna
 *   node enrich-no-website.js --skip-ddg          → bara domän-gissning
 *   node enrich-no-website.js --limit 1000        → testa på en delmängd
 *   node enrich-no-website.js --concurrency 20    → snabbare
 *   node enrich-no-website.js --skip-email        → hoppa email-scrape
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");
const pLimit = require("p-limit");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

// Norge TLD-prio: .no först, sen .com, sen .eu/.org
const TLDS = [".no", ".com", ".eu", ".org"];
const DDG_URL = "https://html.duckduckgo.com/html/?q=";

// Directory-sajter och bad final hosts (norska + internationella)
const DIRECTORY_HOSTS = new Set([
  "proff.no",
  "1881.no",
  "gulesider.no",
  "regnskapstall.no",
  "purehelp.no",
  "brreg.no",
  "data.brreg.no",
  "virksomhet.brreg.no", // BRREG-sida OM bolaget — inte deras hemsida!
  "w2.brreg.no",
  "globaldatabase.com",
  "opencorporates.com",
  "creditsafe.com",
  "creditsafe.no",
  "kompass.com",
  "kompass.no",
  "bizweb.no",
  "21st.ai", // AI-genererade bolagssidor
  "norway-business.no",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
  "duckduckgo.com",
  "google.com",
  "bing.com",
]);

// Hostname-suffixar att blockera (regex-match)
const BAD_HOST_PATTERNS = [
  /\.brreg\.no$/, // ALLA brreg-subdomäner
  /\.regjeringen\.no$/,
  /\.gov$/,
  /\.gov\.no$/,
  /^www\.21st\.ai$/,
  /sedo\.com$/,
  /godaddy\.com$/,
];

const BAD_FINAL_HOSTS = new Set([
  // Norska nyhetssajter
  "vg.no",
  "dagbladet.no",
  "aftenposten.no",
  "nrk.no",
  "nettavisen.no",
  "tv2.no",
  "e24.no",
  "dn.no",
  "ba.no",
  "smp.no",
  "adressa.no",
  "bt.no",
  // Domain-säljare
  "sedo.com",
  "godaddy.com",
  "namecheap.com",
  "hugedomains.com",
  "dan.com",
  "domainmarket.com",
  "buydomains.com",
  "afternic.com",
  "fruits.co",
  // Generiska som matchar för många
  "tech.eu",
  "team.no",
  "service.no",
  "as.no",
  // Sociala
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
]);

// Generiska enord — aldrig acceptera som ENDA slug
const GENERIC_BLOCKLIST = new Set([
  "team",
  "tech",
  "web",
  "service",
  "services",
  "group",
  "construct",
  "construction",
  "build",
  "building",
  "scaffold",
  "scaffolding",
  "electric",
  "electrical",
  "plumbing",
  "paint",
  "painting",
  "tile",
  "roofing",
  "carpentry",
  "design",
  "studio",
  "works",
  "limited",
  "ltd",
  "global",
  "international",
  "norge",
  "norsk",
  "norway",
  "norwegian",
  "professional",
  "expert",
  "specialists",
  "specialist",
  "solutions",
  "agency",
  "company",
  "premier",
  "elite",
  "premium",
  "quality",
  "first",
  "central",
  "northern",
  "southern",
  // Norska ord vanliga i bolagsnamn
  "as",
  "ans",
  "anlegg",
  "bygg",
  "byggservice",
  "byggfirma",
  "håndverk",
  "rør",
  "rørlegger",
  "elektro",
  "tømrer",
  "snekker",
  "maler",
  "malerfirma",
  "consult",
  "consulting",
  "konsult",
  "drift",
]);

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════
// Slug-generering
// ════════════════════════════════════════════════════════════════════

function slugCandidates(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/['"]/g, "")
    // Strippa norska bolagstyper
    .replace(/\b(as|ans|asa|ba|enk|nuf|sa|stiftelse|forening|the|and|og)\b/gi, "")
    .replace(/[^a-zæøå0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Norska tecken → ASCII för domäner
  const asciify = (s) =>
    s.replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a");

  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const candidates = new Set();
  // Hela namnet ihop
  const joined = asciify(tokens.join(""));
  if (joined.length >= 6 && joined.length <= 35) candidates.add(joined);

  // Med bindestreck (2-4 tokens)
  if (tokens.length >= 2 && tokens.length <= 4) {
    const dashed = asciify(tokens.join("-"));
    if (dashed.length >= 8) candidates.add(dashed);
  }

  // Första 2 ord ihop
  if (tokens.length >= 2) {
    const twoWord = asciify(tokens[0] + tokens[1]);
    if (twoWord.length >= 8 && !GENERIC_BLOCKLIST.has(twoWord)) candidates.add(twoWord);
  }

  // Bara första ordet (om specifikt nog)
  const firstAscii = asciify(tokens[0]);
  if (firstAscii.length >= 8 && !GENERIC_BLOCKLIST.has(firstAscii)) {
    candidates.add(firstAscii);
  }

  // Akronym (3+ tokens, 3-5 bokstäver)
  if (tokens.length >= 3) {
    const acronym = asciify(tokens.map((t) => t[0]).join(""));
    if (acronym.length >= 3 && acronym.length <= 5) candidates.add(acronym);
  }

  return [...candidates];
}

// ════════════════════════════════════════════════════════════════════
// Validering: GET sida + kolla att det är riktig company-sajt
// ════════════════════════════════════════════════════════════════════

function isBadFinalHost(url) {
  try {
    const u = new URL(url);
    const fullHost = u.hostname; // inkl www
    const host = fullHost.replace(/^www\./, "");
    if (BAD_FINAL_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(fullHost)) return true; // matcha även med www
    for (const pattern of BAD_HOST_PATTERNS) {
      if (pattern.test(fullHost) || pattern.test(host)) return true;
    }
    if (host.endsWith(".gov") || host.endsWith(".regjeringen.no")) return true;
    if (/^(sedo|godaddy|park|hugedomains|dan|afternic|fruits)\./i.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

async function validateAndFetchUrl(url, companyName) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "no-NO,no;q=0.9,sv;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return null;

    const finalUrl = r.url || url;
    if (isBadFinalHost(finalUrl)) return null;

    const html = (await r.text()).toLowerCase();

    // Skippa domain-säljare och parking
    if (/this domain (is for sale|may be for sale)/i.test(html)) return null;
    if (/buy this domain/i.test(html)) return null;
    if (/dette domenet er til salgs/i.test(html)) return null;
    if (/<title>[^<]*(domain (parking|for sale|expired))/i.test(html)) return null;
    if (html.length < 500) return null;

    // Innehållsvalidering: åtminstone EN av bolagets tokens (4+ chars) bör finnas
    const tokens = companyName
      .toLowerCase()
      .replace(/[^a-zæøå\s]/g, " ")
      .split(/\s+/)
      .filter(
        (t) =>
          t.length >= 4 &&
          !["limited", "company", "norge", "norsk"].includes(t)
      );

    if (tokens.length === 0) return finalUrl;
    const matchCount = tokens.filter((t) => html.includes(t)).length;
    if (matchCount === 0) return null;

    return finalUrl;
  } catch {
    return null;
  }
}

async function guessDomain(name) {
  const slugs = slugCandidates(name);
  if (slugs.length === 0) return null;
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
// DuckDuckGo
// ════════════════════════════════════════════════════════════════════

function decodeDdgRedirect(href) {
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

async function ddgSearchWebsite(name) {
  const query = `${name} Norge`;
  try {
    const r = await fetch(DDG_URL + encodeURIComponent(query), {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html",
        "Accept-Language": "no-NO,no;q=0.9,sv;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    const matches = [...html.matchAll(/<a[^>]+class="result__url[^"]*"[^>]+href="([^"]+)"/g)];
    for (const m of matches) {
      const realUrl = decodeDdgRedirect(m[1]);
      if (!realUrl) continue;
      const host = extractHostname(realUrl);
      if (!host) continue;
      if (DIRECTORY_HOSTS.has(host)) continue;
      if (BAD_FINAL_HOSTS.has(host)) continue;
      const validated = await validateAndFetchUrl(realUrl, name);
      if (validated) return validated;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Email-scrape
// ════════════════════════════════════════════════════════════════════

const EMAIL_BLOCK = [
  "@example",
  "@test.",
  "@sentry.",
  ".sentry.io",
  "@cdn.",
  "@google",
  "@facebook",
  "@apple",
  "@microsoft",
  "@wix.com",
  "@squarespace",
  "@godaddy",
  "@mysite.com", // Wix default placeholder
  "@yourdomain.com", // template placeholder
  "@email.com",
  "@domain.com",
  "name@provider.com",
  "ingest.de.sentry.io",
  "ingest.us.sentry.io",
];

function cleanEmail(raw) {
  if (!raw) return "";
  // Trimma %20-prefix och whitespace
  return raw
    .replace(/^[%20\s]+/, "")
    .trim()
    .toLowerCase();
}

function isValidEmail(eRaw) {
  const e = cleanEmail(eRaw);
  if (!e || e.length < 5 || !e.includes("@") || !e.includes(".")) return false;
  if (EMAIL_BLOCK.some((b) => e.includes(b))) return false;
  // Skippa hash-baserade emails (Sentry, tracking)
  if (/^[a-f0-9]{32,}@/.test(e)) return false;
  return true;
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
        "Accept-Language": "no-NO,no;q=0.9,sv;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const found = new Set();
    const mr = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
    let m;
    while ((m = mr.exec(html))) found.add(cleanEmail(m[1]));
    const tr = /[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    while ((m = tr.exec(html))) found.add(cleanEmail(m[0]));
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
    .prepare(
      "UPDATE companies SET website = ?, updated_at = datetime('now') WHERE place_id = ?"
    )
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
// CSV-export
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Företag",
  "VD",
  "Telefon",
  "Mejl",
  "Hemsida",
  "Orgnr",
  "Aksjekapital (NOK)",
  "Adress",
  "NACE-kod",
  "Bransch",
  "Stad",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportNorgeCsv(outPath) {
  const rows = getDb()
    .prepare(
      `SELECT name, firmatecknare, phone, email, website, org_nr,
              revenue, address, sni_code, branch, city
       FROM companies WHERE branch LIKE 'NO-%' ORDER BY branch, city, name`
    )
    .all();
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    let vd = "";
    if (r.firmatecknare) {
      try {
        const arr = JSON.parse(r.firmatecknare);
        vd = Array.isArray(arr) ? arr[0] || "" : "";
      } catch {
        vd = r.firmatecknare;
      }
    }
    lines.push(
      [
        r.name,
        vd,
        r.phone,
        r.email,
        r.website,
        r.org_nr,
        r.revenue,
        r.address,
        r.sni_code,
        r.branch,
        r.city,
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
  const outPath = (opts.out || "~/Desktop/leads-norge-hantverkare.csv").replace(
    /^~/,
    process.env.HOME
  );

  console.log("🇳🇴 enrich-no-website — hemsida + mejl för norska bolag\n");
  console.log(`   Concurrency:  ${opts.concurrency}`);
  console.log(`   DuckDuckGo:   ${opts.skipDdg ? "nej" : "ja (efter domän-gissning)"}`);
  console.log(`   Email-scrape: ${opts.skipEmail ? "nej" : "ja (på funna sajter)"}`);
  console.log("");

  const baseQuery = `SELECT place_id, name, address FROM companies
                     WHERE branch LIKE 'NO-%' AND (website IS NULL OR website = '')
                     ORDER BY name`;
  const need = opts.limit
    ? getDb().prepare(`${baseQuery} LIMIT ?`).all(opts.limit)
    : getDb().prepare(baseQuery).all();

  console.log(`📋 Bolag att enricha: ${need.length.toLocaleString()}\n`);

  const limit = pLimit(opts.concurrency);
  const ddgLimit = pLimit(Math.min(opts.concurrency, 5));

  // ── Fas 1: Domän-gissning ────────────────────────────────────
  const websiteFound = new Map();
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
              `\r   [${String(pct).padStart(3)}%] ${guessedDone.toLocaleString()}/${need.length.toLocaleString()} (${guessedHits.toLocaleString()} hemsidor)   `
            );
          }
        })
      )
    );
    console.log(`\n   ✅ Domän-gissning: ${guessedHits.toLocaleString()} hemsidor hittade\n`);
  } else {
    console.log("🎯 Fas 1/3: Skippas (--skip-guess)\n");
  }

  // ── Fas 2: DuckDuckGo ────────────────────────────────────────
  if (!opts.skipDdg) {
    const stillMissing = need.filter((c) => !websiteFound.has(c.place_id));
    console.log(`🦆 Fas 2/3: DuckDuckGo för ${stillMissing.length.toLocaleString()} utan domän-träff`);
    let ddgHits = 0,
      ddgDone = 0;

    await Promise.all(
      stillMissing.map((c) =>
        ddgLimit(async () => {
          const url = await ddgSearchWebsite(c.name);
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
          await sleep(500 + Math.random() * 500);
        })
      )
    );
    console.log(`\n   ✅ DuckDuckGo: ${ddgHits.toLocaleString()} ytterligare hemsidor\n`);
  }

  // ── Fas 3: Email-scrape (DB-baserat — alla NO-bolag med web utan mejl) ──
  if (!opts.skipEmail) {
    const dbSites = getDb()
      .prepare(
        `SELECT place_id, website FROM companies
         WHERE branch LIKE 'NO-%' AND website IS NOT NULL AND website != ''
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

  const exported = exportNorgeCsv(outPath);
  console.log(`📄 CSV uppdaterad: ${outPath}  (${exported.toLocaleString()} rader)\n`);

  const stats = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN firmatecknare IS NOT NULL THEN 1 ELSE 0 END) AS vd,
         SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) AS tel,
         SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS web,
         SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS mejl
       FROM companies WHERE branch LIKE 'NO-%'`
    )
    .get();
  const pct = (n) =>
    stats.total > 0 ? Math.round((n / stats.total) * 100) + "%" : "0%";
  console.log("📊 Slutstatus för norska bolag:");
  console.log(`   Totalt:        ${stats.total.toLocaleString()}`);
  console.log(`   Med VD:        ${stats.vd.toLocaleString()} (${pct(stats.vd)})`);
  console.log(`   Med telefon:   ${stats.tel.toLocaleString()} (${pct(stats.tel)})`);
  console.log(`   Med hemsida:   ${stats.web.toLocaleString()} (${pct(stats.web)})`);
  console.log(`   Med mejl:      ${stats.mejl.toLocaleString()} (${pct(stats.mejl)})`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
