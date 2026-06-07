#!/usr/bin/env node
/**
 * enrich-ie-phone.js — scrape:r irländska telefonnummer från företagens hemsidor.
 *
 * CRO open data ger ingen kontaktinfo. Detta skript hämtar telefonnummer
 * från företagens egna hemsidor (samma som vi gör för email).
 *
 * Detekterar:
 *   • +353 X XXX XXXX (internationellt format)
 *   • 0X XXX XXXX     (nationellt format, t.ex. 01 234 5678)
 *   • 08X XXX XXXX    (mobile)
 *   • Med eller utan space/dash/parens
 *
 * Användning:
 *   node enrich-ie-phone.js                    → alla IE-bolag med website utan tel
 *   node enrich-ie-phone.js --limit 100        → testkörning
 *   node enrich-ie-phone.js --concurrency 20
 */

const { getDb } = require("./db");
const pLimit = require("p-limit");

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

// ════════════════════════════════════════════════════════════════════
// Irländsk phone-extraction
// ════════════════════════════════════════════════════════════════════

// Mönster för irländska nummer:
//   +353 XX XXX XXXX  / 00353 XX XXX XXXX
//   0XX XXX XXXX      (national)
//   (0XX) XXX XXXX
const PHONE_PATTERNS = [
  // International med +353 eller 00353
  /\+\s?353[\s\-\.()]*\d{1,2}[\s\-\.()]*\d{3,4}[\s\-\.()]*\d{3,4}/g,
  /\b00\s?353[\s\-\.()]*\d{1,2}[\s\-\.()]*\d{3,4}[\s\-\.()]*\d{3,4}/g,
  // National (0X eller 0XX prefix, ofta i parens)
  /\(\s?0\d{1,2}\s?\)\s?\d{3,4}[\s\-\.]*\d{3,4}/g,
  /\b0\d{1,2}\s?\d{3,4}[\s\-\.]\d{3,4}\b/g,
  /\b0\d{2}\s?\d{7}\b/g, // 01 1234567 osv
];

// Telefon-blockord (skippa dessa)
const PHONE_BLOCK = [
  "1900",     // premium
  "0044",     // UK number
  "0049",     // DE
  "fax",      // ofta felflaggat ändå men hanteras separat
];

function normalizePhone(raw) {
  if (!raw) return null;
  // Trimma surrounding whitespace + remove leading non-digit/+ chars
  let p = raw.replace(/^[^\d+]+/, "").replace(/\s+/g, " ").trim();
  // Standardise: convert 00353 → +353, +353 → keep
  if (/^00\s?353/.test(p)) p = p.replace(/^00\s?/, "+");
  // Remove unnecessary multiple spaces
  p = p.replace(/\s{2,}/g, " ");
  return p;
}

function isValidPhone(p) {
  if (!p) return false;
  const digits = p.replace(/\D/g, "");
  // Måste ha 9-12 siffror för irländska nummer
  if (digits.length < 9 || digits.length > 13) return false;
  // Skippa kända block
  for (const b of PHONE_BLOCK) {
    if (p.toLowerCase().includes(b)) return false;
  }
  // Måste börja med +353, 353, eller 0
  if (!/^(\+353|353|0)/.test(digits) && !/^\+353/.test(p)) return false;
  // Skippa numera som ser ut som postnummer eller datum (8 siffror utan landskod)
  if (digits.length === 8 && !/^[0]/.test(digits)) return false;
  return true;
}

function extractPhones(html) {
  const found = new Set();

  // tel:-länkar (mest pålitliga)
  const telRe = /tel:\s*([+\d\s\-\.()]+)/gi;
  let m;
  while ((m = telRe.exec(html))) {
    const norm = normalizePhone(m[1]);
    if (isValidPhone(norm)) found.add(norm);
  }

  // Textmönster
  for (const re of PHONE_PATTERNS) {
    re.lastIndex = 0;
    while ((m = re.exec(html))) {
      const norm = normalizePhone(m[0]);
      if (isValidPhone(norm)) found.add(norm);
    }
  }

  return [...found].slice(0, 3);
}

// ════════════════════════════════════════════════════════════════════
// Fetch
// ════════════════════════════════════════════════════════════════════

async function scrapePhones(website) {
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
    return extractPhones(html);
  } catch {
    return [];
  }
}

function setPhone(placeId, phone) {
  if (!phone) return;
  getDb()
    .prepare(
      "UPDATE companies SET phone = ?, updated_at = datetime('now') WHERE place_id = ?"
    )
    .run(phone, placeId);
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: null, concurrency: 15 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log("📞 enrich-ie-phone — telefonnummer från irländska hemsidor\n");
  console.log(`   Concurrency: ${opts.concurrency}\n`);

  const baseQuery = `SELECT place_id, name, website FROM companies
                     WHERE branch LIKE 'IE-%'
                       AND website IS NOT NULL AND website != ''
                       AND (phone IS NULL OR phone = '')
                     ORDER BY name`;
  const need = opts.limit
    ? getDb().prepare(`${baseQuery} LIMIT ?`).all(opts.limit)
    : getDb().prepare(baseQuery).all();

  console.log(`📋 Sajter att scanna: ${need.length.toLocaleString()}\n`);

  const limit = pLimit(opts.concurrency);
  let withPhone = 0,
    withoutPhone = 0,
    done = 0;

  await Promise.all(
    need.map((c) =>
      limit(async () => {
        const phones = await scrapePhones(c.website);
        if (phones.length) {
          setPhone(c.place_id, phones[0]);
          withPhone++;
        } else {
          withoutPhone++;
        }
        done++;
        if (done % 50 === 0 || done === need.length) {
          const pct = Math.round((done / need.length) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${done.toLocaleString()}/${need.length.toLocaleString()} (${withPhone.toLocaleString()} tel ✓ | ${withoutPhone.toLocaleString()} ✗)   `
          );
        }
      })
    )
  );

  console.log(`\n\n✅ Klart: ${withPhone.toLocaleString()} telefonnummer hittade (${Math.round(withPhone / need.length * 100)}% hit-rate)`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
