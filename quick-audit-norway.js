/**
 * Snabb HTML-audit på norska leads.
 * Filtrerar bort de med bra hemsidor. Behåller bara "dåliga" sajter.
 */
const fs = require("fs");
const pLimit = require("p-limit");
const { getDb } = require("./db");

const TIMEOUT = 10000;
const CONCURRENCY = 20;

async function audit(url) {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FlodoBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return { score: 0, note: "HTTP " + res.status };
    const html = await res.text();
    const finalUrl = res.url;

    let score = 0;
    const isHttps = finalUrl.startsWith("https://");
    if (isHttps) score += 10;
    if (/<meta[^>]+name=["']viewport["']/i.test(html)) score += 10;
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    if (title.length >= 20 && title.length <= 70) score += 10;
    if (/<meta[^>]+name=["']description["']/i.test(html)) score += 10;
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    if (h1Count === 1) score += 10;
    const h2Count = (html.match(/<h2\b/gi) || []).length;
    if (h2Count >= 2) score += 5;
    if (/<link[^>]+rel=["']canonical["']/i.test(html)) score += 5;
    if (/<html[^>]+lang=/i.test(html)) score += 5;
    if (/<script[^>]+type=["']application\/ld\+json["']/i.test(html)) score += 10;
    if (/<meta[^>]+property=["']og:/i.test(html)) score += 5;
    // Wordcount
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words >= 500) score += 10;
    else if (words >= 200) score += 5;
    // WebP/modern images
    if (/\.(webp|avif)/i.test(html)) score += 5;
    // Loading lazy
    if (/loading=["']lazy["']/i.test(html)) score += 5;

    return { score, words, isHttps, hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html) };
  } catch (e) {
    return { score: 0, note: e.message };
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

  console.log(`🔍 Auditar ${leads.length} norska leads med hemsida...`);
  const start = Date.now();
  const limit = pLimit(CONCURRENCY);
  let done = 0;

  const results = await Promise.all(leads.map((l) => limit(async () => {
    const r = await audit(l.website);
    done++;
    if (done % 50 === 0) process.stdout.write(`\r  ${done}/${leads.length}`);
    return { ...l, ...r };
  })));

  console.log(`\n⏱️  ${((Date.now() - start) / 1000).toFixed(0)}s`);

  // Bucket
  const bad = results.filter((r) => r.score < 50);
  const medium = results.filter((r) => r.score >= 50 && r.score < 75);
  const good = results.filter((r) => r.score >= 75);

  console.log(`  🔴 Dåliga (<50):  ${bad.length}`);
  console.log(`  🟡 Medel (50-74): ${medium.length}`);
  console.log(`  🟢 Bra (≥75):     ${good.length}`);

  // Exportera bara dåliga (sälj ringer dessa)
  const esc = (v) => { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = "Bransch,Stad,Företag,Telefon,Hemsida,Adress,Betyg,Recensioner,SEO-score";
  for (const [label, rows] of [["handverkere-daliga", bad.filter(r => r.branch === "Håndverkere")], ["rengjoring-daliga", bad.filter(r => r.branch === "Rengjøring")]]) {
    rows.sort((a, b) => a.score - b.score);
    const body = rows.map((r) => [esc(r.branch), esc(r.city), esc(r.name), esc(r.phone), esc(r.website), esc(r.address), esc(r.rating), esc(r.reviews), r.score].join(",")).join("\n");
    fs.writeFileSync(`output/norge-${label}.csv`, header + "\n" + body + "\n");
    console.log(`✅ ${rows.length} → output/norge-${label}.csv`);
  }
})();
