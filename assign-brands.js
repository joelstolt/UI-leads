/**
 * assign-brands.js — engångsskript som tilldelar brand baserat på country.
 *
 * Logik:
 *   - SE/NO/DK-stad → wlm-se
 *   - GB/IE-stad   → wlm-ie
 *   - Övriga       → wlm-se (default)
 *
 * Kör om för att uppdatera nya leads — använder bara på leads där brand IS NULL
 * om inte --force flaggan ges.
 *
 * Användning:
 *   node assign-brands.js              → bara nya leads (brand IS NULL)
 *   node assign-brands.js --force      → överskriv alla
 */

require("dotenv").config({ override: true });
const { getDb, ensureBrandColumn } = require("./db");
const regions = require("./regions.json");

// Bygg city → countryCode-lookup
const CITY_TO_COUNTRY = {};
for (const [code, cities] of Object.entries(regions.citiesByCountry)) {
  for (const city of cities) CITY_TO_COUNTRY[city.toLowerCase()] = code;
}

function brandForCountry(cc) {
  if (!cc) return "wlm-se";
  if (cc === "GB" || cc === "IE") return "wlm-ie";
  if (cc === "SE" || cc === "NO" || cc === "DK") return "wlm-se";
  return "wlm-se";
}

function brandForLead(city) {
  if (!city) return "wlm-se";
  const cc = CITY_TO_COUNTRY[city.toLowerCase()];
  return brandForCountry(cc);
}

function main() {
  ensureBrandColumn();
  const force = process.argv.includes("--force");
  const db = getDb();

  const where = force ? "" : "WHERE brand IS NULL";
  const leads = db.prepare(`SELECT place_id, city FROM companies ${where}`).all();

  console.log(`🏷  Brand-assign (${force ? "FORCE" : "endast saknande"})`);
  console.log(`   Att processera: ${leads.length}`);

  const counts = {};
  const update = db.prepare("UPDATE companies SET brand = ?, updated_at = datetime('now') WHERE place_id = ?");
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const brand = brandForLead(r.city);
      update.run(brand, r.place_id);
      counts[brand] = (counts[brand] || 0) + 1;
    }
  });
  tx(leads);

  console.log("\n📊 Fördelning:");
  for (const [b, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${b.padEnd(10)} ${n.toLocaleString("sv-SE")}`);
  }
}

main();
