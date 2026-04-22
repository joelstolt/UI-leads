import {
  getBranchesByCountry,
  getCitiesByCountry,
} from "@/lib/scrape-config";
import { DiscoverForm } from "./discover-form";

export const dynamic = "force-dynamic";

export default function DiscoverPage() {
  const branches = getBranchesByCountry().SE.map((b) => b.name);
  const cities = getCitiesByCountry().SE;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Discover (allabolag.se)</h1>
        <p className="text-muted-foreground mt-1">
          Hämta nya leads gratis från allabolag.se istället för betald SerpAPI. Får
          direkt: namn, org.nr, telefon (för en del), hemsida (för en del),
          omsättning, anställda och SNI-kod. Dedupar mot existerande bolag.
        </p>
      </div>
      <DiscoverForm branches={branches} cities={cities} />
    </div>
  );
}
