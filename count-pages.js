#!/usr/bin/env node
/**
 * count-pages.js — räkna sidor per lead i en CSV (kolumn "domain").
 * Metod: sitemap.xml / sitemap_index (robots.txt + default-paths), räknar <url>-entries
 * och följer sitemap-index. Saknas sitemap → uppskattar via startsidans interna länkar.
 * Lägger till kolumnerna "sidor" + "sidor_kalla" och rapporterar hur många som har ≤N sidor.
 *
 *   node count-pages.js <in.csv> <out.csv> [--limit N] [--threshold 10] [--concurrency 25]
 */
const fs = require("node:fs");
const pLimit = require("p-limit");

const [, , IN, OUT] = process.argv;
const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(flag("--limit", "0"), 10) || 0;
const THRESH = parseInt(flag("--threshold", "10"), 10);
const CONC = parseInt(flag("--concurrency", "25"), 10);
if (!IN || !OUT) { console.error("Användning: node count-pages.js <in.csv> <out.csv> [--limit N]"); process.exit(1); }

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
];
const UA = () => UAS[Math.floor(Math.random() * UAS.length)];
const MAX_DEPTH = 2;

// ── CSV ──────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []; let i = 0, field = "", row = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ── Fetch med timeout ────────────────────────────────────────
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA() }, redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

// ── Sitemap (samma logik som enrich-sitemap.js) ──────────────
const countUrls = (xml) => (xml.match(/<url\b[\s\S]*?<\/url>/gi) || []).length;
const childSitemaps = (xml) =>
  (xml.match(/<sitemap\b[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi) || [])
    .map((m) => (m.match(/<loc>([\s\S]*?)<\/loc>/) || [])[1]).filter(Boolean).map((s) => s.trim());

async function readSitemap(url, depth = 0) {
  const text = await fetchText(url);
  if (text == null) return { count: 0, found: false };
  const direct = countUrls(text);
  if (direct > 0 || depth >= MAX_DEPTH) return { count: direct, found: direct > 0 };
  const kids = childSitemaps(text).slice(0, 50);
  let total = 0;
  for (const k of kids) total += (await readSitemap(k, depth + 1)).count;
  return { count: total, found: kids.length > 0 };
}

function originOf(website) {
  try { return new URL(website.startsWith("http") ? website : "https://" + website).origin; } catch { return null; }
}

// ── Fallback: räkna interna länkar på startsidan ─────────────
async function homepageLinkCount(origin) {
  const html = await fetchText(origin);
  if (html == null) return null;
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const paths = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'>\s]+)["']/gi)) {
    const h = m[1];
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(h)) continue;
    let u; try { u = new URL(h, origin); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|css|js|ico|mp4|mp3|woff2?)$/i.test(u.pathname)) continue;
    paths.add((u.pathname.replace(/\/+$/, "") || "/"));
  }
  return paths.size;
}

async function countPages(domain) {
  const origin = originOf(domain);
  if (!origin) return { pages: null, source: "okänd (ogiltig domän)" };
  // sitemap-kandidater: robots.txt + default-paths
  const cands = [];
  const robots = await fetchText(`${origin}/robots.txt`);
  if (robots) for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) cands.push(m[1].trim());
  cands.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`);
  for (const url of [...new Set(cands)]) {
    const sm = await readSitemap(url);
    if (sm.found && sm.count > 0) return { pages: sm.count, source: "sitemap" };
  }
  // ingen sitemap → uppskatta via startsidans länkar
  const est = await homepageLinkCount(origin);
  if (est == null) return { pages: null, source: "okänd (ej nåbar)" };
  return { pages: est, source: "uppskattad (startsidans länkar)" };
}

// ── Kör ──────────────────────────────────────────────────────
(async () => {
  const grid = parseCSV(fs.readFileSync(IN, "utf8")).filter((r) => r.length > 1);
  const header = grid[0];
  const di = header.indexOf("domain");
  let rows = grid.slice(1).map((r) => ({ cells: r, domain: r[di] })).filter((r) => r.domain);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`\n📄 Räknar sidor för ${rows.length} leads (sitemap + fallback, concurrency ${CONC})\n`);
  const limit = pLimit(CONC);
  let done = 0, t0 = Date.now();
  await Promise.all(rows.map((r) => limit(async () => {
    const res = await countPages(r.domain);
    r.pages = res.pages; r.source = res.source;
    if (++done % 100 === 0 || done === rows.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r   ${done}/${rows.length} | ETA ${Math.round((rows.length - done) / rate / 60)} min   `);
    }
  })));

  // skriv augmenterad CSV, sorterad efter sidor (minst först, okänt sist)
  rows.sort((a, b) => (a.pages == null ? 1e9 : a.pages) - (b.pages == null ? 1e9 : b.pages));
  const outHeader = [...header, "sidor", "sidor_kalla"];
  const lines = [outHeader.map(esc).join(",")];
  for (const r of rows) lines.push([...r.cells, r.pages == null ? "" : r.pages, r.source].map(esc).join(","));
  fs.writeFileSync(OUT, lines.join("\n"));

  // rapport
  const sm = rows.filter((r) => r.source === "sitemap");
  const estR = rows.filter((r) => r.source.startsWith("uppskattad"));
  const unk = rows.filter((r) => r.pages == null);
  const le = (arr) => arr.filter((r) => r.pages <= THRESH).length;
  console.log(`\n\n── Sidor ≤ ${THRESH} ──`);
  console.log(`  Säkert (sitemap):       ${le(sm)}  av ${sm.length} med sitemap`);
  console.log(`  Uppskattat (länkar):    ${le(estR)}  av ${estR.length} utan sitemap`);
  console.log(`  ────`);
  console.log(`  TOTALT ≤${THRESH} sidor:        ${le(sm) + le(estR)}  av ${rows.length}`);
  console.log(`  >${THRESH} sidor:               ${rows.length - le(sm) - le(estR) - unk.length}`);
  console.log(`  Okänt (ej nåbar):        ${unk.length}`);
  console.log(`\n✅ ${OUT}`);
})();
