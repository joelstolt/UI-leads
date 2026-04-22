import {
  getBranchesByCountry,
  getCitiesByCountry,
  getCountries,
} from "@/lib/scrape-config";
import { ScrapeForm } from "./scrape-form";

export const dynamic = "force-dynamic";

export default function ScrapePage() {
  const countries = getCountries();
  const branchesByCountry = getBranchesByCountry();
  const citiesByCountry = getCitiesByCountry();

  const branchNamesByCountry: Record<string, string[]> = {};
  for (const c of countries) {
    branchNamesByCountry[c.code] = (branchesByCountry[c.code] ?? []).map((b) => b.name);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Skrapa leads</h1>
        <p className="text-muted-foreground mt-1">
          Välj land, branscher, städer och sidor. Vi kör{" "}
          <code className="text-xs">scrape.js</code> i bakgrunden och streamar output live.
        </p>
      </div>
      <ScrapeForm
        branchesByCountry={branchNamesByCountry}
        citiesByCountry={citiesByCountry}
        countries={countries.map((c) => ({ code: c.code, label: c.label }))}
      />
    </div>
  );
}
