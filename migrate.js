/**
 * migrate.js — Importerar befintliga leads-*.csv till SQLite
 *
 * Kör en gång:
 *   node migrate.js
 *
 * Genererar ett deterministiskt fake-place_id från namn + adress eftersom
 * de ursprungliga CSV-filerna saknar Google place_id.
 * Skippar irländska leads (leads-ireland-*.csv).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { upsertCompany, updateEmail, getStats } = require("./db");

function makeFakePlaceId(name, address) {
  const raw = `${(name || "").toLowerCase().trim()}|${(address || "").toLowerCase().trim()}`;
  return "migrated_" + crypto.createHash("sha1").update(raw).digest("hex");
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = [];
  let current = "";
  let inQuotes = false;
  for (const char of lines[0]) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === "," && !inQuotes) { header.push(current); current = ""; }
    else { current += char; }
  }
  header.push(current);

  return lines.slice(1).map((line) => {
    const values = [];
    let cur = "";
    let inQ = false;
    for (const char of line) {
      if (char === '"') { inQ = !inQ; }
      else if (char === "," && !inQ) { values.push(cur); cur = ""; }
      else { cur += char; }
    }
    values.push(cur);
    const obj = {};
    header.forEach((h, i) => { obj[h.trim()] = (values[i] || "").trim(); });
    return obj;
  });
}

function extractDateFromFilename(filename) {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] + "T00:00:00.000Z" : new Date().toISOString();
}

async function main() {
  const outputDir = path.join(__dirname, "output");
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith("leads-") && f.endsWith(".csv") && !f.includes("ireland"))
    .sort();

  if (files.length === 0) {
    console.log("Inga leads-*.csv-filer hittades i output/. Inget att migrera.");
    return;
  }

  console.log(`Migrerar ${files.length} CSV-fil(er) till SQLite...\n`);

  let totalRows = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  const seen = new Set();

  for (const file of files) {
    const filePath = path.join(outputDir, file);
    const scrapedAt = extractDateFromFilename(file);
    const rows = parseCSV(filePath);

    let fileInserted = 0;
    let fileSkipped = 0;

    for (const row of rows) {
      totalRows++;
      const name = row["Företag"] || row["Company"] || "";
      const address = row["Adress"] || row["Address"] || "";

      if (!name) { fileSkipped++; totalSkipped++; continue; }

      const placeId = makeFakePlaceId(name, address);

      if (seen.has(placeId)) { fileSkipped++; totalSkipped++; continue; }
      seen.add(placeId);

      const company = {
        place_id: placeId,
        name,
        branch:   row["Bransch"] || row["Branch"] || null,
        city:     row["Stad"] || row["City"] || null,
        phone:    row["Telefon"] || row["Phone"] || null,
        website:  row["Hemsida"] || row["Website"] || null,
        address:  address || null,
        rating:   parseFloat(row["Betyg"] || row["Rating"]) || null,
        reviews:  parseInt(row["Antal recensioner"] || row["Reviews"]) || null,
        status:   row["Status"] || null,
      };

      upsertCompany(company);

      // Uppdatera scraped_at till CSV-filens datum (inte now())
      const { getDb } = require("./db");
      getDb()
        .prepare("UPDATE companies SET scraped_at = ? WHERE place_id = ?")
        .run(scrapedAt, placeId);

      // Migrera email om det finns
      const email = row["E-post"] || row["Email"] || "";
      if (email) {
        updateEmail(placeId, email);
      }

      fileInserted++;
      totalInserted++;
    }

    console.log(`  ${file}: ${rows.length} rader → ${fileInserted} importerade, ${fileSkipped} skippade`);
  }

  console.log(`\nKlart!`);
  console.log(`  Totalt rader: ${totalRows}`);
  console.log(`  Importerade:  ${totalInserted}`);
  console.log(`  Skippade:     ${totalSkipped} (dubbletter / tomma namn)`);

  const stats = getStats();
  console.log(`\nDB-statistik efter migration:`);
  console.log(`  Bolag totalt:    ${stats.total}`);
  console.log(`  Med telefon:     ${stats.withPhone}`);
  console.log(`  Med hemsida:     ${stats.withWebsite}`);
  console.log(`  Med email:       ${stats.withEmail}`);
}

main().catch(console.error);
