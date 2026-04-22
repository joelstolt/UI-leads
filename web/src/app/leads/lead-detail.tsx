"use client";

import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ExternalLink, Phone, Mail, MapPin, Building2, Gauge, Sparkles, FileText, Copy, Check, Megaphone, MessageSquare, Wrench, Lock, ShieldCheck, Smartphone, Map, BarChart3, TrendingUp } from "lucide-react";
import type { BranchBenchmark, Company } from "@/lib/db";
import { cn } from "@/lib/utils";
import { BRANDS, type BrandKey } from "@/lib/brands";

function BrandSelector({ lead }: { lead: Company }) {
  const [current, setCurrent] = useState<string | null>(lead.brand);
  const [saving, setSaving] = useState(false);

  const change = async (next: string) => {
    setSaving(true);
    try {
      await fetch("/api/lead/brand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ placeId: lead.place_id, brand: next || null }),
      });
      setCurrent(next || null);
    } finally {
      setSaving(false);
    }
  };

  const brand = current ? BRANDS[current as BrandKey] : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>Brand</span>
        {brand && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: brand.accent }}
          />
        )}
      </div>
      <select
        value={current ?? ""}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">— Inget brand —</option>
        {Object.values(BRANDS).map((b) => (
          <option key={b.key} value={b.key}>
            {b.name} ({b.domain})
          </option>
        ))}
      </select>
    </div>
  );
}

function priorityBadge(priority: string | null) {
  if (!priority) return null;
  let cls = "bg-secondary text-secondary-foreground";
  if (priority.includes("A+")) cls = "bg-red-500 text-white hover:bg-red-600";
  else if (priority.includes("A")) cls = "bg-amber-500 text-white hover:bg-amber-600";
  else if (priority.includes("B")) cls = "bg-blue-500 text-white hover:bg-blue-600";
  return <Badge className={cls}>{priority}</Badge>;
}

function ScoreChip({ label, value }: { label: string; value: number | null }) {
  const color =
    value === null
      ? "bg-muted text-muted-foreground"
      : value >= 90
        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
        : value >= 50
          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  return (
    <div className={cn("rounded-md px-3 py-2 text-center", color)}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function fmtRevenue(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mkr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} tkr`;
  return `${n} kr`;
}

function fmtFirmatecknare(s: string | null): string | null {
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.join(", ") : String(arr);
  } catch {
    return s;
  }
}

function CopyButton({ text, label = "Kopiera" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1 h-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {copied ? "Kopierat" : label}
    </Button>
  );
}

function OutreachBlock({ lead }: { lead: Company }) {
  type Tab = "email" | "linkedin" | "phone";
  const [tab, setTab] = useState<Tab>("email");

  if (!lead.outreach_generated_at) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Outreach-copy (AI)
        </div>
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Inte genererad än. Kör <code>outreach-gen.js</code> eller välj "Outreach-copy" på
          Berika-sidan.
        </div>
      </div>
    );
  }

  const subject = lead.outreach_email_subject ?? "";
  const body = lead.outreach_email_body ?? "";
  const linkedin = lead.outreach_linkedin ?? "";
  const phone = lead.outreach_phone ?? "";
  const emailFull = subject ? `Ämne: ${subject}\n\n${body}` : body;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Outreach-copy
          <span className="ml-1 text-[10px] tabular-nums">
            {lead.outreach_generated_at.slice(0, 10)}
          </span>
        </div>
      </div>
      <div className="rounded-md border">
        <div className="flex border-b text-xs">
          {(["email", "linkedin", "phone"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 px-3 py-2 font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "email" ? "E-post" : t === "linkedin" ? "LinkedIn" : "Telefon"}
            </button>
          ))}
        </div>
        <div className="p-3 space-y-2">
          {tab === "email" && (
            <>
              {subject && (
                <div className="text-sm font-medium">Ämne: {subject}</div>
              )}
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{body}</div>
              <div className="flex justify-end pt-1">
                <CopyButton text={emailFull} label="Kopiera mejl" />
              </div>
            </>
          )}
          {tab === "linkedin" && (
            <>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{linkedin}</div>
              <div className="flex justify-end pt-1">
                <CopyButton text={linkedin} label="Kopiera DM" />
              </div>
            </>
          )}
          {tab === "phone" && (
            <>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{phone}</div>
              <div className="flex justify-end pt-1">
                <CopyButton text={phone} label="Kopiera pitch" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TECH_LABELS: Record<string, { label: string; className: string; pitch: string }> = {
  wix: {
    label: "Wix",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    pitch: "Plattformen håller dem tillbaka — låst, dålig SEO. Pitcha rebuild.",
  },
  squarespace: {
    label: "Squarespace",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    pitch: "Snygg men låst. Pitcha SEO-förlust + rebuild på WP.",
  },
  shopify: {
    label: "Shopify",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
    pitch: "E-handel — pitcha CRO + Ads, inte rebuild.",
  },
  webflow: {
    label: "Webflow",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    pitch: "Bra design men dyr drift. Pitcha SEO + content, inte rebuild.",
  },
  wordpress: {
    label: "WordPress",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    pitch: "Optimerbar — vi kan jobba i deras setup. Snabb-fixar tillgängliga.",
  },
  joomla: { label: "Joomla", className: "bg-zinc-100 text-zinc-700", pitch: "Gammal CMS — pitcha migration." },
  drupal: { label: "Drupal", className: "bg-zinc-100 text-zinc-700", pitch: "Komplex CMS — pitcha SEO/content." },
  nextjs: {
    label: "Next.js",
    className: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    pitch: "Hög teknisk nivå. Pitcha SEO/Ads, inte rebuild.",
  },
  react: { label: "React", className: "bg-cyan-100 text-cyan-700", pitch: "SPA — kolla om de har SEO-problem (CSR)." },
  "php-custom": { label: "PHP-custom", className: "bg-zinc-100 text-zinc-700", pitch: "Handhackad — full rebuild möjlig." },
  aspnet: { label: "ASP.NET", className: "bg-blue-100 text-blue-700", pitch: "Företagslösning — försiktig pitch." },
  "plain-html": { label: "Plain HTML", className: "bg-amber-100 text-amber-700", pitch: "Statisk sajt — perfekt rebuild-kandidat." },
  custom: { label: "Custom", className: "bg-zinc-100 text-zinc-700", pitch: "Okänt CMS — kolla SEO/perf-status." },
  unknown: { label: "Okänt", className: "bg-zinc-100 text-zinc-500", pitch: "" },
  error: { label: "Sajt nere", className: "bg-red-100 text-red-700", pitch: "Sajten svarar inte. Akut behov." },
};

function TechBadges({ lead }: { lead: Company }) {
  if (!lead.tech_checked_at) return null;
  const tech = TECH_LABELS[lead.tech_stack ?? "unknown"] ?? TECH_LABELS.unknown;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Wrench className="h-3 w-3" /> Tech-stack
        <span className="ml-auto text-[10px] tabular-nums">{lead.tech_checked_at.slice(0, 10)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tech.className)}>
          {tech.label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            lead.tech_https
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-red-100 text-red-700"
          )}
          title={lead.tech_https ? "HTTPS aktiverat" : "Inget HTTPS"}
        >
          <Lock className="h-3 w-3" />
          {lead.tech_https ? "HTTPS" : "Ingen HTTPS"}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            lead.tech_has_schema
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700"
          )}
          title={lead.tech_has_schema ? "Schema.org-markup hittad" : "Saknar schema.org"}
        >
          <ShieldCheck className="h-3 w-3" />
          {lead.tech_has_schema ? "Schema" : "Inget schema"}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            lead.tech_has_viewport
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-red-100 text-red-700"
          )}
          title="Viewport-meta för mobil"
        >
          <Smartphone className="h-3 w-3" />
          {lead.tech_has_viewport ? "Viewport" : "Ingen viewport"}
        </span>
      </div>
      {tech.pitch && (
        <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Säljvinkel: </span>
          {tech.pitch}
        </div>
      )}
    </div>
  );
}

function DomainRankBlock({ lead }: { lead: Company }) {
  if (!lead.domain_rank_at) return null;
  const rank = lead.domain_rank ?? 0;
  const tone =
    rank < 1
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : rank < 3
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        : rank < 5
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  const verdict =
    rank < 1
      ? "Ny eller låg-auktoritet sajt — Google litar inte på dem. Stor SEO-möjlighet."
      : rank < 3
        ? "Lokal närvaro men svag auktoritet. Tydlig pitch."
        : rank < 5
          ? "Etablerat lokalt företag — fortsatt SEO-investering ger ROI."
          : "Stark domän — pitcha CRO/Ads, inte SEO-grunden.";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <TrendingUp className="h-3 w-3" /> Domain Rank
        <span className="ml-auto text-[10px] tabular-nums">
          {lead.domain_rank_at.slice(0, 10)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn("rounded-xl px-4 py-2 text-2xl font-bold tabular-nums", tone)}>
          {rank.toFixed(1)}
        </div>
        <div className="text-xs text-muted-foreground">av 10 (OpenPageRank)</div>
      </div>
      <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Insikt: </span>
        {verdict}
      </div>
    </div>
  );
}

function SitemapBlock({ lead }: { lead: Company }) {
  if (!lead.sitemap_checked_at) return null;
  const count = lead.sitemap_url_count ?? 0;
  const tone =
    count === 0
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : count < 10
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        : count < 100
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  const verdict =
    count === 0
      ? "Ingen sitemap. Google har svårt att indexera sajten."
      : count < 10
        ? "Mini-sajt. Stor SEO-möjlighet om de vill växa."
        : count < 100
          ? "Normal innehållsvolym."
          : "Stor sajt — pitcha SEO-optimering, inte rebuild.";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Map className="h-3 w-3" /> Sitemap & robots
        <span className="ml-auto text-[10px] tabular-nums">
          {lead.sitemap_checked_at.slice(0, 10)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
          {count.toLocaleString("sv-SE")} sidor
        </span>
        {lead.robots_has_sitemap === 1 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            robots.txt → sitemap
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            robots.txt nämner ingen sitemap
          </span>
        )}
        {lead.robots_disallows_root === 1 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            ⚠️ robots blockar Google
          </span>
        )}
      </div>
      <div className="rounded-md border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Insikt: </span>
        {verdict}
      </div>
    </div>
  );
}

function num(n: number | null | undefined, d = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("sv-SE", { maximumFractionDigits: d });
}

function diffArrow(value: number | null, avg: number | null, higherIsBetter = true): React.ReactNode {
  if (value == null || avg == null) return null;
  const diff = value - avg;
  const better = higherIsBetter ? diff > 0 : diff < 0;
  const cls = better ? "text-emerald-600" : "text-red-600";
  const sign = diff > 0 ? "+" : "";
  return <span className={cn("text-[10px] tabular-nums", cls)}>{sign}{diff.toFixed(0)}</span>;
}

function BenchmarkBlock({ lead, bench }: { lead: Company; bench: BranchBenchmark | null }) {
  if (!bench || bench.count < 5) return null;

  const rows: { label: string; value: number | null; avg: number | null; higherBetter?: boolean }[] = [
    { label: "Performance", value: lead.performance, avg: bench.avgPerformance },
    { label: "SEO", value: lead.seo, avg: bench.avgSeo },
    { label: "Accessibility", value: lead.accessibility, avg: bench.avgAccessibility },
    { label: "Betyg", value: lead.rating, avg: bench.avgRating },
    { label: "Recensioner", value: lead.reviews, avg: bench.avgReviews },
    { label: "Sitemap-sidor", value: lead.sitemap_url_count, avg: bench.avgSitemapUrls },
    { label: "Domain Rank", value: lead.domain_rank, avg: bench.avgDomainRank },
  ].filter((r) => r.value != null && r.avg != null);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BarChart3 className="h-3 w-3" /> Mot {bench.branch}-snittet ({bench.count} bolag)
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2 text-sm">
            <div className="text-xs text-muted-foreground truncate">{r.label}</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-medium">{num(r.value, r.label === "Betyg" ? 1 : 0)}</span>
              <span className="text-[10px] text-muted-foreground">/ {num(r.avg, r.label === "Betyg" ? 1 : 0)}</span>
              {diffArrow(r.value, r.avg, r.higherBetter !== false)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaAdsBadge({ lead }: { lead: Company }) {
  if (!lead.meta_ads_checked_at) return null;
  const active = lead.meta_ads_active === 1;
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <Megaphone className="h-3 w-3" />
        Kör Meta-ads ({lead.meta_ads_count ?? "?"})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      <Megaphone className="h-3 w-3" />
      Inga Meta-ads
    </span>
  );
}

function AuditLinkBlock({ placeId }: { placeId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/audit/${encodeURIComponent(placeId)}`;
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  const htmlExportPath = `/api/audit-html/${encodeURIComponent(placeId)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <FileText className="h-3 w-3" /> Personlig audit-sida
      </div>
      <div className="flex items-center gap-2 rounded-md border p-2">
        <code className="flex-1 truncate text-xs text-muted-foreground">{url}</code>
        <Button size="sm" variant="ghost" onClick={copy} className="gap-1 h-7">
          {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          {copied ? "Kopierat" : "Kopiera"}
        </Button>
        <Button asChild size="sm" variant="outline" className="gap-1 h-7">
          <Link href={path} target="_blank" rel="noopener">
            <ExternalLink className="h-3 w-3" /> Öppna
          </Link>
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        Eller{" "}
        <a href={htmlExportPath} download className="text-primary hover:underline">
          ladda ner som HTML-fil
        </a>
        {" "}— ladda upp i ditt sajt-projekt under <code>public/rapport/</code>.
      </div>
    </div>
  );
}

export function LeadDetail({
  lead,
  bench,
  open,
  onOpenChange,
}: {
  lead: Company | null;
  bench: BranchBenchmark | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {lead && (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-8">
                <SheetTitle className="text-xl leading-tight">{lead.name}</SheetTitle>
                {priorityBadge(lead.priority)}
              </div>
              <SheetDescription className="flex flex-wrap items-center gap-3">
                {lead.branch && <span>{lead.branch}</span>}
                {lead.city && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {lead.city}
                  </span>
                )}
                {lead.rating != null && (
                  <span>
                    ★ {lead.rating.toFixed(1)}
                    {lead.reviews != null && ` (${lead.reviews})`}
                  </span>
                )}
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                <MetaAdsBadge lead={lead} />
                {lead.brand && BRANDS[lead.brand as BrandKey] && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      background: BRANDS[lead.brand as BrandKey].accent + "22",
                      color: BRANDS[lead.brand as BrandKey].accent,
                    }}
                  >
                    {BRANDS[lead.brand as BrandKey].name}
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Phone className="h-3 w-3" /> Kontakt
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <Field label="Telefon">
                    {lead.phone ? (
                      <Link href={`tel:${lead.phone}`} className="text-primary hover:underline">
                        {lead.phone}
                      </Link>
                    ) : null}
                  </Field>
                  <Field label="E-post">
                    {lead.email ? (
                      <Link href={`mailto:${lead.email}`} className="text-primary hover:underline">
                        {lead.email}
                      </Link>
                    ) : null}
                  </Field>
                  <Field label="Hemsida">
                    {lead.website ? (
                      <Link
                        href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {lead.website} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </Field>
                  <Field label="Adress">{lead.address}</Field>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Gauge className="h-3 w-3" /> PageSpeed
                  {lead.pagespeed_at && (
                    <span className="ml-auto text-[10px] tabular-nums">
                      {lead.pagespeed_at.slice(0, 10)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <ScoreChip label="Performance" value={lead.performance} />
                  <ScoreChip label="SEO" value={lead.seo} />
                  <ScoreChip label="A11y" value={lead.accessibility} />
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  <Field label="Mobilvänlig">{lead.mobile_friendly}</Field>
                  <Field label="Laddtid">{lead.load_time}</Field>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Building2 className="h-3 w-3" /> Bolagsinfo
                  {lead.corp_enriched_at && (
                    <span className="ml-auto text-[10px] tabular-nums">
                      {lead.corp_enriched_at.slice(0, 10)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                  <Field label="Org.nr">{lead.org_nr}</Field>
                  <Field label="Anställda">{lead.employees}</Field>
                  <Field label="Omsättning">{fmtRevenue(lead.revenue)}</Field>
                  <Field label="SNI">{lead.sni_code}</Field>
                  <div className="col-span-2">
                    <Field label="Firmatecknare">{fmtFirmatecknare(lead.firmatecknare)}</Field>
                  </div>
                </div>
              </div>

              {(lead.usp_1 || lead.usp_2 || lead.usp_3) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> USP
                  </div>
                  <ul className="space-y-1.5 rounded-md border p-3 text-sm">
                    {[lead.usp_1, lead.usp_2, lead.usp_3].filter(Boolean).map((u, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span>{u}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Tidsstämplar</div>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-xs">
                  <Field label="Skrapad">{lead.scraped_at?.slice(0, 10)}</Field>
                  <Field label="E-post">{lead.email_scraped_at?.slice(0, 10)}</Field>
                  <Field label="PageSpeed">{lead.pagespeed_at?.slice(0, 10)}</Field>
                  <Field label="Bolagsinfo">{lead.corp_enriched_at?.slice(0, 10)}</Field>
                  <Field label="USP">{lead.usp_extracted_at?.slice(0, 10)}</Field>
                  <Field label="CRM-synkad">{lead.crm_synced_at?.slice(0, 10)}</Field>
                </div>
              </div>

              <BrandSelector lead={lead} />

              <TechBadges lead={lead} />

              <SitemapBlock lead={lead} />

              <DomainRankBlock lead={lead} />

              <BenchmarkBlock lead={lead} bench={bench} />

              <AuditLinkBlock placeId={lead.place_id} />

              <OutreachBlock lead={lead} />

              <div className="flex flex-wrap gap-2 pt-2">
                {lead.phone && (
                  <Button asChild size="sm" variant="default">
                    <Link href={`tel:${lead.phone}`}>
                      <Phone className="h-3 w-3" /> Ring
                    </Link>
                  </Button>
                )}
                {lead.email && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`mailto:${lead.email}`}>
                      <Mail className="h-3 w-3" /> Mejla
                    </Link>
                  </Button>
                )}
                {lead.website && (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                      target="_blank"
                      rel="noopener"
                    >
                      <ExternalLink className="h-3 w-3" /> Hemsida
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
