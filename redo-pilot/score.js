#!/usr/bin/env node
/**
 * redo-pilot/score.js — räknar "låg-hängande-frukt"-score 0–100 för varje
 * prospect i sweet spot, baserat på allabolag-data + sajt-enrichment.
 *
 * Filosofin: ju mer "underhållen/eftersatt/på-ren-mall"-tells, desto högre
 * score. Sweet spot är ett FILTER (vi scorar bara dem), inte poäng i sig.
 *
 * Vikter:
 *   +20  Hemsida på One.com / Hemsida24 / Jimdo / Wix / Squarespace (DIY)
 *   +15  WordPress med generic-mall (Astra/Divi/GeneratePress/Twenty…)
 *   +15  Mobile-friendly = NEJ i PageSpeed
 *   +10  PageSpeed mobile <50
 *   +10  Senaste blogpost >12 mån (eller ingen blogg alls)
 *    +8  Saknar JSON-LD schema
 *    +7  Saknar og:image
 *    +5  TLS-cert äldre än 2 år
 *    +5  Saknar viewport-meta
 *    +5  Saknar meta description (eller generisk)
 *    +5  Title saknar bransch + Malmö
 *    +3  Saknar Google Analytics
 *    +2  Saknar Facebook Pixel
 *
 * Max teoretiskt: 110p → capas till 100.
 *
 * Användning:
 *   node redo-pilot/score.js              → räknar om alla i sweet spot
 *   node redo-pilot/score.js --top 20     → visar topp 20 med breakdown
 */

const { getDb } = require("./db");
const { REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX } = require("./config");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { top: 10 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1]) opts.top = parseInt(args[++i]);
  }
  return opts;
}

const DIY_STACKS = new Set([
  "one.com",
  "hemsida24",
  "jimdo",
  "wix",
  "squarespace",
  "yola",
  "godaddy",
  "strikingly",
]);

function scoreOne(p) {
  let s = 0;
  const breakdown = {};

  const add = (key, pts, when) => {
    if (when) {
      s += pts;
      breakdown[key] = pts;
    }
  };

  // Sweet-spot-bonus (volym + storlek där 5k kr är försumbart, ej för stort)
  const inSweet =
    p.revenue >= REVENUE_MIN && p.revenue <= REVENUE_MAX &&
    p.employees >= EMPLOYEES_MIN && p.employees <= EMPLOYEES_MAX;
  add("in-sweet-spot", 15, inSweet);

  add("diy-builder", 20, DIY_STACKS.has(p.tech_stack));
  add("generic-wp-theme", 15, p.tech_stack === "wordpress" && p.wp_theme_generic === 1);
  add("mobile-friendly-fail", 15, p.ps_mobile_ok === 0);
  add("pagespeed-mobile-low", 10, p.ps_performance != null && p.ps_performance < 50);
  add(
    "blog-stale-12mo",
    10,
    p.blog_stale_months == null || p.blog_stale_months >= 12
  );
  add("missing-schema", 8, p.has_schema === 0);
  add("missing-og-image", 7, p.has_og_image === 0);
  add("cert-old", 5, p.cert_age_days != null && p.cert_age_days > 730);
  add("missing-viewport", 5, p.has_viewport === 0);
  add("weak-meta-description", 5, p.meta_description === 0);
  add("title-no-keyword", 5, p.title_has_city === 0);
  add("missing-ga", 3, p.has_ga === 0);
  add("missing-fb-pixel", 2, p.has_fb_pixel === 0);

  return { score: Math.min(s, 100), breakdown };
}

function fmtMSEK(rev) {
  return rev ? `${(rev / 1_000_000).toFixed(1)} MSEK` : "?";
}

function main() {
  const opts = parseArgs();
  const db = getDb();

  // Default: alla med hemsida (ej kedjor) som har enrichats
  const rows = db
    .prepare(
      `SELECT * FROM prospects
       WHERE (is_chain IS NULL OR is_chain = 0)
         AND website IS NOT NULL AND website != ''
         AND enriched_at IS NOT NULL
       ORDER BY name ASC`
    )
    .all();

  console.log(`🏆 redo-pilot/score — ${rows.length} prospects i sweet spot\n`);
  if (rows.length === 0) {
    console.log("Inget att scora. Kör först: discover → filter → enrich.");
    return;
  }

  const updateStmt = db.prepare(
    `UPDATE prospects SET score = ?, score_breakdown = ?, updated_at = datetime('now')
     WHERE org_nr = ?`
  );

  const scored = [];
  for (const p of rows) {
    const r = scoreOne(p);
    updateStmt.run(r.score, JSON.stringify(r.breakdown), p.org_nr);
    scored.push({ ...p, score: r.score, breakdown: r.breakdown });
  }

  scored.sort((a, b) => b.score - a.score);

  console.log(`📊 Topp ${Math.min(opts.top, scored.length)}:\n`);
  for (const p of scored.slice(0, opts.top)) {
    const reasons = Object.entries(p.breakdown)
      .map(([k, v]) => `+${v} ${k}`)
      .join(", ");
    const sweet = p.breakdown["in-sweet-spot"] ? "★" : " ";
    const emp = p.employees != null ? `${p.employees}a` : "?a";
    console.log(
      `   ${sweet}${String(p.score).padStart(3)}  ${p.name.slice(0, 40).padEnd(40)} ${fmtMSEK(p.revenue).padEnd(11)} ${emp.padStart(3)}  ${p.tech_stack || "?"}`
    );
    console.log(`        ${reasons || "(inga poäng)"}`);
  }
  console.log("\n   ★ = i sweet spot (2–15 MSEK + 2–10 anst)");

  // Distribution
  const buckets = { "80+": 0, "60-79": 0, "40-59": 0, "20-39": 0, "<20": 0 };
  for (const p of scored) {
    if (p.score >= 80) buckets["80+"]++;
    else if (p.score >= 60) buckets["60-79"]++;
    else if (p.score >= 40) buckets["40-59"]++;
    else if (p.score >= 20) buckets["20-39"]++;
    else buckets["<20"]++;
  }
  console.log("\n📈 Score-distribution:");
  for (const [bucket, n] of Object.entries(buckets)) {
    if (n > 0) console.log(`   ${bucket.padEnd(6)} ${n}`);
  }
}

main();
