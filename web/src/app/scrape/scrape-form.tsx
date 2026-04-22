"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Play, X, Search } from "lucide-react";
import { JobLayout } from "@/components/job-layout";
import { BrandPicker, useDefaultBrand } from "@/components/brand-picker";

const PRESETS: Record<string, { country: string; hl: string; gl: string }> = {
  SE: { country: "Sverige", hl: "sv", gl: "se" },
  NO: { country: "Norge", hl: "no", gl: "no" },
  DK: { country: "Danmark", hl: "da", gl: "dk" },
  GB: { country: "United Kingdom", hl: "en", gl: "uk" },
  IE: { country: "Ireland", hl: "en", gl: "ie" },
};

type Props = {
  branchesByCountry: Record<string, string[]>;
  citiesByCountry: Record<string, string[]>;
  countries: { code: string; label: string }[];
};

export function ScrapeForm({ branchesByCountry, citiesByCountry, countries }: Props) {
  const [region, setRegion] = useState<keyof typeof PRESETS>("SE");
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [citySearch, setCitySearch] = useState("");
  const [maxPages, setMaxPages] = useState(1);
  const [maxResults, setMaxResults] = useState<number | "">("");
  const [dryRun, setDryRun] = useState(false);
  const [brand, setBrand] = useDefaultBrand();

  const branches = branchesByCountry[region] ?? [];
  const cities = citiesByCountry[region] ?? [];

  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return cities;
    const q = citySearch.toLowerCase();
    return cities.filter((c) => c.toLowerCase().includes(q));
  }, [cities, citySearch]);

  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const changeRegion = (v: keyof typeof PRESETS) => {
    setRegion(v);
    setSelectedBranches([]);
    setSelectedCities([]);
    setCitySearch("");
  };

  const branchCount = selectedBranches.length || branches.length;
  const cityCount = selectedCities.length || cities.length;
  const queriesPerBranch = 3;
  const apiCalls = branchCount * cityCount * queriesPerBranch * maxPages;
  const estCost = apiCalls * 0.01;

  const jobLabel =
    (selectedBranches.length || "alla") + " × " + (selectedCities.length || "alla") + " städer";

  return (
    <JobLayout endpoint="/api/scrape" emptyHint='Klicka på "Starta scraping" för att börja'>
      {(job) => (
        <>
          <BrandPicker value={brand} onChange={setBrand} />

          <Card>
            <CardHeader>
              <CardTitle>Land</CardTitle>
              <CardDescription>
                Väljer bransch- och stadlistor samt Google-språk/region
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={region} onValueChange={(v) => changeRegion(v as keyof typeof PRESETS)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branscher</CardTitle>
              <CardDescription>
                {selectedBranches.length === 0
                  ? `Lämna tomt för alla ${branches.length}`
                  : `${selectedBranches.length} av ${branches.length} valda`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const on = selectedBranches.includes(b);
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setSelectedBranches((prev) => toggle(prev, b))}
                      className={
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                        (on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-accent hover:text-accent-foreground")
                      }
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Städer</CardTitle>
              <CardDescription>
                {selectedCities.length === 0
                  ? `Lämna tomt för alla ${cities.length} städer`
                  : `${selectedCities.length} av ${cities.length} valda`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedCities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedCities.map((c) => (
                    <Badge key={c} variant="secondary" className="gap-1 pr-1">
                      {c}
                      <button
                        onClick={() => setSelectedCities((p) => p.filter((x) => x !== c))}
                        className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedCities([])}
                    className="text-xs text-muted-foreground hover:underline ml-2"
                  >
                    Rensa alla
                  </button>
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Sök stad…"
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <div className="grid grid-cols-2 gap-x-2 p-2 sm:grid-cols-3">
                  {filteredCities.map((c) => {
                    const on = selectedCities.includes(c);
                    return (
                      <label
                        key={c}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={() => setSelectedCities((prev) => toggle(prev, c))}
                        />
                        <span className="truncate">{c}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inställningar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Max sidor per sökning</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={maxPages}
                    onChange={(e) =>
                      setMaxPages(Math.max(1, Math.min(5, Number(e.target.value) || 1)))
                    }
                  />
                  <p className="text-xs text-muted-foreground">1 sida ≈ 20 träffar per sökord</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Max leads totalt</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Ingen gräns"
                    value={maxResults}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMaxResults(v === "" ? "" : Math.max(1, Number(v) || 1));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stoppar jobbet när så många <em>nya</em> leads skapats
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(v === true)} />
                <div>
                  <div className="text-sm font-medium">Dry-run</div>
                  <div className="text-xs text-muted-foreground">
                    Visa vad som skulle köras, utan att anropa SerpAPI
                  </div>
                </div>
              </label>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-medium">Estimat</div>
                <div className="text-muted-foreground tabular-nums">
                  {apiCalls.toLocaleString("sv-SE")} API-anrop · ≈ ${estCost.toFixed(2)} (SerpAPI ~$0.01/anrop)
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            {!job.running ? (
              <Button
                onClick={() => {
                  const preset = PRESETS[region];
                  job.start({
                    branches: selectedBranches,
                    cities: selectedCities,
                    maxPages,
                    maxResults: typeof maxResults === "number" ? maxResults : 0,
                    dryRun,
                    country: preset.country,
                    hl: preset.hl,
                    gl: preset.gl,
                    brand,
                  });
                }}
                size="lg"
                className="gap-2"
              >
                <Play className="h-4 w-4" /> Starta scraping
              </Button>
            ) : (
              <Button onClick={job.stop} variant="destructive" size="lg" className="gap-2">
                <X className="h-4 w-4" /> Stoppa
              </Button>
            )}
            <div className="text-sm text-muted-foreground">
              Jobb: {jobLabel} · max {maxPages} sid{maxPages > 1 ? "or" : "a"}
              {typeof maxResults === "number" && maxResults > 0 && (
                <> · stop @ {maxResults} leads</>
              )}
            </div>
          </div>
        </>
      )}
    </JobLayout>
  );
}
