/**
 * Läser regions.json från projektroten (../regions.json relativt web/).
 * Källan av sanning delas med config.js — ingen manuell duplicering.
 */

import fs from "node:fs";
import path from "node:path";
import "server-only";

export type Branch = { name: string; queries: string[] };

export type Country = {
  code: CountryCode;
  label: string;
  hl: string;
  gl: string;
  country: string;
};

export type CountryCode = "SE" | "NO" | "DK" | "GB" | "IE";

type RegionsShape = {
  countries: Country[];
  branchesByCountry: Record<CountryCode, Branch[]>;
  citiesByCountry: Record<CountryCode, string[]>;
};

const REGIONS_PATH = path.resolve(process.cwd(), "..", "regions.json");

let _cache: RegionsShape | null = null;

function load(): RegionsShape {
  if (_cache) return _cache;
  const raw = fs.readFileSync(REGIONS_PATH, "utf8");
  _cache = JSON.parse(raw) as RegionsShape;
  return _cache;
}

export function getCountries(): Country[] {
  return load().countries;
}

export function getBranchesByCountry(): Record<CountryCode, Branch[]> {
  return load().branchesByCountry;
}

export function getCitiesByCountry(): Record<CountryCode, string[]> {
  return load().citiesByCountry;
}
