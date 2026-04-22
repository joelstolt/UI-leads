/**
 * export.js — Exporterar bolag från SQLite till CSV
 *
 * Användning:
 *   node export.js                           → alla bolag
 *   node export.js --branch snickare         → filtrera bransch
 *   node export.js --city Stockholm          → filtrera stad
 *   node export.js --priority "A+,A"         → filtrera prioritet (A+, A, B, C)
 *   node export.js --has-phone               → bara bolag med telefon
 *   node export.js --has-email               → bara bolag med email
 *   node export.js --has-website             → bara bolag med hemsida
 *   node export.js --pagespeed-only          → bara analyserade
 *   node export.js --out output/mina-leads.csv  → anpassat filnamn
 *
 * Output: output/leads-export-YYYY-MM-DD.csv (eller --out)
 */

const fs   = require("fs");
const path = require("path");
const { getDb } = require("./db");

function escapeCSV(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    branch:       null,
    city:         null,
    priorities:   null,   // array av "A+", "A", "B", "C"
    hasPhone:     false,
    hasEmail:     false,
    hasWebsite:   false,
    pagespeedOnly: false,
    outFile:      null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch"    && args[i + 1]) opts.branch   = args[++i];
    if (args[i] === "--city"      && args[i + 1]) opts.city     = args[++i];
    if (args[i] === "--priority"  && args[i + 1]) {
      opts.priorities = args[++i].split(",").map((p) => p.trim()).map((p) => {
        // Stöd både "A+" och "🔥 A+"
        if (p === "A+" || p === "🔥 A+") return "🔥 A+";
        if (p === "A"  || p === "🟡 A")  return "🟡 A";
        if (p === "B"  || p === "🔵 B")  return "🔵 B";
        if (p === "C"  || p === "⚪ C")  return "⚪ C";
        return p;
      });
    }
    if (args[i] === "--has-phone")    opts.hasPhone    = true;
    if (args[i] === "--has-email")    opts.hasEmail    = true;
    if (args[i] === "--has-website")  opts.hasWebsite  = true;
    if (args[i] === "--pagespeed-only") opts.pagespeedOnly = true;
    if (args[i] === "--out" && args[i + 1]) opts.outFile = args[++i];
  }

  return opts;
}

function buildQuery(opts) {
  const conditions = [];
  const params = [];

  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }
  if (opts.city) {
    conditions.push("city = ?");
    params.push(opts.city);
  }
  if (opts.priorities && opts.priorities.length > 0) {
    const placeholders = opts.priorities.map(() => "?").join(", ");
    conditions.push(`priority IN (${placeholders})`);
    params.push(...opts.priorities);
  }
  if (opts.hasPhone) {
    conditions.push("phone IS NOT NULL AND phone != ''");
  }
  if (opts.hasEmail) {
    conditions.push("email IS NOT NULL AND email != ''");
  }
  if (opts.hasWebsite) {
    conditions.push("website IS NOT NULL AND website != ''");
  }
  if (opts.pagespeedOnly) {
    conditions.push("pagespeed_at IS NOT NULL");
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const sql = `
    SELECT
      branch, city, name, phone, website, email,
      address, rating, reviews, status,
      performance, seo, accessibility, mobile_friendly, load_time, priority,
      org_nr, firmatecknare, revenue, employees, sni_code,
      usp_1, usp_2, usp_3,
      scraped_at, pagespeed_at, corp_enriched_at, usp_extracted_at
    FROM companies
    ${where}
    ORDER BY
      CASE priority
        WHEN '🔥 A+' THEN 1
        WHEN '🟡 A'  THEN 2
        WHEN '🔵 B'  THEN 3
        WHEN '⚪ C'  THEN 4
        ELSE 5
      END,
      rating DESC NULLS LAST
  `;
  return { sql, params };
}

function formatFirmatecknare(jsonStr) {
  if (!jsonStr) return "";
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr.join("; ") : String(arr);
  } catch {
    return jsonStr;
  }
}

function main() {
  const opts = parseArgs();
  const { sql, params } = buildQuery(opts);

  const rows = getDb().prepare(sql).all(...params);

  if (rows.length === 0) {
    console.log("Inga bolag matchade filtren.");
    return;
  }

  const outputDir = path.join(__dirname, "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const timestamp = new Date().toISOString().slice(0, 10);
  const outFile = opts.outFile || path.join(outputDir, `leads-export-${timestamp}.csv`);

  const HEADER = [
    "Bransch", "Stad", "Företag", "Telefon", "Hemsida", "E-post",
    "Adress", "Betyg", "Recensioner", "Status",
    "Performance", "SEO", "Accessibility", "Mobilvänlig", "Laddtid", "Prioritet",
    "Org.nr", "Firmatecknare", "Omsättning (kr)", "Anställda", "SNI-kod",
    "USP 1", "USP 2", "USP 3",
    "Scrapad", "PageSpeed-analys", "Corp-enrichad", "USP-extraherad",
  ].join(",");

  const lines = [HEADER];
  for (const r of rows) {
    lines.push([
      escapeCSV(r.branch),
      escapeCSV(r.city),
      escapeCSV(r.name),
      escapeCSV(r.phone),
      escapeCSV(r.website),
      escapeCSV(r.email),
      escapeCSV(r.address),
      escapeCSV(r.rating),
      escapeCSV(r.reviews),
      escapeCSV(r.status),
      escapeCSV(r.performance),
      escapeCSV(r.seo),
      escapeCSV(r.accessibility),
      escapeCSV(r.mobile_friendly),
      escapeCSV(r.load_time),
      escapeCSV(r.priority),
      escapeCSV(r.org_nr),
      escapeCSV(formatFirmatecknare(r.firmatecknare)),
      escapeCSV(r.revenue),
      escapeCSV(r.employees),
      escapeCSV(r.sni_code),
      escapeCSV(r.usp_1),
      escapeCSV(r.usp_2),
      escapeCSV(r.usp_3),
      escapeCSV(r.scraped_at ? r.scraped_at.slice(0, 10) : ""),
      escapeCSV(r.pagespeed_at ? r.pagespeed_at.slice(0, 10) : ""),
      escapeCSV(r.corp_enriched_at ? r.corp_enriched_at.slice(0, 10) : ""),
      escapeCSV(r.usp_extracted_at ? r.usp_extracted_at.slice(0, 10) : ""),
    ].join(","));
  }

  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf-8");

  console.log(`✅ Exporterade ${rows.length} bolag → ${outFile}`);

  // Snabb sammanfattning
  const withPhone   = rows.filter((r) => r.phone).length;
  const withEmail   = rows.filter((r) => r.email).length;
  const withPS      = rows.filter((r) => r.pagespeed_at).length;
  const hot         = rows.filter((r) => r.priority === "🔥 A+").length;
  const warm        = rows.filter((r) => r.priority === "🟡 A").length;
  console.log(`   Med telefon:    ${withPhone}`);
  console.log(`   Med email:      ${withEmail}`);
  console.log(`   PageSpeed-data: ${withPS}`);
  if (hot + warm > 0) {
    console.log(`   🔥 A+:          ${hot}`);
    console.log(`   🟡 A:           ${warm}`);
  }
}

main();
