#!/usr/bin/env node
/**
 * enrich-se-email-deep.js — djup mejl-skrap för svenska leads med hemsida men utan mejl.
 *
 * Skillnad mot fas 3 i enrich-se-website.js (som bara läser startsidan + mailto/plaintext):
 *   1. Läser startsidan OCH kontakt-/om-oss-sidor (/kontakt, /kontakta-oss, /om-oss,
 *      /contact, /about … + länkar i sidan vars href innehåller kontakt/contact).
 *   2. Av-obfuskerar: info[at]firma.se, info(snabel-a)firma(punkt)se, &#64; osv.
 *   3. Föredrar mejl vars domän matchar företagets egen domän, och roll-adresser
 *      (info@, kontakt@, hej@ …) framför privata/agentur-adresser.
 *
 * Skriver email + email_scraped_at tillbaka till leads.db (bara där email är tomt).
 * Skriver även en CSV med nyfunna mejl.
 *
 * Körning:
 *   node enrich-se-email-deep.js                  → alla 6 988 SE (hemsida, utan mejl)
 *   node enrich-se-email-deep.js --limit 200      → provkör
 *   node enrich-se-email-deep.js --concurrency 30
 *   node enrich-se-email-deep.js --out nya-mejl.csv
 *   node enrich-se-email-deep.js --dry            → skriv INTE till DB (bara CSV + summering)
 */

const fs = require("node:fs");
const { getDb } = require("./db");
const pLimit = require("p-limit");

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const LIMIT = parseInt(flag("--limit", "0"), 10) || 0;
const CONC = parseInt(flag("--concurrency", "25"), 10);
const OUT = flag("--out", "nya-mejl-se.csv");
const DRY = has("--dry");

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
];
const pickUA = () => UAS[Math.floor(Math.random() * UAS.length)];

// ── Mejl-validering ──────────────────────────────────────────────────
const EMAIL_BLOCK = [
  "@example", "@test.", "@sentry.", "@cdn.", "@google", "@facebook", "@apple",
  "@microsoft", "@wix.com", "@squarespace", "@godaddy", "@mysite.com",
  "@yourdomain", "@email.com", "@domain.com", "name@provider.com",
  "@sentry.io", "@2x.png", "@3x.png", "@w3.org", "@schema.org", "@adobe",
];
const BAD_EXT = /\.(png|jpg|jpeg|gif|webp|svg|css|js|woff2?|ttf|ico)$/i;

function cleanEmail(raw) {
  if (!raw) return "";
  let e = raw.trim().toLowerCase().replace(/^mailto:/, "");
  e = e.replace(/%[0-9a-f]{2}/g, "");          // bort med URL-encoding (%20 osv.)
  e = e.replace(/^[^a-z0-9]+/, "");            // skräp före local-part
  e = e.replace(/[\\?.,;:)>\]"'\s]+$/, "");    // skräp efter TLD (inkl. backslash)
  return e;
}
function isValidEmail(eRaw) {
  const e = cleanEmail(eRaw);
  if (!e || e.length < 5 || !e.includes("@") || !e.includes(".")) return false;
  if (e.split("@").length !== 2) return false;
  if (EMAIL_BLOCK.some((b) => e.includes(b))) return false;
  if (BAD_EXT.test(e)) return false;
  if (/^[a-f0-9]{16,}@/.test(e)) return false;        // hash-likt
  if (/\.(png|jpg|gif|webp)@/.test(e)) return false;
  if (/@.*@/.test(e)) return false;
  return true;
}

// Av-obfuskera HTML innan regex (bara entydiga former → få falska positiva).
function deobfuscate(html) {
  return html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, "@")
    .replace(/\s*[\[\(\{]\s*(?:at|snabel-?a|snabela)\s*[\]\)\}]\s*/gi, "@")
    .replace(/\s*[\[\(\{]\s*(?:dot|punkt)\s*[\]\)\}]\s*/gi, ".");
}

// ROT13 (vanlig WP "Email Address Encoder"-plugin krypterar mejl i HTML).
function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const b = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
  });
}
// Riktiga TLD:er — ROT13-ciphertext har dem INTE (com→pbz, net→arg, org→bet …),
// men avkodningen får tillbaka dem. Så: avkoda om domänen saknar vanlig TLD men
// den avkodade har det (eller om avkodad domän = sajtens domän).
const COMMON_TLD = /\.(se|com|net|org|nu|eu|io|info|biz|fi|dk|no|de|co|me|tech|app|shop|live|online|email|nordic)$/i;
function maybeRot13(email, siteDomain) {
  const dom = email.split("@")[1] || "";
  const dec = rot13(dom);
  if (siteDomain && dec === siteDomain) return rot13(email);
  if (!COMMON_TLD.test(dom) && COMMON_TLD.test(dec)) return rot13(email);
  return email;
}

const FREEMAIL = /@(gmail|hotmail|outlook|yahoo|live|icloud|msn|telia|comhem|spray|bredband2?|tele2|me)\./i;
function coreLabel(d) { const p = (d || "").split("."); return p.length >= 2 ? p[p.length - 2] : p[0] || ""; }
function domainMatch(emailDomain, siteDomain) {
  if (!emailDomain || !siteDomain) return false;
  if (emailDomain === siteDomain) return true;
  const a = coreLabel(emailDomain), b = coreLabel(siteDomain);
  return a.length >= 4 && a === b; // camred.se ↔ camred.com
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const MAILTO_RE = /mailto:([^"'?\s>]+@[^"'?\s>]+)/gi;

function extractEmails(html) {
  const found = new Set();
  let m;
  while ((m = MAILTO_RE.exec(html))) { const e = cleanEmail(m[1]); if (isValidEmail(e)) found.add(e); }
  const deob = deobfuscate(html);
  for (const src of [html, deob]) {
    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(src))) { const e = cleanEmail(m[0]); if (isValidEmail(e)) found.add(e); }
  }
  return [...found];
}

// ── Hämtning ─────────────────────────────────────────────────────────
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": pickUA(), Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "sv-SE,sv;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/html|text/.test(ct)) return null;
    return await res.text();
  } catch { return null; }
}

const CONTACT_PATHS = ["/kontakt", "/kontakta-oss", "/kontakta", "/contact", "/om-oss", "/about", "/kontakt-oss"];

// Hitta kontakt-/om-länkar i sidan.
function contactLinks(html, base) {
  const links = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/kontakt|contact|om-oss|about/i.test(href) && !/mailto:|tel:|\.(pdf|jpg|png)/i.test(href)) {
      try { links.add(new URL(href, base).href); } catch {}
    }
  }
  return [...links].slice(0, 4);
}

function baseDomain(website) {
  try { return new URL(website.startsWith("http") ? website : "https://" + website).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

// Välj bästa mejl + tillitsnivå. Lagra bara "hög" i DB (domän-match el. free-mail).
const ROLE = /^(info|kontakt|kontor|hej|mail|post|order|sales|forsaljning|reception|kundtjanst|support|hello)@/i;
function pickBest(rawEmails, domain) {
  const emails = [...new Set(rawEmails.map((e) => maybeRot13(e, domain)))].filter(isValidEmail);
  if (!emails.length) return null;
  const score = (e) => {
    const ed = e.split("@")[1] || "";
    let s = 0;
    if (domainMatch(ed, domain)) s += 10;
    if (ROLE.test(e)) s += 3;
    if (FREEMAIL.test(e)) s -= 1;
    return s;
  };
  const sorted = [...emails].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  const ed = best.split("@")[1] || "";
  // Tillit: matchar sajtens domän, eller är en riktig free-mail. Annars låg (agentur/fel sajt).
  const trust = domainMatch(ed, domain) || FREEMAIL.test(best) ? "hög" : "låg";
  return { best, trust, all: emails };
}

// Skrapa en sajt: startsida → (om ingen domän-match) kontaktsidor.
async function scrapeSite(website) {
  const base = website.startsWith("http") ? website : "https://" + website;
  const domain = baseDomain(website);
  const all = new Set();
  let pages = 0, jsHeavy = false, gotHome = false;

  const home = await fetchHtml(base);
  pages++;
  if (home) {
    gotHome = true;
    if (home.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length < 800) jsHeavy = true;
    extractEmails(home).forEach((e) => all.add(e));
  }

  const haveMatch = () => [...all].some((e) => domainMatch(maybeRot13(e, domain).split("@")[1], domain));

  if (!haveMatch() && home) {
    const targets = new Set(contactLinks(home, base));
    for (const p of CONTACT_PATHS) { try { targets.add(new URL(p, base).href); } catch {} }
    for (const url of [...targets].slice(0, 4)) {
      if (haveMatch()) break;
      const h = await fetchHtml(url);
      pages++;
      if (h) extractEmails(h).forEach((e) => all.add(e));
    }
  }
  const picked = pickBest([...all], domain);
  return { best: picked?.best || null, trust: picked?.trust || null, emails: picked?.all || [], pages, jsHeavy, gotHome };
}

// ── DB ───────────────────────────────────────────────────────────────
const db = getDb();
const SE =
  "branch NOT LIKE 'IE-%' AND branch NOT LIKE 'NO-%' AND branch NOT IN " +
  "('Håndverkere','Rengjøring','Malere','Hairdressers','Painters & Decorators')";
const rows = db.prepare(
  `SELECT place_id, name, branch, website FROM companies
   WHERE ${SE} AND website IS NOT NULL AND TRIM(website)<>''
     AND (email IS NULL OR TRIM(email)='')
   ${has("--random") ? "ORDER BY RANDOM()" : ""}
   ${LIMIT ? "LIMIT " + LIMIT : ""}`
).all();

const setEmail = db.prepare(
  "UPDATE companies SET email=?, email_scraped_at=datetime('now'), updated_at=datetime('now') WHERE place_id=?"
);
const stampOnly = db.prepare(
  "UPDATE companies SET email_scraped_at=datetime('now'), updated_at=datetime('now') WHERE place_id=?"
);

// ── Kör ──────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n📧 Djup mejl-skrap: ${rows.length.toLocaleString()} svenska sajter (hemsida, utan mejl)`);
  console.log(`   Concurrency ${CONC} | kontaktsidor + av-obfuskering | ${DRY ? "DRY (skriver ej DB)" : "skriver till DB"}\n`);
  const limit = pLimit(CONC);
  let done = 0, hi = 0, lo = 0, fails = 0, js = 0, t0 = Date.now();
  const newRows = [];

  await Promise.all(rows.map((r) => limit(async () => {
    const res = await scrapeSite(r.website.trim());
    if (!res.gotHome) fails++;
    if (res.jsHeavy) js++;
    if (res.best && res.trust === "hög") {
      hi++;
      newRows.push([r.name, r.branch, baseDomain(r.website), res.best, "hög", res.emails.join(" | ")]);
      if (!DRY) setEmail.run(res.best, r.place_id);     // bara säkra mejl → DB
    } else if (res.best) {
      lo++;
      newRows.push([r.name, r.branch, baseDomain(r.website), res.best, "låg", res.emails.join(" | ")]);
      if (!DRY) stampOnly.run(r.place_id);              // skrapad, men osäkert mejl → ej DB
    } else if (!DRY) {
      stampOnly.run(r.place_id);                        // skrapad, inget mejl
    }
    done++;
    if (done % 100 === 0 || done === rows.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = Math.round((rows.length - done) / rate / 60);
      process.stdout.write(`\r   ${done}/${rows.length} | ${hi} säkra +${lo} osäkra | ETA ${eta} min   `);
    }
  })));

  // CSV (alla fynd, med tillit-flagga så du kan filtrera)
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [["Företag", "Bransch", "Domän", "Bästa mejl", "Tillit", "Alla mejl"].join(",")]
    .concat(newRows.map((r) => r.map(esc).join(","))).join("\n");
  fs.writeFileSync(OUT, csv);

  console.log(`\n\n✅ Klart (${rows.length} sajter):`);
  console.log(`   ${hi} säkra mejl (${Math.round(hi / rows.length * 100)}%) → ${DRY ? "skulle skrivits till DB" : "skrivet till leads.db"}`);
  console.log(`   ${lo} osäkra mejl (annan domän/agentur — bara i CSV)`);
  console.log(`   ${fails} sajter gick ej att hämta, ${js} JS-renderade (mejl ej i statisk HTML)`);
  console.log(`   CSV (alla fynd): ${OUT}`);
})();
