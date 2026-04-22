/**
 * enrich.js — Email-scraping + PageSpeed Insights
 *
 * Användning:
 *   node enrich.js                    → kör både email och pagespeed
 *   node enrich.js --email-only       → bara email-scraping
 *   node enrich.js --pagespeed-only   → bara PageSpeed
 *   node enrich.js --limit 100        → max 100 bolag per steg
 *
 * Kräver: PAGESPEED_API_KEY i .env (valfritt — funkar utan men med rate limits)
 */

require("dotenv").config({ override: true });
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const cheerio = require("cheerio");
const {
  getCompaniesNeedingEmail,
  getCompaniesNeedingPagespeed,
  updateEmail,
  updatePagespeed,
  getStats,
} = require("./db");

const PSI_KEY = process.env.PAGESPEED_API_KEY || "";

// Filtrera bort generiska/tekniska adresser som inte är kontaktbara
const EMAIL_BLOCKLIST = [
  "noreply", "no-reply", "donotreply", "mailer-daemon", "postmaster",
  "abuse", "admin@cdn", "support@wix", "wixpress.com", "squarespace.com",
  "shopify.com", "wordpress.com", "googletagmanager", "sentry.io",
  "@2x.", ".png", ".jpg", ".svg", ".gif", "example.com", "example.org",
  "test@", "@test.", "schema.org", "w3.org", "fontawesome",
];

function isValidEmail(email) {
  if (!email || email.length < 5) return false;
  if (!email.includes("@") || !email.includes(".")) return false;
  const lower = email.toLowerCase();
  return !EMAIL_BLOCKLIST.some((b) => lower.includes(b));
}

/**
 * Hämta HTML från en URL med timeout
 */
async function fetchHTML(url, timeoutMs = 10000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LeadScraper/2.0; +https://stoltmarketing.se)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Extrahera e-postadresser från HTML
 */
function extractEmails(html) {
  const emails = new Set();

  // mailto:-länkar (mest pålitliga)
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) {
    emails.add(m[1].toLowerCase());
  }

  // Textmönster
  const textRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  while ((m = textRe.exec(html)) !== null) {
    emails.add(m[0].toLowerCase());
  }

  return [...emails].filter(isValidEmail).slice(0, 5);
}

/**
 * Hitta kontaktsidans URL i HTML (cheerio)
 */
function findContactUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().toLowerCase();
    const hrefLower = href.toLowerCase();

    const isContact =
      text.includes("kontakt") || text.includes("contact") ||
      text.includes("om oss") || text.includes("about") ||
      hrefLower.includes("kontakt") || hrefLower.includes("contact") ||
      hrefLower.includes("om-oss") || hrefLower.includes("about");

    if (isContact && href && !href.startsWith("#") && !href.startsWith("tel:") && !href.startsWith("mailto:")) {
      try {
        candidates.push(new URL(href, baseUrl).toString());
      } catch {
        // ogiltigt href, skippa
      }
    }
  });

  return candidates[0] || null;
}

/**
 * Scrapa email från en hemsida — försöker startsidan, sen /kontakt och /om-oss
 */
async function scrapeEmail(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const base = new URL(cleanUrl);

  // Startsidan
  let homeHtml = null;
  try {
    homeHtml = await fetchHTML(cleanUrl);
  } catch {
    return null;
  }

  const homeEmails = extractEmails(homeHtml);
  if (homeEmails.length > 0) return homeEmails[0];

  // Försök hitta kontaktsida i navlänkar
  const contactUrl = findContactUrl(homeHtml, cleanUrl);

  // Kör /kontakt, /om-oss och hittad kontaktsida parallellt
  const subpages = [
    contactUrl,
    `${base.origin}/kontakt`,
    `${base.origin}/om-oss`,
    `${base.origin}/contact`,
    `${base.origin}/about`,
  ].filter(Boolean);

  const uniqueSubpages = [...new Set(subpages)];

  for (const url of uniqueSubpages.slice(0, 3)) {
    try {
      const html = await fetchHTML(url, 8000);
      const emails = extractEmails(html);
      if (emails.length > 0) return emails[0];
    } catch {
      // Sidan finns inte — fortsätt
    }
  }

  return null;
}

// ── PageSpeed ────────────────────────────────────────────────

/**
 * Kör PageSpeed Insights och returnera nyckeltal
 */
async function analyzePagespeed(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  apiUrl.searchParams.set("url", cleanUrl);
  apiUrl.searchParams.set("strategy", "mobile");
  apiUrl.searchParams.append("category", "performance");
  apiUrl.searchParams.append("category", "seo");
  apiUrl.searchParams.append("category", "accessibility");
  if (PSI_KEY) apiUrl.searchParams.set("key", PSI_KEY);

  const data = await pRetry(
    async () => {
      const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(40000) });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json;
    },
    { retries: 2, minTimeout: 3000 }
  );

  const cats   = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};

  // Skydda mot partiella mätningar: om varken speed-index eller någon av
  // scoresena finns har Lighthouse misslyckats — kasta så main() sparar all-null
  // istället för att lagra felaktiga 0-värden som inte går att skilja från
  // riktig 0/100.
  const hasSpeedIndex = audits["speed-index"]?.displayValue;
  const hasAnyScore =
    cats.performance?.score != null ||
    cats.seo?.score != null ||
    cats.accessibility?.score != null;
  if (!hasSpeedIndex && !hasAnyScore) {
    throw new Error("Lighthouse-svar saknar både scores och speed-index — partial mätning");
  }

  // null när score saknas (= ej mätt), inte 0
  const score = (s) => (s == null ? null : Math.round(s * 100));

  // mobile_friendly baseras på viewport-audit, INTE på seo-kategorins totalscore.
  // Om viewport-audit saknas helt → null (okänt), inte "Nej" (misvisande).
  const viewportScore  = audits["viewport"]?.score;
  const tapScore       = audits["tap-targets"]?.score ?? 1;
  const fontSizeScore  = audits["font-size"]?.score ?? 1;
  const mobileFriendly =
    viewportScore == null ? null :
    viewportScore === 1 && tapScore >= 0.8 && fontSizeScore >= 0.8 ? "Ja" : "Nej";

  return {
    performance:    score(cats.performance?.score),
    seo:            score(cats.seo?.score),
    accessibility:  score(cats.accessibility?.score),
    mobile_friendly: mobileFriendly,
    load_time:      audits["speed-index"]?.displayValue || null,
  };
}

function calculatePriority(pagespeed, company) {
  let points = 0;

  // Skydda alla checks mot null/undefined så aldrig-mätta värden inte
  // adderas som "0" eller bedöms som dåliga (poäng pga "låg SEO").
  if (pagespeed.seo != null) {
    if (pagespeed.seo <= 50)       points += 4;
    else if (pagespeed.seo <= 70)  points += 2;
    else if (pagespeed.seo <= 80)  points += 1;
  }

  if (pagespeed.performance != null) {
    if (pagespeed.performance <= 40)       points += 3;
    else if (pagespeed.performance <= 60)  points += 2;
    else if (pagespeed.performance <= 75)  points += 1;
  }

  if (pagespeed.mobile_friendly === "Nej") points += 2;

  // company.rating / company.reviews kan vara null (Google Maps sätter inte
  // alltid betyg/recensioner). Hoppa över om saknas — räkna inte 0-stjärnor
  // som "fanns och var dåligt".
  const rating = company.rating != null ? parseFloat(company.rating) : null;
  if (rating != null && !isNaN(rating)) {
    if (rating >= 4.5)      points += 2;
    else if (rating >= 4.0) points += 1;
  }

  const reviews = company.reviews != null ? parseInt(company.reviews) : null;
  if (reviews != null && !isNaN(reviews)) {
    if (reviews >= 50)      points += 2;
    else if (reviews >= 20) points += 1;
  }

  if (points >= 8) return "🔥 A+";
  if (points >= 5) return "🟡 A";
  if (points >= 3) return "🔵 B";
  return "⚪ C";
}

// ── Huvudprogram ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let emailOnly    = args.includes("--email-only");
  let pagespeedOnly = args.includes("--pagespeed-only");
  let limit = 500;

  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]);
  }

  const runEmail     = !pagespeedOnly;
  const runPagespeed = !emailOnly;

  // ── Email-scraping ───────────────────────────────────────
  if (runEmail) {
    const companies = getCompaniesNeedingEmail(limit);
    console.log(`📧 Email-scraping: ${companies.length} bolag att bearbeta`);

    if (companies.length > 0) {
      const pool = pLimit(8);
      let done = 0;
      let found = 0;

      await Promise.all(
        companies.map((c) =>
          pool(async () => {
            try {
              const email = await scrapeEmail(c.website);
              updateEmail(c.place_id, email);
              if (email) found++;
            } catch {
              updateEmail(c.place_id, null);
            }
            done++;
            if (done % 50 === 0 || done === companies.length) {
              process.stdout.write(`\r  ${done}/${companies.length} (${found} hittade)   `);
            }
          })
        )
      );
      console.log(`\n  Klart: ${found} email-adresser hittade`);
    }
  }

  // ── PageSpeed ────────────────────────────────────────────
  if (runPagespeed) {
    const companies = getCompaniesNeedingPagespeed(limit);
    console.log(`\n🚀 PageSpeed: ${companies.length} bolag att analysera`);

    if (companies.length > 0) {
      // PageSpeed är tyngre — kör 3 parallellt
      const pool = pLimit(3);
      let done = 0;
      let errors = 0;
      const priorityCounts = { "🔥 A+": 0, "🟡 A": 0, "🔵 B": 0, "⚪ C": 0 };

      await Promise.all(
        companies.map((c) =>
          pool(async () => {
            try {
              const psi = await analyzePagespeed(c.website);
              const priority = calculatePriority(psi, c);
              updatePagespeed(c.place_id, { ...psi, priority });
              priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
            } catch {
              errors++;
              // Markera ändå som försökt (sätt pagespeed_at) för att undvika eviga retries
              updatePagespeed(c.place_id, {
                performance: null, seo: null, accessibility: null,
                mobile_friendly: null, load_time: null, priority: null,
              });
            }
            done++;
            if (done % 20 === 0 || done === companies.length) {
              process.stdout.write(`\r  ${done}/${companies.length} (${errors} fel)   `);
            }
            // Rate-limit: ~1 req/s utan nyckel, snabbare med
            await new Promise((r) => setTimeout(r, PSI_KEY ? 350 : 1200));
          })
        )
      );

      console.log(`\n  Klart! Prioritetsfördelning:`);
      for (const [p, n] of Object.entries(priorityCounts)) {
        if (n > 0) console.log(`    ${p}: ${n}`);
      }
      if (errors > 0) console.log(`    ⚠️  Fel: ${errors}`);
    }
  }

  const stats = getStats();
  console.log(`\n📊 DB-statistik:`);
  console.log(`   Bolag totalt:       ${stats.total}`);
  console.log(`   Med telefon:        ${stats.withPhone}`);
  console.log(`   Med hemsida:        ${stats.withWebsite}`);
  console.log(`   Med email:          ${stats.withEmail}`);
  console.log(`   PageSpeed-analys:   ${stats.withPagespeed}`);
  console.log(`   🔥 A+ leads:        ${stats.hotLeads}`);
}

main().catch(console.error);
