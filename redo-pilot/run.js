#!/usr/bin/env node
/**
 * redo-pilot/run.js — pipeline-orchestrator: kör alla 5 stegen i ordning.
 *
 *   1. discover.js  — allabolag → leads-redo.db
 *   2. filter.js    — markera kedjor + rapportera sweet spot
 *   3. enrich.js    — sajt + PageSpeed
 *   4. score.js     — räkna 0–100
 *   5. export.js    — shortlist.csv
 *
 * Användning:
 *   node redo-pilot/run.js                  → Malmö, alla queries, default max-pages
 *   node redo-pilot/run.js --city Lund
 *   node redo-pilot/run.js --skip-discover  → kör om enrich/score/export på befintlig DB
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function step(label, script, args = []) {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log("━".repeat(60));
  const r = spawnSync("node", [path.join(__dirname, script), ...args], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`\n❌ ${script} avslutade med kod ${r.status}`);
    process.exit(r.status || 1);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    city: "Malmö",
    maxPages: null,
    skipDiscover: false,
    skipFilter: false,
    skipFindWebsites: false,
    skipEnrich: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--city" && args[i + 1]) opts.city = args[++i];
    if (args[i] === "--max-pages" && args[i + 1]) opts.maxPages = args[++i];
    if (args[i] === "--skip-discover") opts.skipDiscover = true;
    if (args[i] === "--skip-filter") opts.skipFilter = true;
    if (args[i] === "--skip-find-websites") opts.skipFindWebsites = true;
    if (args[i] === "--skip-enrich") opts.skipEnrich = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  console.log("🚀 redo-pilot pipeline");
  console.log(`   Stad: ${opts.city}`);

  if (!opts.skipDiscover) {
    const args = ["--city", opts.city];
    if (opts.maxPages) args.push("--max-pages", opts.maxPages);
    step("1/6  Discover (allabolag)", "discover.js", args);
  }
  if (!opts.skipFilter) {
    step("2/6  Filter (markera kedjor + sweet-spot-rapport)", "filter.js");
  }
  if (!opts.skipFindWebsites) {
    step("3/6  Find websites (SerpAPI för alla utan hemsida)", "find-websites.js", ["--all"]);
  }
  if (!opts.skipEnrich) {
    step("4/6  Enrich (sajt + PageSpeed på ALLA med hemsida)", "enrich.js");
  }
  step("5/6  Score (sweet-spot-bonus + tells)", "score.js", ["--top", "30"]);
  step("6/6  Export (CSV, sweet spot först)", "export.js");

  console.log(`\n${"━".repeat(60)}`);
  console.log("✅ Pipeline klar! Shortlist sparad i redo-pilot/shortlist.csv");
  console.log("━".repeat(60));
}

main();
