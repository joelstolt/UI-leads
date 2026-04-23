/**
 * pipeline.js — Kör hela enrichment-pipelinen sekventiellt
 *
 * Lämpligt att schemalägga via cron/launchd:
 *   0 6 * * * cd /path/to/leadsgoogle && /usr/local/bin/node pipeline.js >> pipeline.log 2>&1
 *
 * Eller via Mac launchd — se README.
 *
 * Användning:
 *   node pipeline.js                      → kör allt med standardgränser
 *   node pipeline.js --skip scrape,outreach
 *   node pipeline.js --enrich-limit 500
 *   node pipeline.js --scrape-args "--branches snickare,elektriker --max-pages 1 --max-results 200"
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = __dirname;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    skip: new Set(),
    enrichLimit: 200,
    techLimit: 500,
    sitemapLimit: 500,
    domainRankLimit: 500,
    corpLimit: 50,
    metaAdsLimit: 100,
    outreachLimit: 50,
    scrapeArgs: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) {
      args[++i].split(",").forEach((s) => opts.skip.add(s.trim()));
    }
    if (args[i] === "--enrich-limit" && args[i + 1]) opts.enrichLimit = parseInt(args[++i]);
    if (args[i] === "--tech-limit" && args[i + 1]) opts.techLimit = parseInt(args[++i]);
    if (args[i] === "--sitemap-limit" && args[i + 1]) opts.sitemapLimit = parseInt(args[++i]);
    if (args[i] === "--domainrank-limit" && args[i + 1]) opts.domainRankLimit = parseInt(args[++i]);
    if (args[i] === "--corp-limit" && args[i + 1]) opts.corpLimit = parseInt(args[++i]);
    if (args[i] === "--meta-ads-limit" && args[i + 1]) opts.metaAdsLimit = parseInt(args[++i]);
    if (args[i] === "--outreach-limit" && args[i + 1]) opts.outreachLimit = parseInt(args[++i]);
    if (args[i] === "--scrape-args" && args[i + 1]) opts.scrapeArgs = args[++i];
  }
  return opts;
}

function runStep(label, script, args = []) {
  return new Promise((resolve) => {
    console.log(`\n${"━".repeat(60)}`);
    console.log(`▶  ${label}: node ${script} ${args.join(" ")}`);
    console.log("━".repeat(60));
    const start = Date.now();
    const child = spawn("node", [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    child.on("close", (code) => {
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n   ✓ ${label} klart på ${dur}s${code !== 0 ? ` (exit ${code})` : ""}`);
      resolve(code);
    });
  });
}

async function main() {
  const opts = parseArgs();

  console.log("🚀 Lead-pipeline startar");
  console.log(`   Tid:     ${new Date().toLocaleString("sv-SE")}`);
  console.log(`   Skippar: ${opts.skip.size ? [...opts.skip].join(", ") : "(inget)"}`);

  const start = Date.now();
  const steps = [];

  // 1. Scrape (valfritt — ofta vill man inte scrape:a varje natt)
  if (!opts.skip.has("scrape") && opts.scrapeArgs) {
    steps.push(["Scrape", "scrape.js", opts.scrapeArgs.split(/\s+/).filter(Boolean)]);
  } else if (!opts.skip.has("scrape") && !opts.scrapeArgs) {
    console.log("\n   ℹ️  Scrape skippad (inga --scrape-args satta).");
  }

  // 2. Enrich email + PageSpeed
  if (!opts.skip.has("enrich")) {
    steps.push(["Email + PageSpeed", "enrich.js", ["--limit", String(opts.enrichLimit)]]);
  }

  // 3. Bolagsinfo (allabolag)
  if (!opts.skip.has("corp")) {
    steps.push(["Bolagsinfo", "enrich-corp.js", ["--limit", String(opts.corpLimit)]]);
  }

  // 4. Tech-stack
  if (!opts.skip.has("tech")) {
    steps.push(["Tech-stack", "enrich-tech.js", ["--limit", String(opts.techLimit)]]);
  }

  // 5. Sitemap
  if (!opts.skip.has("sitemap")) {
    steps.push(["Sitemap", "enrich-sitemap.js", ["--limit", String(opts.sitemapLimit)]]);
  }

  // 6. Domain Rank (skippa om nyckel saknas)
  if (!opts.skip.has("domainrank") && process.env.OPENPAGERANK_API_KEY) {
    steps.push(["Domain Rank", "enrich-domainrank.js", ["--limit", String(opts.domainRankLimit)]]);
  } else if (!opts.skip.has("domainrank")) {
    console.log("\n   ℹ️  Domain Rank skippad (OPENPAGERANK_API_KEY saknas).");
  }

  // 7. Meta Ads (skippa om token saknas)
  if (!opts.skip.has("meta-ads") && process.env.META_ACCESS_TOKEN) {
    steps.push(["Meta Ads", "enrich-ads.js", ["--limit", String(opts.metaAdsLimit)]]);
  } else if (!opts.skip.has("meta-ads")) {
    console.log("\n   ℹ️  Meta Ads skippad (META_ACCESS_TOKEN saknas).");
  }

  // 7. Outreach (kräver att leads har PageSpeed-data, så efter steg 2)
  if (!opts.skip.has("outreach")) {
    steps.push([
      "Outreach-copy",
      "outreach-gen.js",
      ["--priority", "A+,A", "--limit", String(opts.outreachLimit)],
    ]);
  }

  // 8. Sync till Turso så prod-sajten får uppdaterade leads
  if (!opts.skip.has("sync")) {
    if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
      steps.push(["Sync till Turso", "sync-to-turso.js", []]);
    } else {
      console.log("\n   ℹ️  Turso-sync skippad (TURSO_DATABASE_URL/TURSO_AUTH_TOKEN saknas).");
    }
  }

  for (const [label, script, args] of steps) {
    await runStep(label, script, args);
  }

  const total = ((Date.now() - start) / 1000 / 60).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Pipeline klar på ${total} min`);
  console.log("═".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
