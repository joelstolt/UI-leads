#!/usr/bin/env node
/**
 * enrich-se-website.js — försök hitta hemsida + mejl för svenska bolag som
 * har telefon men saknar hemsida.
 *
 * Samma 3-fas-pipeline som enrich-no/ie-website.js, anpassad för Sverige:
 *   1. Domän-gissning: testa www.{slug}.{se|com|nu|eu}
 *   2. DuckDuckGo HTML search (om domän-gissning miss): hitta bolag-hemsida
 *   3. Email-scrape från hemsidan
 *
 * VIKTIGT: Detta skript hittar INTE allabolag.se (vi är WAF-blockade där).
 * Det hittar bara företagets egna hemsida + scrapar mejl från den.
 *
 * Filtrerar målgruppen: bara bolag med telefon (övriga är inte intressanta).
 *
 * Användning:
 *   node enrich-se-website.js                     → kör båda faserna
 *   node enrich-se-website.js --skip-ddg          → bara domän-gissning
 *   node enrich-se-website.js --limit 1000        → testa på en delmängd
 *   node enrich-se-website.js --concurrency 20    → snabbare
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");
const pLimit = require("p-limit");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

const SE_BRANCHES = [
  "Hantverkare",
  "Snickare",
  "Elektriker",
  "Takläggare",
  "Målare",
  "VVS",
  "Plåtslagare",
  "Glasmästare",
  "Markarbeten",
  "Sanering",
  "Tapetserare",
  "Smed",
  "Pool & Spa",
  "Solskydd & Markiser",
  "Isolering",
  "Trädgård & Anläggning",
  "Fasadrenovering",
  "Byggmästare m.fl.",
  "Specialiserade hantverk",
  "Trävaror & Möbler",
  "Dörrar & Portar",
];

// Sverige TLD-prio
const TLDS = [".se", ".com", ".nu", ".eu"];
const DDG_URL = "https://html.duckduckgo.com/html/?q=";

// Directory + bad final hosts
const DIRECTORY_HOSTS = new Set([
  "allabolag.se",
  "proff.se",
  "proff.no",
  "bolagsverket.se",
  "hitta.se",
  "eniro.se",
  "ratsit.se",
  "merinfo.se",
  "upplysning.se",
  "globaldatabase.com",
  "opencorporates.com",
  "creditsafe.com",
  "creditsafe.se",
  "kompass.com",
  "kompass.se",
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

const BAD_FINAL_HOSTS = new Set([
  // Svenska nyhetssajter
  "aftonbladet.se",
  "expressen.se",
  "svd.se",
  "dn.se",
  "di.se",
  "svt.se",
  "sverigesradio.se",
  "tv4.se",
  "omni.se",
  "etc.se",
  "dagensps.se",
  "byggvarlden.se",
  "byggindustrin.se",
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
  // Generiska
  "tech.eu",
  "team.se",
  "service.se",
  "ab.se",
  // Sociala
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
]);

const BAD_HOST_PATTERNS = [
  /\.bolagsverket\.se$/,
  /\.allabolag\.se$/,
  /\.proff\.se$/,
  /\.gov\.se$/,
  /\.gov$/,
  /\.regeringen\.se$/,
  /sedo\.com$/,
  /godaddy\.com$/,
];

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
  "sverige",
  "svensk",
  "swedish",
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
  "norra",
  "södra",
  "östra",
  "västra",
  // Svenska ord vanliga i bolagsnamn
  "ab",
  "bygg",
  "byggservice",
  "byggfirma",
  "hantverk",
  "handelsbolag",
  "konsult",
  "konsulter",
  "rörmokare",
  "elektriker",
  "snickare",
  "målare",
  "drift",
  "förvaltning",
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
    // Strippa svenska bolagstyper
    .replace(/\b(ab|aktiebolag|hb|handelsbolag|kb|i|the|och|och|of)\b/gi, "")
    .replace(/[^a-zåäö0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Svenska tecken → ASCII för domäner
  const asciify = (s) =>
    s.replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");

  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const candidates = new Set();
  // Hela namnet ihop
  const joined = asciify(tokens.join(""));
  if (joined.length >= 6 && joined.length <= 35) candidates.add(joined);

  // Med bindestreck
  if (tokens.length >= 2 && tokens.length <= 4) {
    const dashed = asciify(tokens.join("-"));
    if (dashed.length >= 8) candidates.add(dashed);
  }

  // Första 2 ord ihop
  if (tokens.length >= 2) {
    const twoWord = asciify(tokens[0] + tokens[1]);
    if (twoWord.length >= 8 && !GENERIC_BLOCKLIST.has(twoWord)) candidates.add(twoWord);
  }

  // Bara första ordet
  const firstAscii = asciify(tokens[0]);
  if (firstAscii.length >= 8 && !GENERIC_BLOCKLIST.has(firstAscii)) {
    candidates.add(firstAscii);
  }

  // Akronym
  if (tokens.length >= 3) {
    const acronym = asciify(tokens.map((t) => t[0]).join(""));
    if (acronym.length >= 3 && acronym.length <= 5) candidates.add(acronym);
  }

  return [...candidates];
}

// ════════════════════════════════════════════════════════════════════
// Validering
// ════════════════════════════════════════════════════════════════════

function isBadFinalHost(url) {
  try {
    const u = new URL(url);
    const fullHost = u.hostname;
    const host = fullHost.replace(/^www\./, "");
    if (BAD_FINAL_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(host)) return true;
    if (DIRECTORY_HOSTS.has(fullHost)) return true;
    for (const pattern of BAD_HOST_PATTERNS) {
      if (pattern.test(fullHost) || pattern.test(host)) return true;
    }
    if (host.endsWith(".gov") || host.endsWith(".regeringen.se")) return true;
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
        "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.7",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!r.ok) return null;

    const finalUrl = r.url || url;
    if (isBadFinalHost(finalUrl)) return null;

    const html = (await r.text()).toLowerCase();

    // Skippa parking/domain-säljare
    if (/this domain (is for sale|may be for sale)/i.test(html)) return null;
    if (/buy this domain/i.test(html)) return null;
    if (/denna domän (är till salu|kan vara till salu)/i.test(html)) return null;
    if (/domänen är till salu/i.test(html)) return null;
    if (/<title>[^<]*(domain (parking|for sale|expired))/i.test(html)) return null;
    if (html.length < 500) return null;

    // Innehållsvalidering
    const tokens = companyName
      .toLowerCase()
      .replace(/[^a-zåäö\s]/g, " ")
      .split(/\s+/)
      .filter(
        (t) =>
          t.length >= 4 &&
          !["limited", "company", "sverige", "svensk", "aktiebolag"].includes(t)
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
  const query = `${name} Sverige`;
  try {
    const r = await fetch(DDG_URL + encodeURIComponent(query), {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html",
        "Accept-Language": "sv-SE,sv;q=0.9",
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
  "@mysite.com",
  "@yourdomain.com",
  "@email.com",
  "@domain.com",
  "name@provider.com",
  "ingest.de.sentry.io",
  "ingest.us.sentry.io",
];

function cleanEmail(raw) {
  if (!raw) return "";
  return raw
    .replace(/^[%20\s]+/, "")
    .trim()
    .toLowerCase();
}

function isValidEmail(eRaw) {
  const e = cleanEmail(eRaw);
  if (!e || e.length < 5 || !e.includes("@") || !e.includes(".")) return false;
  if (EMAIL_BLOCK.some((b) => e.includes(b))) return false;
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
        "Accept-Language": "sv-SE,sv;q=0.9",
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
// CSV-export — bara bolag med telefon
// ════════════════════════════════════════════════════════════════════

const CSV_HEADERS = [
  "Företag",
  "VD",
  "Telefon",
  "Mejl",
  "Hemsida",
  "Orgnr",
  "Omsättning (kr)",
  "Anställda",
  "Adress",
  "SNI-kod",
  "Bransch",
  "Stad",
];

const csvEsc = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportSeFilteredCsv(outPath) {
  const placeholders = SE_BRANCHES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT name, firmatecknare, phone, email, website, org_nr,
              revenue, employees, address, sni_code, branch, city
       FROM companies
       WHERE branch IN (${placeholders})
         AND phone IS NOT NULL AND phone != ''
       ORDER BY branch, city, name`
    )
    .all(...SE_BRANCHES);

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
        r.employees,
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
    skipDdg: false,
    skipEmail: false,
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
    else if (args[i] === "--skip-ddg") opts.skipDdg = true;
    else if (args[i] === "--skip-email") opts.skipEmail = true;
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const outPath = (opts.out || "~/Desktop/hantverkare-sverige-med-telefon.csv").replace(
    /^~/,
    process.env.HOME
  );

  console.log("🇸🇪 enrich-se-website — hemsida + mejl för svenska bolag (med telefon)\n");
  console.log(`   Concurrency:  ${opts.concurrency}`);
  console.log(`   DuckDuckGo:   ${opts.skipDdg ? "nej" : "ja (efter domän-gissning)"}`);
  console.log(`   Email-scrape: ${opts.skipEmail ? "nej" : "ja (på funna sajter)"}`);
  console.log(`   Output:       ${outPath}`);
  console.log("");

  // Bolag att processa: SE-branscher (allabolag + hitta) MED telefon, UTAN hemsida
  const placeholders = SE_BRANCHES.map(() => "?").join(",");
  const baseQuery = `SELECT place_id, name FROM companies
                     WHERE (branch IN (${placeholders}) OR branch LIKE 'SE-Hitta-%')
                       AND phone IS NOT NULL AND phone != ''
                       AND (website IS NULL OR website = '')
                     ORDER BY name`;
  const need = opts.limit
    ? getDb().prepare(`${baseQuery} LIMIT ?`).all(...SE_BRANCHES, opts.limit)
    : getDb().prepare(baseQuery).all(...SE_BRANCHES);

  console.log(`📋 Bolag att enricha (med tel, utan hemsida): ${need.length.toLocaleString()}\n`);

  const limit = pLimit(opts.concurrency);
  const ddgLimit = pLimit(Math.min(opts.concurrency, 5));

  // ── Fas 1: Domän-gissning ────────────────────────────────────
  console.log("🎯 Fas 1/3: Domän-gissning");
  let guessedHits = 0,
    guessedDone = 0;
  const websiteFound = new Map();

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
        if (guessedDone % 50 === 0 || guessedDone === need.length) {
          const pct = Math.round((guessedDone / need.length) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${guessedDone.toLocaleString()}/${need.length.toLocaleString()} (${guessedHits.toLocaleString()} hemsidor)   `
          );
        }
      })
    )
  );
  console.log(`\n   ✅ Domän-gissning: ${guessedHits.toLocaleString()} hemsidor hittade\n`);

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
          if (ddgDone % 25 === 0 || ddgDone === stillMissing.length) {
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

  // ── Fas 3: Email-scrape (DB-baserat — alla SE+Hitta-bolag med web utan mejl) ──
  if (!opts.skipEmail) {
    const phl = SE_BRANCHES.map(() => "?").join(",");
    const dbSites = getDb()
      .prepare(
        `SELECT place_id, website FROM companies
         WHERE (branch IN (${phl}) OR branch LIKE 'SE-Hitta-%')
           AND website IS NOT NULL AND website != ''
           AND (email IS NULL OR email = '')`
      )
      .all(...SE_BRANCHES);
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
          if (emailDone % 50 === 0 || emailDone === sites.length) {
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

  // ── Export filtrerad CSV ─────────────────────────────────────
  const exported = exportSeFilteredCsv(outPath);
  console.log(`📄 CSV (filtrerad — bara med telefon): ${outPath}`);
  console.log(`   ${exported.toLocaleString()} rader\n`);

  const stats = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN firmatecknare IS NOT NULL THEN 1 ELSE 0 END) AS vd,
         SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS web,
         SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS mejl
       FROM companies WHERE branch IN (${placeholders})
         AND phone IS NOT NULL AND phone != ''`
    )
    .get(...SE_BRANCHES);
  const pct = (n) =>
    stats.total > 0 ? Math.round((n / stats.total) * 100) + "%" : "0%";
  console.log("📊 Slutstatus för svenska bolag (med telefon):");
  console.log(`   Totalt:        ${stats.total.toLocaleString()}`);
  console.log(`   Med VD:        ${stats.vd.toLocaleString()} (${pct(stats.vd)})`);
  console.log(`   Med hemsida:   ${stats.web.toLocaleString()} (${pct(stats.web)})`);
  console.log(`   Med mejl:      ${stats.mejl.toLocaleString()} (${pct(stats.mejl)})`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
