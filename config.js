/**
 * Centraliserad konfiguration: branscher, städer, konstanter.
 *
 * Branscher och städer per land lever i regions.json (delas med web/).
 * Denna modul deriverar de CLI-format som scrape.js använder:
 *   BRANCHES  — platt lista över alla branscher (unika på namn), för --branch/--branches
 *   CITIES    — default-stadslistan (svenska kommuner), används när --cities/--city saknas
 */

const regions = require("./regions.json");

// Flat, deduplicerad lista på branscher (samma namn i flera länder dyker upp en gång)
const seen = new Set();
const BRANCHES = [];
for (const list of Object.values(regions.branchesByCountry)) {
  for (const b of list) {
    if (!seen.has(b.name)) {
      seen.add(b.name);
      BRANCHES.push(b);
    }
  }
}

// Default-stadslistan = svenska kommuner (scrape.js default utan --cities)
const CITIES = regions.citiesByCountry.SE;

// Hur länge (dagar) innan vi räknar ett bolag som "inaktuellt" och re-scrapar
const RESCRAPE_AFTER_DAYS = 30;

// SerpAPI endpoint
const SERPAPI_BASE = "https://serpapi.com/search.json";

module.exports = { BRANCHES, CITIES, RESCRAPE_AFTER_DAYS, SERPAPI_BASE };
