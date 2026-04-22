/**
 * Ugly-audit — detekterar gammal/amatörisk hemsida-teknik.
 * Hög score = dålig/ful sajt = bra lead att ringa.
 */
const fs = require("fs");
const pLimit = require("p-limit");
const { getDb } = require("./db");

const TIMEOUT = 10000;
const CONCURRENCY = 20;

const AMATEUR_PLATFORMS = [
  "wix.com", "wixsite.com", "my.canva.site", "canva.site",
  "123hemsida.se", "123hemsida", "jimdo", "jimdofree.com",
  "webnode.", "weebly.com", "godaddysites.com", "sitew.com",
  "simplesite.com", "site123.me", "n.nu", "webs.com",
  "yolasite.com", "one.com", "hemsida24", "mono.net",
];

async function audit(url) {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlodoBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return { uglyScore: 0, reasons: ["http-" + res.status], htmlSize: 0 };
    const html = await res.text();
    const finalUrl = res.url.toLowerCase();

    const reasons = [];
    let ugly = 0;

    // 1. Amateur-plattform i domän
    for (const p of AMATEUR_PLATFORMS) {
      if (finalUrl.includes(p)) {
        ugly += 3; reasons.push("platform:" + p); break;
      }
    }

    // 2. 1990s/2000s HTML-taggar
    if (/<font\b/i.test(html)) { ugly += 2; reasons.push("font-tag"); }
    if (/<center\b/i.test(html)) { ugly += 2; reasons.push("center-tag"); }
    if (/<marquee\b/i.test(html)) { ugly += 3; reasons.push("marquee"); }
    if (/<blink\b/i.test(html)) { ugly += 3; reasons.push("blink"); }

    // 3. Frames (super-gammalt)
    if (/<frameset\b|<frame\b/i.test(html)) { ugly += 3; reasons.push("frames"); }

    // 4. Flash (extremt gammalt)
    if (/<embed[^>]+\.swf|<object[^>]+\.swf/i.test(html)) { ugly += 3; reasons.push("flash"); }

    // 5. Table-layout (många tables + avsaknad av modern semantik)
    const tableCount = (html.match(/<table\b/gi) || []).length;
    const hasModernSemantic = /<main\b|<section\b|<article\b|<header\b|<footer\b/i.test(html);
    if (tableCount >= 3 && !hasModernSemantic) { ugly += 2; reasons.push("table-layout"); }
    else if (tableCount >= 5) { ugly += 1; reasons.push("many-tables"); }

    // 6. Ingen responsiv design
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) { ugly += 2; reasons.push("no-viewport"); }

    // 7. HTTP (inte HTTPS)
    if (!finalUrl.startsWith("https://")) { ugly += 2; reasons.push("no-https"); }

    // 8. Jättelite innehåll (trolig tom/under-utvecklad sajt)
    if (html.length < 10000) { ugly += 2; reasons.push("tiny-site"); }

    // 9. Inline styles spammigt (inga externa CSS)
    const stylesheets = (html.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length;
    const inlineStyles = (html.match(/style=["'][^"']+/gi) || []).length;
    if (stylesheets === 0 && inlineStyles > 5) { ugly += 1; reasons.push("inline-css"); }

    // 10. Ingen <h1>
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count === 0) { ugly += 1; reasons.push("no-h1"); }

    // 11. Jättegenerisk title
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    if (/^(home|hem|velkommen|welcome|index|startsida)$/i.test(title.trim())) { ugly += 1; reasons.push("generic-title"); }
    if (!title.trim()) { ugly += 2; reasons.push("no-title"); }

    // 12. Inget sök i Google-orienterat — saknar meta description OCH schema
    const hasMeta = /<meta[^>]+name=["']description["']/i.test(html);
    const hasSchema = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
    if (!hasMeta && !hasSchema) { ugly += 1; reasons.push("no-seo-basics"); }

    // 13. Gammalt jQuery (< v3) eller Prototype.js/MooTools
    if (/jquery[-.]?(1\.|2\.)/i.test(html)) { ugly += 2; reasons.push("old-jquery"); }
    if (/prototype\.js|mootools/i.test(html)) { ugly += 3; reasons.push("prototype/mootools"); }

    // 14. Bordered images (1990s-look)
    if (/<img[^>]+border=["']?[1-9]/i.test(html)) { ugly += 1; reasons.push("img-border"); }

    // 15. Bgcolor/bgproperties attrs (2000s-look)
    if (/bgcolor=|bgproperties=/i.test(html)) { ugly += 1; reasons.push("old-bg-attrs"); }

    return { uglyScore: ugly, reasons, htmlSize: html.length };
  } catch (e) {
    return { uglyScore: 0, reasons: ["error:" + e.message.slice(0, 30)], htmlSize: 0 };
  }
}

(async () => {
  const db = getDb();
  const leads = db.prepare(`
    SELECT branch, city, name, phone, website, address, rating, reviews
    FROM companies
    WHERE branch IN ('Håndverkere','Rengjøring')
      AND city != 'Oslo'
      AND phone IS NOT NULL AND phone != ''
      AND website IS NOT NULL AND website != ''
      AND reviews >= 5 AND reviews <= 200
  `).all();

  console.log(`🔍 Ugly-audit på ${leads.length} norska leads...`);
  const start = Date.now();
  const limit = pLimit(CONCURRENCY);
  let done = 0;

  const results = await Promise.all(leads.map((l) => limit(async () => {
    const r = await audit(l.website);
    done++;
    if (done % 100 === 0) process.stdout.write(`\r  ${done}/${leads.length}`);
    return { ...l, ...r };
  })));

  console.log(`\n⏱️  ${((Date.now() - start) / 1000).toFixed(0)}s`);

  // Fördelning
  const byScore = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, "7+": 0 };
  for (const r of results) {
    const k = r.uglyScore >= 7 ? "7+" : r.uglyScore;
    byScore[k] = (byScore[k] || 0) + 1;
  }
  console.log("Fördelning (ugly-score):", byScore);

  // Behåll bara ugly ≥ 4 (säkra fynd)
  const esc = (v) => { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = "Bransch,Stad,Företag,Telefon,Hemsida,Adress,Betyg,Recensioner,Ugly-score,Anledning";

  for (const [label, branschFilter] of [["handverkere", "Håndverkere"], ["rengjoring", "Rengjøring"]]) {
    const rows = results.filter((r) => r.branch === branschFilter && r.uglyScore >= 4);
    rows.sort((a, b) => b.uglyScore - a.uglyScore);
    const body = rows.map((r) => [
      esc(r.branch), esc(r.city), esc(r.name), esc(r.phone), esc(r.website), esc(r.address),
      esc(r.rating), esc(r.reviews), r.uglyScore, esc((r.reasons || []).slice(0, 4).join("; "))
    ].join(",")).join("\n");
    fs.writeFileSync(`output/norge-${label}-fula.csv`, header + "\n" + body + "\n");
    console.log(`✅ ${rows.length} → output/norge-${label}-fula.csv`);
  }
})();
