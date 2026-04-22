"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Play, X, RotateCcw } from "lucide-react";
import { JobLayout } from "@/components/job-layout";
import type { Stats } from "@/lib/db";

const PRIORITIES = ["A+", "A", "B", "C"] as const;

export function SyncForm({ stats, branches }: { stats: Stats; branches: string[] }) {
  const [projectId, setProjectId] = useState("");
  const [limit, setLimit] = useState(500);
  const [priorities, setPriorities] = useState<string[]>(["A+", "A"]);
  const [branch, setBranch] = useState("");
  const [dryRun, setDryRun] = useState(true);

  const togglePriority = (p: string) =>
    setPriorities((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const remaining = Math.max(0, stats.withPhone - stats.withCrmSynced);

  return (
    <JobLayout endpoint="/api/sync" emptyHint='Välj prioritet, klicka "Starta sync"'>
      {(job) => (
        <>
          <Card>
            <CardHeader>
              <CardTitle>CRM-projekt</CardTitle>
              <CardDescription>
                Lämna tomt för att använda <code className="text-xs">CRM_DEFAULT_PROJECT_ID</code>{" "}
                i .env
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Label className="text-xs">Project ID</Label>
              <Input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="(använder env-fallback)"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filter</CardTitle>
              <CardDescription>
                ≈ {remaining.toLocaleString("sv-SE")} bolag återstår att synka (med telefon)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Prioritet</Label>
                <div className="flex flex-wrap gap-2">
                  {PRIORITIES.map((p) => {
                    const on = priorities.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePriority(p)}
                        className={
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                          (on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-accent hover:text-accent-foreground")
                        }
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Bransch</Label>
                  <Combobox
                    value={branch}
                    onChange={setBranch}
                    options={branches}
                    placeholder="Alla branscher"
                    allLabel="Alla branscher"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max bolag</Label>
                  <Input
                    type="number"
                    min={1}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(v === true)} />
                <div>
                  <div className="text-sm font-medium">Dry-run</div>
                  <div className="text-xs text-muted-foreground">
                    Visa exempel-payload utan att posta till webhook
                  </div>
                </div>
              </label>

              <p className="text-xs text-muted-foreground">
                Hastighet: ~50 req/min · ETA ≈{" "}
                {Math.ceil((Math.min(limit, remaining) * 1.2) / 60)} min för{" "}
                {Math.min(limit, remaining)} bolag
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            {!job.running ? (
              <>
                <Button
                  onClick={() =>
                    job.start({
                      projectId: projectId || undefined,
                      limit,
                      priorities: priorities.length ? priorities : undefined,
                      branch: branch || undefined,
                      dryRun,
                    })
                  }
                  size="lg"
                  className="gap-2"
                >
                  <Play className="h-4 w-4" /> Starta sync
                </Button>
                <Button
                  onClick={() => {
                    if (
                      !confirm(
                        `Nollställ crm_synced_at${branch ? ` för bransch "${branch}"` : ""}?`
                      )
                    )
                      return;
                    job.start({
                      projectId: projectId || undefined,
                      branch: branch || undefined,
                      reset: true,
                    });
                  }}
                  variant="outline"
                  size="lg"
                  className="gap-2"
                  disabled={!branch && !projectId}
                >
                  <RotateCcw className="h-4 w-4" /> Nollställ synk-tid
                </Button>
              </>
            ) : (
              <Button onClick={job.stop} variant="destructive" size="lg" className="gap-2">
                <X className="h-4 w-4" /> Stoppa
              </Button>
            )}
          </div>
        </>
      )}
    </JobLayout>
  );
}
