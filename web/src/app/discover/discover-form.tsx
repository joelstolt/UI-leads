"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Play, X } from "lucide-react";
import { JobLayout } from "@/components/job-layout";
import { BrandPicker, useDefaultBrand } from "@/components/brand-picker";

const ALL_LABEL = "Alla";

export function DiscoverForm({ branches, cities }: { branches: string[]; cities: string[] }) {
  const [branch, setBranch] = useState("");
  const [city, setCity] = useState("");
  const [maxPages, setMaxPages] = useState(3);
  const [dryRun, setDryRun] = useState(false);
  const [brand, setBrand] = useDefaultBrand();

  const branchCount = branch ? 1 : branches.length;
  const cityCount = city ? 1 : cities.length;
  const totalJobs = branchCount * cityCount;
  const maxLeads = totalJobs * maxPages * 25;

  return (
    <JobLayout endpoint="/api/discover" emptyHint='Klicka på "Starta discovery" för att börja'>
      {(job) => (
        <>
          <BrandPicker value={brand} onChange={setBrand} />

          <Card>
            <CardHeader>
              <CardTitle>Bransch</CardTitle>
              <CardDescription>
                {branch ? `${branch} valt` : `Lämna tomt för alla ${branches.length} branscher`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Combobox
                value={branch}
                onChange={setBranch}
                options={branches}
                placeholder="Alla branscher"
                allLabel={ALL_LABEL}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stad</CardTitle>
              <CardDescription>
                {city ? `${city} valt` : `Lämna tomt för alla ${cities.length} städer`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Combobox
                value={city}
                onChange={setCity}
                options={cities}
                placeholder="Alla städer"
                allLabel={ALL_LABEL}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inställningar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Max sidor per (bransch, stad)</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={maxPages}
                  onChange={(e) =>
                    setMaxPages(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  25 bolag per sida. 3 sidor ≈ 75 bolag per (bransch, stad).
                </p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(v === true)} />
                <div>
                  <div className="text-sm font-medium">Dry-run</div>
                  <div className="text-xs text-muted-foreground">
                    Visa antal träffar utan att spara i DB
                  </div>
                </div>
              </label>

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-medium">Estimat</div>
                <div className="text-muted-foreground tabular-nums">
                  {totalJobs.toLocaleString("sv-SE")} jobb · max {maxLeads.toLocaleString("sv-SE")} bolag · ~{Math.round((totalJobs * maxPages * 0.8) / 60)} min · gratis
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            {!job.running ? (
              <Button
                onClick={() =>
                  job.start({
                    branch: branch || undefined,
                    city: city || undefined,
                    maxPages,
                    dryRun,
                    brand,
                  })
                }
                size="lg"
                className="gap-2"
              >
                <Play className="h-4 w-4" /> Starta discovery
              </Button>
            ) : (
              <Button onClick={job.stop} variant="destructive" size="lg" className="gap-2">
                <X className="h-4 w-4" /> Stoppa
              </Button>
            )}
            <div className="text-sm text-muted-foreground">
              {branch || "alla"} × {city || "alla städer"} · max {maxPages} sid
            </div>
          </div>
        </>
      )}
    </JobLayout>
  );
}
