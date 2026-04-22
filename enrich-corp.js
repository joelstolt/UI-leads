/**
 * enrich-corp.js — Matchar bolag mot allabolag.se JSON API
 *
 * Extraherar: org_nr, firmatecknare (kontaktperson), omsättning, anställda, SNI-kod
 * Förväntad träffsäkerhet: ~70–80%
 *
 * API: GET https://www.allabolag.se/api/search?name={bolagsnamn}
 * Matchar mot rätt bolag via namn + stad.
 * Rate-limit: 1 req/2s.
 *
 * Användning:
 *   node enrich-corp.js             → alla bolag som saknar corp-data
 *   node enrich-corp.js --limit 50  → max 50 bolag
 *   node enrich-corp.js --dry-run   → visa vad som skulle köras
 */

require("dotenv").config({ override: true });
const { getCompaniesNeedingCorp, updateCorp, getStats } = require("./db");

const DELAY_MS = 2000;
const BASE_URL = "https://www.allabolag.se";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "sv-SE,sv;q=0.9",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Formatera org-nummer: "5592801186" → "559280-1186"
 */
function formatOrgNr(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return raw;
}

/**
 * Enkel namnjämförelse — hur stor andel ord matchar?
 */
function nameScore(a, b) {
  if (!a || !b) return 0;
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/\b(ab|hb|kb|ef|ekf|aktiebolag)\b/g, "")
      .replace(/[^a-zåäö0-9\s]/g, "")
      .trim();
  const wa = norm(a).split(/\s+/).filter((w) => w.length > 1);
  const wb = norm(b).split(/\s+/).filter((w) => w.length > 1);
  const matches = wa.filter((w) => wb.some((bw) => bw.startsWith(w) || w.startsWith(bw)));
  return matches.length / Math.max(wa.length, 1);
}

/**
 * Sök bolag via allabolag.se JSON API
 * Returnerar bästa träff eller null
 */
async function searchCompany(name, city) {
  const url = `${BASE_URL}/api/search?name=${encodeURIComponent(name)}`;

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const candidates = data.companies || [];
    if (candidates.length === 0) return null;

    // Poängsätt kandidater: namn-match + stad-match
    const scored = candidates.map((c) => {
      let score = nameScore(name, c.name || c.legalName);
      const municipality = c.location?.municipality || "";
      if (city && municipality.toLowerCase() === city.toLowerCase()) score += 0.5;
      return { company: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // Kräv minst 50% namnmatch
    if (best.score < 0.5) return null;
    return best.company;
  } catch {
    return null;
  }
}

/**
 * Mappa allabolag.se API-svar till våra DB-fält
 */
function mapCompanyData(c) {
  // Firmatecknare: contactPerson är primär kontakt från API:et
  const firmatecknare = [];
  if (c.contactPerson?.name) {
    firmatecknare.push(c.contactPerson.name);
  }

  // SNI-kod från primär bransch
  const sniCode = c.currentIndustry?.code || c.industries?.[0]?.code || null;
  const sniName = c.currentIndustry?.name || c.industries?.[0]?.name || null;
  const sniFormatted = sniCode ? `${sniCode} ${sniName || ""}`.trim() : null;

  // Omsättning: revenue är i tkr (tusen SEK) — konvertera till SEK
  let revenue = null;
  if (c.revenue) {
    const num = parseFloat(String(c.revenue).replace(/[^\d.]/g, ""));
    if (!isNaN(num)) revenue = Math.round(num * 1000); // tkr → kr
  }

  // Anställda
  const employees = c.employees ? parseInt(c.employees) || null : null;

  return {
    org_nr: formatOrgNr(c.orgnr || c.customerId),
    firmatecknare,
    revenue,
    employees,
    sni_code: sniFormatted,
  };
}

// ── Huvudprogram ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let limit = 500;

  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]);
  }

  const branchesIdx = args.indexOf("--branches");
  const citiesIdx = args.indexOf("--cities");
  const branchesArg = branchesIdx !== -1 && args[branchesIdx + 1] ? args[branchesIdx + 1].split(",").map((s) => s.trim()) : null;
  const citiesArg = citiesIdx !== -1 && args[citiesIdx + 1] ? args[citiesIdx + 1].split(",").map((s) => s.trim()) : null;

  let companies;
  if (branchesArg || citiesArg) {
    const { getDb } = require("./db");
    const db = getDb();
    const where = ["corp_enriched_at IS NULL"];
    const params = [];
    if (branchesArg) { where.push(`branch IN (${branchesArg.map(() => "?").join(",")})`); params.push(...branchesArg); }
    if (citiesArg) { where.push(`city IN (${citiesArg.map(() => "?").join(",")})`); params.push(...citiesArg); }
    companies = db.prepare(`SELECT * FROM companies WHERE ${where.join(" AND ")} ORDER BY created_at ASC LIMIT ?`).all(...params, limit);
  } else {
    companies = getCompaniesNeedingCorp(limit);
  }

  console.log("🏢 Corp Enrichment — allabolag.se JSON API");
  console.log(`   Bolag att bearbeta: ${companies.length}`);
  console.log(`   Hastighet: 1 req/${DELAY_MS / 1000}s`);
  if (dryRun) {
    console.log("\n[DRY-RUN] Inga anrop görs.");
    companies.slice(0, 5).forEach((c) => console.log(`  ${c.name} (${c.city})`));
    return;
  }
  console.log();

  let matched = 0;
  let notFound = 0;
  let i = 0;

  for (const company of companies) {
    i++;
    const label = `[${i}/${companies.length}] ${company.name.slice(0, 38).padEnd(38)}`;
    process.stdout.write(`\r  ${label} `);

    const result = await searchCompany(company.name, company.city);
    await sleep(DELAY_MS);

    if (!result) {
      updateCorp(company.place_id, {});
      notFound++;
      process.stdout.write("✗ (ej matchad)\n");
      continue;
    }

    const data = mapCompanyData(result);
    updateCorp(company.place_id, data);
    matched++;

    const signers = data.firmatecknare.length > 0
      ? data.firmatecknare.join(", ")
      : "–";
    const rev = data.revenue ? `${Math.round(data.revenue / 1000)} tkr` : "–";
    process.stdout.write(`✓ ${data.org_nr || "?"} | ${signers} | ${rev}\n`);
  }

  console.log(`\n✅ Klart!`);
  console.log(`   Matchade:    ${matched} / ${i} (${Math.round((matched / Math.max(i, 1)) * 100)}%)`);
  console.log(`   Ej hittade:  ${notFound}`);

  const stats = getStats();
  console.log(`   Corp-enriched totalt: ${stats.withCorp}`);
}

main().catch(console.error);
