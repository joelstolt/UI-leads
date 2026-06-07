#!/usr/bin/env node
/**
 * redo-pilot/export.js — CSV-export av scored shortlist.
 *
 * Default: alla i sweet spot, sorterade efter score desc.
 *
 * Användning:
 *   node redo-pilot/export.js                       → redo-pilot/shortlist.csv
 *   node redo-pilot/export.js --out path/file.csv
 *   node redo-pilot/export.js --min-score 40
 *   node redo-pilot/export.js --top 30
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./db");
const { REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX } = require("./config");

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtMSEK(rev) {
  return rev ? (rev / 1_000_000).toFixed(1).replace(".", ",") : "";
}

function topReasons(breakdownJson) {
  try {
    const b = JSON.parse(breakdownJson || "{}");
    return Object.entries(b)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `+${v} ${k}`)
      .join("; ");
  } catch {
    return "";
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    out: path.join(__dirname, "shortlist.csv"),
    minScore: 0,
    top: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
    if (args[i] === "--min-score" && args[i + 1]) opts.minScore = parseInt(args[++i]);
    if (args[i] === "--top" && args[i + 1]) opts.top = parseInt(args[++i]);
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const db = getDb();

  // Default: alla med hemsida + scorad + ej kedja. Sortera sweet spot först, sen score.
  const rows = db
    .prepare(
      `SELECT *,
              CASE WHEN revenue BETWEEN ${REVENUE_MIN} AND ${REVENUE_MAX}
                    AND employees BETWEEN ${EMPLOYEES_MIN} AND ${EMPLOYEES_MAX}
                   THEN 1 ELSE 0 END AS in_sweet_spot
       FROM prospects
       WHERE (is_chain IS NULL OR is_chain = 0)
         AND website IS NOT NULL AND website != ''
         AND score IS NOT NULL
         AND score >= ?
       ORDER BY in_sweet_spot DESC, score DESC, revenue DESC NULLS LAST`
    )
    .all(opts.minScore);

  const limited = opts.top ? rows.slice(0, opts.top) : rows;

  const headers = [
    "Score",
    "Sweet spot",
    "Företag",
    "VD/Kontakt",
    "Orgnr",
    "Oms (MSEK)",
    "Anställda",
    "Telefon",
    "Email",
    "Hemsida",
    "Stad",
    "Adress",
    "Tech-stack",
    "WP-tema",
    "Mobile-friendly",
    "PS Performance",
    "PS SEO",
    "Cert ålder (d)",
    "Blog stale (mån)",
    "Schema",
    "OG-image",
    "GA",
    "Bransch",
    "Score-breakdown",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  for (const r of limited) {
    lines.push(
      [
        r.score,
        r.in_sweet_spot ? "Ja" : "Nej",
        r.name,
        r.contact_person || "",
        r.org_nr,
        fmtMSEK(r.revenue),
        r.employees ?? "",
        r.phone || "",
        r.email || "",
        r.website || "",
        r.city || "",
        r.address || "",
        r.tech_stack || "",
        r.wp_theme || "",
        r.ps_mobile_ok === 1 ? "Ja" : r.ps_mobile_ok === 0 ? "Nej" : "?",
        r.ps_performance ?? "",
        r.ps_seo ?? "",
        r.cert_age_days ?? "",
        r.blog_stale_months ?? (r.enriched_at ? "ingen blogg" : ""),
        r.has_schema === 1 ? "Ja" : r.has_schema === 0 ? "Nej" : "?",
        r.has_og_image === 1 ? "Ja" : r.has_og_image === 0 ? "Nej" : "?",
        r.has_ga === 1 ? "Ja" : r.has_ga === 0 ? "Nej" : "?",
        r.sni_code || "",
        topReasons(r.score_breakdown),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  fs.writeFileSync(opts.out, lines.join("\n") + "\n", "utf8");
  console.log(`✅ Skrev ${limited.length} rader → ${opts.out}`);
  if (limited.length > 0) {
    console.log(`   Score-spann: ${limited[limited.length - 1].score}–${limited[0].score}`);
  }
}

main();
