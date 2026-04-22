"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, X, Mail, Gauge, Building2, Sparkles, Megaphone, Wrench, Map, TrendingUp } from "lucide-react";
import { JobLayout } from "@/components/job-layout";
import type { Stats } from "@/lib/db";

type Kind =
  | "email"
  | "pagespeed"
  | "both"
  | "corp"
  | "outreach"
  | "meta-ads"
  | "tech"
  | "sitemap"
  | "domainrank";

const KIND_META: Record<Kind, { title: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = {
  both: { title: "E-post + PageSpeed", desc: "Kör båda stegen sekventiellt", icon: Gauge },
  email: { title: "Bara e-post", desc: "Snabbt — scrapar startsida + /kontakt", icon: Mail },
  pagespeed: {
    title: "Bara PageSpeed",
    desc: "Långsamt — kräver PAGESPEED_API_KEY för bra hastighet",
    icon: Gauge,
  },
  corp: {
    title: "Bolagsinfo (allabolag.se)",
    desc: "Org.nr, firmatecknare, omsättning, anställda, SNI-kod (1 req/2s)",
    icon: Building2,
  },
  tech: {
    title: "Tech-stack",
    desc: "Wix/Squarespace/WP/Webflow/custom — säljvinkel per plattform",
    icon: Wrench,
  },
  sitemap: {
    title: "Sitemap-räkning",
    desc: "Antal sidor i sitemap.xml + robots.txt-check (gratis SEO-mognad)",
    icon: Map,
  },
  domainrank: {
    title: "Domain Rank",
    desc: "OpenPageRank 0-10 (auktoritet) — gratis 1000/dag, kräver OPENPAGERANK_API_KEY",
    icon: TrendingUp,
  },
  outreach: {
    title: "Outreach-copy (AI)",
    desc: "Claude Haiku genererar mejl, LinkedIn-DM och telefonpitch per A+ lead",
    icon: Sparkles,
  },
  "meta-ads": {
    title: "Meta Ad Library",
    desc: "Kollar om bolaget kör Meta-annonser nu (kräver META_ACCESS_TOKEN)",
    icon: Megaphone,
  },
};

export function EnrichForm({ stats }: { stats: Stats }) {
  const [kind, setKind] = useState<Kind>("both");
  const [limit, setLimit] = useState(200);
  const [dryRun, setDryRun] = useState(false);

  const remaining = (() => {
    if (kind === "email") return Math.max(0, stats.withWebsite - stats.withEmail);
    if (kind === "pagespeed") return Math.max(0, stats.withWebsite - stats.withPagespeed);
    if (kind === "corp") return Math.max(0, stats.total - stats.withCorp);
    if (kind === "outreach") return Math.max(0, stats.hotLeads + stats.aLeads - stats.withOutreach);
    if (kind === "meta-ads") return Math.max(0, stats.withWebsite - stats.withMetaAds);
    if (kind === "tech") return Math.max(0, stats.withWebsite - stats.withTech);
    if (kind === "sitemap") return Math.max(0, stats.withWebsite - stats.withSitemap);
    if (kind === "domainrank") return Math.max(0, stats.withWebsite - stats.withDomainRank);
    return Math.max(0, stats.withWebsite - Math.min(stats.withEmail, stats.withPagespeed));
  })();

  return (
    <JobLayout endpoint="/api/enrich" emptyHint='Klicka på "Starta berikning" för att börja'>
      {(job) => (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Typ</CardTitle>
              <CardDescription>Vad ska berikas?</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(KIND_META) as Kind[]).map((k) => {
                const meta = KIND_META[k];
                const on = kind === k;
                const Icon = meta.icon;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={
                      "flex items-start gap-3 rounded-md border p-3 text-left transition-colors " +
                      (on
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-accent hover:text-accent-foreground")
                    }
                  >
                    <Icon
                      className={"mt-0.5 h-4 w-4 " + (on ? "text-primary" : "text-muted-foreground")}
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{meta.title}</div>
                      <div className="text-xs text-muted-foreground">{meta.desc}</div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inställningar</CardTitle>
              <CardDescription>
                ≈ {remaining.toLocaleString("sv-SE")} bolag återstår för "{KIND_META[kind].title}"
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Max bolag denna körning</Label>
                <Input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                />
                <p className="text-xs text-muted-foreground">
                  Bolag bearbetas i den ordning de skapades (FIFO).
                </p>
              </div>
              {kind === "corp" && (
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(v === true)} />
                  <div>
                    <div className="text-sm font-medium">Dry-run</div>
                    <div className="text-xs text-muted-foreground">
                      Visa kandidater utan att anropa allabolag.se
                    </div>
                  </div>
                </label>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            {!job.running ? (
              <Button
                onClick={() => job.start({ kind, limit, dryRun })}
                size="lg"
                className="gap-2"
              >
                <Play className="h-4 w-4" /> Starta berikning
              </Button>
            ) : (
              <Button onClick={job.stop} variant="destructive" size="lg" className="gap-2">
                <X className="h-4 w-4" /> Stoppa
              </Button>
            )}
            <div className="text-sm text-muted-foreground">
              {KIND_META[kind].title} · max {limit.toLocaleString("sv-SE")} bolag
            </div>
          </div>
        </>
      )}
    </JobLayout>
  );
}
