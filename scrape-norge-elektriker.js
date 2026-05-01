/**
 * Scrape norska elektriker — mobilnummer krävs, hemsida valfri
 *
 * - Region: NO, språk: NO
 * - Filtrerar bort företag med >500 recensioner (stora kedjor)
 * - Filtrerar bort <3 recensioner (fake/nystartade)
 * - KRAV: mobilnummer (norska mobiler börjar +47 4 eller +47 9)
 * - Mål: 400 leads
 * - Börjar med Bergen, Trondheim, Stavanger
 * - Om <400, fortsätter med mindre städer
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error("❌ Saknar GOOGLE_PLACES_API_KEY"); process.exit(1); }

const TARGET = 400;
const MAX_REVIEWS = 500;
const MIN_REVIEWS = 3;

const CITIES = [
  // Topp 3 (ej Oslo)
  "Bergen", "Trondheim", "Stavanger",
  // Fallback om 400 inte räcker
  "Drammen", "Fredrikstad", "Sarpsborg", "Kristiansand", "Tromsø",
  "Sandnes", "Ålesund", "Tønsberg", "Moss", "Haugesund", "Bodø",
  "Arendal", "Hamar", "Larvik", "Halden", "Lillehammer", "Molde",
  "Harstad", "Gjøvik", "Porsgrunn", "Skien", "Kongsberg", "Horten",
];

const QUERIES = ["elektriker", "elektrikertjenester", "elinstallatør", "elfirma"];

const PLACES_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function searchPlaces(query, city) {
  const results = [];
  let url = `${PLACES_URL}?query=${encodeURIComponent(query + " " + city + " Norge")}&language=no&region=no&key=${API_KEY}`;
  for (let page = 0; page < 3; page++) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error(`  ⚠️  ${data.status} — ${data.error_message || ""}`);
      break;
    }
    if (data.results) results.push(...data.results);
    if (data.next_page_token) {
      await sleep(2000);
      url = `${PLACES_URL}?pagetoken=${data.next_page_token}&key=${API_KEY}`;
    } else break;
  }
  return results;
}

async function getDetails(placeId) {
  // Skippar opening_hours för att hålla nere kostnad (atmosphere-fält)
  const fields = "name,website,formatted_phone_number,international_phone_number,formatted_address,rating,user_ratings_total,business_status";
  const url = `${DETAILS_URL}?place_id=${placeId}&fields=${fields}&language=no&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.status === "OK" ? data.result : null;
}

/**
 * Norska mobilnummer börjar på 4 eller 9 (efter landskod 47).
 * Returnerar "Ja" om något av numren är mobil, annars "Nej".
 */
function isMobile(intl, fmt) {
  const candidates = [intl, fmt].filter(Boolean);
  for (const num of candidates) {
    const digits = num.replace(/\D/g, "");
    let local = digits;
    if (digits.startsWith("47") && digits.length === 10) local = digits.slice(2);
    if (local.length === 8 && (local[0] === "4" || local[0] === "9")) {
      return "Ja";
    }
  }
  return "Nej";
}

function escapeCSV(v) {
  if (!v) return "";
  const s = String(v);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const timestamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(__dirname, "output", `leads-norge-elektriker-${timestamp}.csv`);
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath,
    "Bransch,Stad,Företag,Hemsida,E-post,Telefon,Mobil,Adress,Betyg,Antal recensioner,Status\n");

  const seen = new Set();
  let saved = 0;
  let skippedNoPhone = 0;
  let skippedReviews = 0;

  console.log(`🇳🇴 Skrapar ${TARGET} norska elektriker (mobilnummer krävs)...\n`);

  outer:
  for (const city of CITIES) {
    if (saved >= TARGET) break;
    console.log(`\n━━━ ${city} ━━━`);
    for (const query of QUERIES) {
      if (saved >= TARGET) break outer;
      process.stdout.write(`  "${query}"... `);
      const places = await searchPlaces(query, city);
      const newPlaces = places.filter((p) => {
        if (seen.has(p.place_id)) return false;
        seen.add(p.place_id);
        return true;
      });

      const rows = [];
      for (const place of newPlaces) {
        const d = await getDetails(place.place_id);
        await sleep(80);
        if (!d) continue;

        const reviews = d.user_ratings_total || 0;
        if (reviews > MAX_REVIEWS || reviews < MIN_REVIEWS) {
          skippedReviews++;
          continue;
        }

        const phone = d.international_phone_number || d.formatted_phone_number || "";
        if (!phone) {
          skippedNoPhone++;
          continue;
        }
        const mobile = isMobile(d.international_phone_number, d.formatted_phone_number);

        rows.push({
          branch: "Elektriker",
          city,
          name: d.name || place.name,
          website: d.website || "",
          email: "",
          phone,
          mobile,
          address: d.formatted_address || "",
          rating: d.rating || "",
          reviews,
          status: d.business_status || "",
        });
        saved++;
        if (saved >= TARGET) break;
      }

      if (rows.length > 0) {
        const lines = rows.map((r) => [
          escapeCSV(r.branch), escapeCSV(r.city), escapeCSV(r.name),
          escapeCSV(r.website), escapeCSV(r.email), escapeCSV(r.phone),
          escapeCSV(r.mobile), escapeCSV(r.address), escapeCSV(r.rating),
          escapeCSV(r.reviews), escapeCSV(r.status),
        ].join(","));
        fs.appendFileSync(outPath, lines.join("\n") + "\n");
      }
      console.log(`+${rows.length} (totalt: ${saved}/${TARGET})`);
      await sleep(200);
    }
  }

  console.log(`\n✅ Klart!`);
  console.log(`   Sparade: ${saved} leads`);
  console.log(`   Skippade (ej telefonnr): ${skippedNoPhone}`);
  console.log(`   Skippade (recensioner): ${skippedReviews}`);
  console.log(`   Fil: ${outPath}`);
}

main().catch(console.error);
