#!/usr/bin/env node
/**
 * leads-vp-tak-discover.js — Steg 1/3 för "100 leads: värmepump + takläggare".
 *
 * Hämtar bolag från allabolag.se (nationellt, paginerat), behåller bara de med
 * omsättning 15–70 Mkr OCH telefonnummer. Skriver kandidater till
 * output/vp-tak-candidates.json för steg 2 (Google-recensioner via SerpAPI).
 *
 * Gratis: ingen SerpAPI används här. Allabolag-data: namn, telefon, omsättning,
 * orgnr, anställda, ort, bransch.
 */

const fs = require("node:fs");
const path = require("node:path");

const ALLABOLAG = "https://www.allabolag.se";
const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (b, s = 0.3) => Math.round(b + (Math.random() * 2 - 1) * s * b);
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

const REV_MIN_TKR = 15000;  // 15 Mkr  (allabolag revenue = tkr)
const REV_MAX_TKR = 70000;  // 70 Mkr
const DELAY_MS = 1500;

// Branscher + allabolag-industri-sökord (breddade för fler träffar)
const BRANCHES = [
  {
    branch: "Värmepumpar",
    queries: [
      "värmepump", "värmepumpar", "luftvärmepump", "bergvärme", "jordvärme",
      "frånluftsvärmepump", "värmepumpsinstallation", "kylinstallation",
      "klimatanläggning", "VVS",
    ],
  },
  {
    branch: "Takläggare",
    queries: [
      "takläggare", "takentreprenör", "takbeläggning", "takomläggning",
      "plåtslageri", "yttertak", "tätskikt",
    ],
  },
];

let blocks = 0;
async function fetchPage(industry, page) {
  const url = `${ALLABOLAG}/api/search?industry=${encodeURIComponent(industry)}&page=${page}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": pickUA(), Accept: "application/json", "Accept-Language": "sv-SE,sv;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status === 503 || res.status === 403) {
      blocks++;
      const wait = Math.min(30 * Math.pow(2, attempt), 300);
      process.stdout.write(`\n   🚧 HTTP ${res.status} — backar ${wait}s\n`);
      if (blocks >= 6) throw new Error("Allabolag blockerar upprepat — avbryter.");
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) return { companies: [], pages: 0 };
    return res.json();
  }
  return { companies: [], pages: 0 };
}

function fmtOrgNr(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : null;
}

const toInt = (v) => {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
};

function mapCompany(c, branch) {
  const orgnr = fmtOrgNr(c.orgnr || c.companyId || c.customerId);
  const phone = c.phone || c.phone2 || null;
  const mobile = c.mobile || c.mobile2 || null;

  // Alla branschklassningar från allabolag (unika namn)
  const industriesAll = [
    ...new Set((c.industries || []).map((i) => i.name).filter(Boolean)),
  ];

  const coords = c.location?.coordinates?.[0] || null;
  const va = c.visitorAddress || {};
  const addressParts = [va.addressLine || va.boxAddressLine, va.zipCode, va.postPlace]
    .filter(Boolean)
    .join(", ");

  // Marknadsföringsspärr → viktigt för GDPR/cold outreach
  const marketingBlock = c.marketingProtection === true;

  // Status: null + inga anmärkningar ≈ aktiv
  const remarks = (c.statusRemarks || []).filter(Boolean);
  const statusText = c.status || (remarks.length ? remarks.join("; ") : "Aktiv");

  return {
    orgnr,
    name: c.name || c.legalName || "",
    legalName: c.legalName || null,
    branch, // vår kategori (Värmepumpar / Takläggare)

    // Kontakt
    phone,
    mobile,
    email: c.email || null,
    homepage: c.homePage || null,

    // Ekonomi
    revenueTkr: toInt(c.revenue),
    profitTkr: toInt(c.profit),
    currency: c.currency || "SEK",
    accountsDate: c.companyAccountsLastUpdatedDate || null,
    employees: toInt(c.employees),

    // Bransch / klassning
    industryMain: c.currentIndustry?.name || industriesAll[0] || null,
    industriesAll,
    sniCode: c.currentIndustry?.code || null,

    // Plats
    county: c.location?.county || null,
    municipality: c.location?.municipality || va.postPlace || null,
    address: addressParts || null,
    lat: coords?.ycoordinate ?? null,
    lng: coords?.xcoordinate ?? null,

    // Beslutsfattare
    contactName: c.contactPerson?.name || null,
    contactRole: c.contactPerson?.role || null,

    // Övrigt nyttigt
    description: c.description || null,
    certificates: (c.certificates || []).map((x) => x.type).filter(Boolean),
    marketingBlock,
    status: statusText,
  };
}

async function main() {
  const seen = new Map(); // orgnr → candidate
  let raw = 0;
  console.log("🔍 Steg 1/3: Discover värmepump + takläggare via allabolag (nationellt)\n");
  console.log(`   Filter: omsättning ${REV_MIN_TKR / 1000}–${REV_MAX_TKR / 1000} Mkr + telefon krävs\n`);

  const MAX_DRY = 6;       // bryt query efter N sidor utan nya kvalade träffar
  const MAX_PAGES = 40;    // hård backstop per query

  for (const { branch, queries } of BRANCHES) {
    for (const q of queries) {
      let page = 1;
      let pages = 1;
      let dry = 0;
      do {
        let data;
        try {
          data = await fetchPage(q, page);
        } catch (e) {
          console.log(`\n   ⚠️  ${branch}/${q} sida ${page}: ${e.message}`);
          break;
        }
        const list = data.companies || [];
        pages = data.pages || 0;
        const before = seen.size;
        for (const c of list) {
          raw++;
          const m = mapCompany(c, branch);
          if (!m.orgnr) continue; // svenska bolag har 10-siffrigt orgnr
          if (!(m.phone || m.mobile)) continue; // telefon ELLER mobil krävs
          if (m.revenueTkr == null || m.revenueTkr < REV_MIN_TKR || m.revenueTkr > REV_MAX_TKR) continue;
          if (!seen.has(m.orgnr)) seen.set(m.orgnr, m);
        }
        const added = seen.size - before;
        dry = added > 0 ? 0 : dry + 1;
        process.stdout.write(
          `\r   ${branch.padEnd(12)} / ${q.padEnd(16)} sida ${String(page).padStart(2)}/${pages} — ${list.length} bolag (kvalar totalt: ${seen.size})   `
        );
        if (dry >= MAX_DRY) { process.stdout.write(`\n     ↳ inga nya på ${MAX_DRY} sidor — nästa query\n`); break; }
        if (page >= MAX_PAGES) { process.stdout.write(`\n     ↳ ${MAX_PAGES}-sidors-tak — nästa query\n`); break; }
        page++;
        if (page <= pages) await sleep(jitter(DELAY_MS));
      } while (page <= pages);
      console.log("");
    }
  }

  const candidates = [...seen.values()];
  // Sortera: störst omsättning först (mer "mogna" bolag), men behåll branch-mix
  candidates.sort((a, b) => (b.revenueTkr || 0) - (a.revenueTkr || 0));

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "vp-tak-candidates.json");
  fs.writeFileSync(outPath, JSON.stringify(candidates, null, 2));

  // Statistik
  const byBranch = {};
  for (const c of candidates) byBranch[c.branch] = (byBranch[c.branch] || 0) + 1;

  console.log(`\n📊 Resultat:`);
  console.log(`   Råträffar genomsökta:  ${raw}`);
  console.log(`   Kvalificerade (15–70M + telefon, unika orgnr): ${candidates.length}`);
  for (const [b, n] of Object.entries(byBranch)) console.log(`     • ${b}: ${n}`);
  console.log(`\n💾 Sparat: ${path.relative(__dirname, outPath)}`);
  console.log(`\n   Nästa steg: Google-recensioner via SerpAPI på dessa ${candidates.length} bolag.`);
}

main().catch((e) => {
  console.error("\n❌ Fel:", e.message || e);
  process.exit(1);
});
