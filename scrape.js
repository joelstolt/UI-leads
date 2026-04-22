/**
 * scrape.js — Hämtar bolag från Google Maps via SerpAPI
 *
 * Användning:
 *   node scrape.js                                        → alla branscher, alla 290 kommuner
 *   node scrape.js --branch snickare                      → en bransch (namn, case-insensitivt)
 *   node scrape.js --branch 2                             → en bransch (index)
 *   node scrape.js --branches elektriker,snickare,vvs     → flera branscher, kommaseparerat
 *   node scrape.js --city Stockholm                       → alla branscher, en stad
 *   node scrape.js --cities Stockholm,Göteborg,Malmö      → flera städer, kommaseparerat
 *   node scrape.js --max-pages 1                          → max 1 sida per sökning (kvotsnål)
 *   node scrape.js --max-results 100                      → stoppa efter 100 nya leads i jobbet
 *   node scrape.js --dry-run                              → visa jobb utan att köra
 *
 * Kräver: SERPAPI_KEY i .env
 */

require("dotenv").config({ override: true });
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const { BRANCHES, CITIES, RESCRAPE_AFTER_DAYS, SERPAPI_BASE } = require("./config");
const { upsertCompany, insertRun, finishRun, getDb, getStats, ensureBrandColumn, setBrand } = require("./db");

function brandForGl(gl) {
  if (gl === "uk" || gl === "ie") return "wlm-ie";
  return "wlm-se";
}

const API_KEY = process.env.SERPAPI_KEY;
if (!API_KEY) {
  console.error("❌ Saknar SERPAPI_KEY i .env — skapa ett konto på serpapi.com och lägg till nyckeln.");
  process.exit(1);
}

// Antal parallella SerpAPI-anrop (håll lågt för att inte bränna kvot)
const CONCURRENCY = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sök bolag via SerpAPI Google Maps engine.
 * Paginerar tills inga fler resultat eller max 3 sidor (ca 60 resultat).
 */
async function searchSerpApi(query, city, maxPages = 3, country = "Sverige", hl = "sv", gl = "se") {
  const results = [];
  let start = 0;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      engine:    "google_maps",
      q:         `${query} ${city} ${country}`,
      type:      "search",
      hl,
      gl,
      api_key:   API_KEY,
    });
    if (start > 0) params.set("start", String(start));

    const url = `${SERPAPI_BASE}?${params}`;

    const data = await pRetry(
      async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json;
      },
      {
        retries: 3,
        minTimeout: 2000,
        maxTimeout: 10000,
        onFailedAttempt: (err) => {
          console.warn(`  ⚠️  Retry ${err.attemptNumber}/3: ${err.message}`);
        },
      }
    );

    const places = data.local_results || [];
    results.push(...places);

    // Finns det fler sidor?
    if (!data.serpapi_pagination?.next || places.length < 20) break;
    start += 20;
    await sleep(500);
  }

  return results;
}

/**
 * Konvertera ett SerpAPI-resultat till vårt bolagsformat
 */
function mapSerpResult(place, branch, city) {
  return {
    place_id: place.place_id || `serp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name:     place.title || "",
    branch,
    city,
    phone:    place.phone || null,
    website:  place.website || null,
    address:  place.address || null,
    rating:   place.rating ?? null,
    reviews:  place.reviews ?? null,
    status:   place.open_state || null,
  };
}

/**
 * Kontrollera om ett bolag ska re-scraras baserat på scraped_at-timestamp
 */
function needsRescrape(placeId) {
  const row = getDb()
    .prepare("SELECT scraped_at FROM companies WHERE place_id = ?")
    .get(placeId);
  if (!row || !row.scraped_at) return true;

  const ageMs = Date.now() - new Date(row.scraped_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= RESCRAPE_AFTER_DAYS;
}

// ── CLI-argument ─────────────────────────────────────────────
function resolveBranch(term) {
  const match = BRANCHES.find((b) => b.name.toLowerCase().includes(term.toLowerCase()));
  if (!match) {
    console.error(`❌ Okänd bransch: "${term}". Tillgängliga: ${BRANCHES.map((b) => b.name).join(", ")}`);
    process.exit(1);
  }
  return match;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let branchArg  = null;
  let branchesArg = null;
  let cityArg    = null;
  let citiesArg  = null;
  let maxPages   = 3;
  let maxResults = 0;     // 0 = no cap
  let dryRun     = false;
  let country    = "Sverige";
  let hl         = "sv";
  let gl         = "se";
  let brand      = null;  // override default-brand som annars sätts via brandForGl

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch"      && args[i + 1]) branchArg   = args[++i];
    if (args[i] === "--branches"    && args[i + 1]) branchesArg = args[++i];
    if (args[i] === "--city"        && args[i + 1]) cityArg     = args[++i];
    if (args[i] === "--cities"      && args[i + 1]) citiesArg   = args[++i];
    if (args[i] === "--max-pages"   && args[i + 1]) maxPages    = parseInt(args[++i]);
    if (args[i] === "--max-results" && args[i + 1]) maxResults  = parseInt(args[++i]);
    if (args[i] === "--country"     && args[i + 1]) { country = args[++i]; }
    if (args[i] === "--hl"          && args[i + 1]) hl = args[++i];
    if (args[i] === "--gl"          && args[i + 1]) gl = args[++i];
    if (args[i] === "--brand"       && args[i + 1]) brand = args[++i];
    if (args[i] === "--dry-run") dryRun = true;
  }

  let branches;
  if (branchesArg) {
    branches = branchesArg.split(",").map((t) => resolveBranch(t.trim()));
  } else if (branchArg !== null) {
    const idx = parseInt(branchArg);
    branches = [!isNaN(idx) ? BRANCHES[idx] : resolveBranch(branchArg)];
  } else {
    branches = BRANCHES;
  }

  let cities;
  if (citiesArg) {
    cities = citiesArg.split(",").map((s) => s.trim());
  } else if (cityArg) {
    cities = [cityArg];
  } else {
    cities = CITIES;
  }

  return { branches, cities, maxPages, maxResults, dryRun, country, hl, gl, brand };
}

// ── Huvudprogram ─────────────────────────────────────────────
async function main() {
  ensureBrandColumn();
  const { branches, cities, maxPages, maxResults, dryRun, country, hl, gl, brand } = parseArgs();
  // CLI-arg överstyr default brandForGl-mappning
  const effectiveBrand = brand || brandForGl(gl);

  const jobs = [];
  for (const branch of branches) {
    for (const city of cities) {
      for (const query of branch.queries) {
        jobs.push({ branch: branch.name, city, query });
      }
    }
  }

  console.log("🔍 Lead Scraper — SerpAPI Google Maps");
  console.log(`   Branscher:   ${[...new Set(jobs.map((j) => j.branch))].join(", ")}`);
  console.log(`   Städer:      ${cities.length} st`);
  console.log(`   Jobb totalt: ${jobs.length}`);
  console.log(`   Max sidor:   ${maxPages} (max ${jobs.length * maxPages} API-anrop)`);
  if (maxResults > 0) console.log(`   Max leads:   ${maxResults} (stoppar när taket nås)`);
  if (dryRun) {
    console.log("\n[DRY-RUN] Inga API-anrop görs.\n");
    jobs.slice(0, 5).forEach((j) => console.log(`  ${j.query} ${j.city}`));
    if (jobs.length > 5) console.log(`  ... +${jobs.length - 5} till`);
    return;
  }
  console.log();

  const limit = pLimit(CONCURRENCY);
  let totalFound = 0;
  let totalNew = 0;
  let totalUpdated = 0;

  const tasks = jobs.map((job) =>
    limit(async () => {
      // Hoppa över kvarvarande jobb om taket är nått
      if (maxResults > 0 && totalNew >= maxResults) return;

      const runId = insertRun({ branch: job.branch, city: job.city, query: job.query });
      let found = 0;
      let newCount = 0;

      try {
        const places = await searchSerpApi(job.query, job.city, maxPages, country, hl, gl);
        found = places.length;

        for (const place of places) {
          if (!place.place_id) continue;
          if (!needsRescrape(place.place_id)) continue;
          if (maxResults > 0 && totalNew + newCount >= maxResults) break;

          const company = mapSerpResult(place, job.branch, job.city);
          const isNew = upsertCompany(company);
          if (isNew) {
            setBrand(company.place_id, effectiveBrand);
            newCount++;
          }
        }

        totalFound += found;
        totalNew += newCount;
        totalUpdated += found - newCount;

        const capHit = maxResults > 0 && totalNew >= maxResults;
        const label = `${job.query} / ${job.city}`;
        console.log(
          `  ✓ ${label.padEnd(45)} ${found} träffar, ${newCount} nya${capHit ? " — tak nått" : ""}`
        );
      } catch (err) {
        console.error(`  ✗ ${job.query} / ${job.city}: ${err.message}`);
      } finally {
        finishRun(runId, found, newCount);
      }
    })
  );

  await Promise.all(tasks);

  const stats = getStats();
  console.log(`\n✅ Klart!`);
  console.log(`   Träffar totalt:  ${totalFound}`);
  console.log(`   Nya bolag:       ${totalNew}`);
  console.log(`   Uppdaterade:     ${totalUpdated}`);
  console.log(`   DB totalt:       ${stats.total} bolag`);
  console.log(`   Med telefon:     ${stats.withPhone}`);
  console.log(`   Med hemsida:     ${stats.withWebsite}`);
}

main().catch(console.error);
