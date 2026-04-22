/**
 * enrich-usp.js — Extraherar USP:ar från hemsidor med Claude Haiku
 *
 * Scraper startsida + /om-oss, skickar texten till Claude Haiku och
 * returnerar 3 konkreta säljargument (max 15 ord vardera).
 *
 * Användning:
 *   node enrich-usp.js              → alla bolag med hemsida utan USP
 *   node enrich-usp.js --limit 50   → max 50 bolag
 *   node enrich-usp.js --dry-run    → visa vad som skulle köras
 *
 * Kräver: ANTHROPIC_API_KEY i .env
 */

require("dotenv").config({ override: true });
const Anthropic = require("@anthropic-ai/sdk");
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const cheerio = require("cheerio");
const { getDb, getStats } = require("./db");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("❌ Saknar ANTHROPIC_API_KEY i .env — hämta på console.anthropic.com");
  process.exit(1);
}

const client = new Anthropic({ apiKey: API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TEXT_CHARS = 6000; // Begränsa input till Haiku

// ── DB-helpers (USP-kolumner inte i db.js ännu) ──────────────

function getCompaniesNeedingUsp(limit) {
  return getDb()
    .prepare(`
      SELECT place_id, name, website
      FROM companies
      WHERE website IS NOT NULL AND website != ''
        AND usp_extracted_at IS NULL
      ORDER BY
        CASE WHEN priority IN ('🔥 A+', '🟡 A') THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT ?
    `)
    .all(limit);
}

function updateUsp(placeId, usps) {
  getDb()
    .prepare(`
      UPDATE companies
      SET usp_1 = ?, usp_2 = ?, usp_3 = ?,
          usp_extracted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE place_id = ?
    `)
    .run(usps[0] ?? null, usps[1] ?? null, usps[2] ?? null, placeId);
}

function ensureUspColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  if (!cols.includes("usp_1")) {
    db.exec(`
      ALTER TABLE companies ADD COLUMN usp_1 TEXT;
      ALTER TABLE companies ADD COLUMN usp_2 TEXT;
      ALTER TABLE companies ADD COLUMN usp_3 TEXT;
      ALTER TABLE companies ADD COLUMN usp_extracted_at TEXT;
    `);
  }
}

// ── Webb-scraping ─────────────────────────────────────────────

async function fetchText(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LeadScraper/2.0)",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Ta bort script/style/nav/footer
  $("script, style, nav, footer, header, [class*='cookie'], [class*='popup']").remove();

  // Extrahera synlig text
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

async function scrapeWebsiteText(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const base = new URL(cleanUrl);
  const texts = [];

  // Startsida
  try {
    texts.push(await fetchText(cleanUrl));
  } catch {
    return null;
  }

  // /om-oss om den finns
  try {
    const aboutUrl = `${base.origin}/om-oss`;
    if (aboutUrl !== cleanUrl) {
      const aboutText = await fetchText(aboutUrl, 6000);
      texts.push(aboutText);
    }
  } catch {
    // Sidan finns inte — ok
  }

  return texts.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

// ── Claude Haiku ──────────────────────────────────────────────

const SYSTEM_PROMPT = `Du är en affärsutvecklingsanalytiker som hjälper säljare att förstå
potentiella kunders styrkor. Din uppgift är att identifiera konkreta säljargument och USP:ar
(Unique Selling Propositions) baserat på ett företags hemsidetext. Svara alltid på svenska.`;

async function extractUsps(companyName, websiteText) {
  const userPrompt = `Företag: ${companyName}

Hemsidetext:
${websiteText}

Baserat på ovanstående hemsidetext, extrahera de tre tydligaste säljargumenten eller USP:arna från företagets perspektiv. Max 15 ord per USP. Returnera som JSON-array med strängar. Om sidan saknar tydliga USP:ar, returnera en tom array.

Exempel på bra USP: "30 års erfarenhet av takläggning i Stockholmsregionen"
Exempel på dålig USP (för vag): "Hög kvalitet och bra service"

Svara ENBART med JSON-arrayen, inget annat.`;

  const response = await pRetry(
    async () => {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      return msg.content[0]?.text || "[]";
    },
    {
      retries: 3,
      minTimeout: 5000,
      maxTimeout: 30000,
      onFailedAttempt: (err) => {
        // Retry vid rate-limit (529) eller server-fel (500)
        if (err.status && err.status !== 429 && err.status !== 529 && err.status < 500) {
          throw err; // Kasta direkt vid klient-fel (4xx utom rate-limit)
        }
      },
    }
  );

  // Parsa JSON-svar
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ── Huvudprogram ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let limit = 500;

  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) limit = parseInt(args[limitIdx + 1]);

  // Lägg till USP-kolumner om de inte finns
  ensureUspColumns();

  const companies = getCompaniesNeedingUsp(limit);

  console.log("💡 USP-extraktion — Claude Haiku");
  console.log(`   Modell: ${MODEL}`);
  console.log(`   Bolag att bearbeta: ${companies.length}`);
  if (dryRun) {
    console.log("\n[DRY-RUN] Inga anrop görs.");
    companies.slice(0, 5).forEach((c) => console.log(`  ${c.name} — ${c.website}`));
    return;
  }
  console.log();

  // p-limit 5 parallella
  const pool = pLimit(5);
  let done = 0;
  let withUsps = 0;
  let errors = 0;

  await Promise.all(
    companies.map((c) =>
      pool(async () => {
        try {
          const text = await scrapeWebsiteText(c.website);
          if (!text || text.length < 100) {
            updateUsp(c.place_id, []);
          } else {
            const usps = await extractUsps(c.name, text);
            updateUsp(c.place_id, usps);
            if (usps.length > 0) withUsps++;
          }
        } catch {
          errors++;
          updateUsp(c.place_id, []);
        }

        done++;
        if (done % 10 === 0 || done === companies.length) {
          process.stdout.write(
            `\r  ${done}/${companies.length} | med USP: ${withUsps} | fel: ${errors}   `
          );
        }
      })
    )
  );

  console.log(`\n\n✅ Klart!`);
  console.log(`   Bearbetade: ${done}`);
  console.log(`   Med USP:    ${withUsps}`);
  console.log(`   Fel:        ${errors}`);

  // Visa ett par exempel
  const examples = getDb()
    .prepare(`SELECT name, usp_1, usp_2, usp_3 FROM companies WHERE usp_1 IS NOT NULL LIMIT 3`)
    .all();
  if (examples.length > 0) {
    console.log("\n  Exempel:");
    examples.forEach((e) => {
      console.log(`  ${e.name}:`);
      [e.usp_1, e.usp_2, e.usp_3].filter(Boolean).forEach((u) => console.log(`    • ${u}`));
    });
  }
}

main().catch(console.error);
