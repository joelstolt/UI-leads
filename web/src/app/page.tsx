import Link from "next/link";
import {
  getStats,
  getBranchStats,
  getTechStats,
  getSitemapBuckets,
  getDomainRankBuckets,
} from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  Database,
  Phone,
  Mail,
  Globe,
  Gauge,
  Building2,
  Flame,
  TrendingUp,
  AlertCircle,
  Map as MapIcon,
  BarChart3,
} from "lucide-react";

const TECH_LABEL: Record<string, string> = {
  wix: "Wix",
  squarespace: "Squarespace",
  shopify: "Shopify",
  webflow: "Webflow",
  wordpress: "WordPress",
  joomla: "Joomla",
  drupal: "Drupal",
  nextjs: "Next.js",
  react: "React",
  "php-custom": "PHP-custom",
  aspnet: "ASP.NET",
  "plain-html": "Plain HTML",
  custom: "Custom",
  error: "🔴 Sajt nere",
};

const TECH_COLOR: Record<string, string> = {
  wix: "bg-orange-500",
  squarespace: "bg-orange-500",
  shopify: "bg-purple-500",
  webflow: "bg-emerald-500",
  wordpress: "bg-blue-500",
  nextjs: "bg-zinc-900",
  react: "bg-cyan-500",
  error: "bg-red-500",
};

export const dynamic = "force-dynamic";

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString("sv-SE")}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const SITEMAP_BUCKET_COLOR: Record<string, string> = {
  "0": "bg-red-500",
  "1-9": "bg-amber-500",
  "10-49": "bg-blue-500",
  "50-99": "bg-emerald-500",
  "100+": "bg-emerald-700",
};

const SITEMAP_BUCKET_INSIGHT: Record<string, string> = {
  "0": "Ingen sitemap — Google har svårt att indexera",
  "1-9": "Mini-sajt — stor SEO-möjlighet",
  "10-49": "Normal lokal sajt",
  "50-99": "Etablerat innehåll",
  "100+": "Stor sajt — pitcha CRO/Ads",
};

function bucketHref(min: number, max: number | null): string {
  const params = new URLSearchParams();
  params.set("sitemapMin", String(min));
  if (max != null) params.set("sitemapMax", String(max));
  return `/leads?${params}`;
}

const DR_BUCKET_COLOR: Record<string, string> = {
  "0": "bg-red-500",
  "1-2": "bg-amber-500",
  "3-4": "bg-blue-500",
  "5+": "bg-emerald-600",
};

const DR_BUCKET_INSIGHT: Record<string, string> = {
  "0": "Google litar inte på sajten — stor SEO-möjlighet",
  "1-2": "Lokal närvaro, svag auktoritet — tydlig pitch",
  "3-4": "Etablerat — fortsatt SEO ger ROI",
  "5+": "Stark domän — pitcha CRO/Ads, inte SEO-grunden",
};

function drBucketHref(min: number, max: number | null): string {
  const params = new URLSearchParams();
  params.set("domainRankMin", String(min));
  if (max != null) params.set("domainRankMax", String(max));
  return `/leads?${params}`;
}

export default async function DashboardPage() {
  const [stats, branchStats, techStats, sitemapBuckets, drBuckets] = await Promise.all([
    getStats(),
    getBranchStats(),
    getTechStats(),
    getSitemapBuckets(),
    getDomainRankBuckets(),
  ]);
  const errorCount = techStats.find((t) => t.tech_stack === "error")?.count ?? 0;
  const sitemapTotal = sitemapBuckets.reduce((s, b) => s + b.count, 0);
  const drTotal = drBuckets.reduce((s, b) => s + b.count, 0);

  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Översikt över din lead-databas</p>
        </div>
        <AutoRefresh />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Database} label="Totalt" value={stats.total} />
        <Stat icon={Flame} label="A+ leads" value={stats.hotLeads} hint={`${pct(stats.hotLeads)}%`} />
        <Stat icon={TrendingUp} label="A leads" value={stats.aLeads} hint={`${pct(stats.aLeads)}%`} />
        <Stat icon={Building2} label="Med bolagsinfo" value={stats.withCorp} hint={`${pct(stats.withCorp)}%`} />
        <Stat icon={Phone} label="Med telefon" value={stats.withPhone} hint={`${pct(stats.withPhone)}%`} />
        <Stat icon={Globe} label="Med hemsida" value={stats.withWebsite} hint={`${pct(stats.withWebsite)}%`} />
        <Stat icon={Mail} label="Med e-post" value={stats.withEmail} hint={`${pct(stats.withEmail)}%`} />
        <Stat icon={Gauge} label="PageSpeed-analyserade" value={stats.withPagespeed} hint={`${pct(stats.withPagespeed)}%`} />
      </div>

      {errorCount > 0 && (
        <Link
          href="/leads?techStack=error&hasPhone=1"
          className="block rounded-xl border border-red-200 bg-red-50 p-5 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:hover:bg-red-900"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <div className="font-semibold text-red-900 dark:text-red-100">
                  {errorCount.toLocaleString("sv-SE")} leads med sajt nere
                </div>
                <div className="text-sm text-red-700 dark:text-red-300">
                  Akuta säljmöjligheter — sajten svarar inte på fetch. Klicka för att se listan.
                </div>
              </div>
            </div>
            <div className="text-sm font-medium text-red-700 dark:text-red-300">→</div>
          </div>
        </Link>
      )}

      {sitemapTotal > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapIcon className="h-4 w-4" /> Per sitemap-storlek
                </CardTitle>
                <CardDescription>
                  {sitemapTotal.toLocaleString("sv-SE")} sajter scannade. Klicka för att filtrera.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sitemapBuckets.map((b) => {
                const max = Math.max(1, ...sitemapBuckets.map((x) => x.count));
                const w = (b.count / max) * 100;
                const color = SITEMAP_BUCKET_COLOR[b.key] ?? "bg-zinc-500";
                const pct = Math.round((b.count / sitemapTotal) * 100);
                return (
                  <Link
                    key={b.key}
                    href={bucketHref(b.min, b.max)}
                    className="flex items-center gap-3 text-sm rounded px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/40"
                  >
                    <div className="w-32 truncate font-medium">{b.label}</div>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
                      </div>
                    </div>
                    <div className="w-20 text-right tabular-nums text-muted-foreground">
                      {b.count.toLocaleString("sv-SE")}{" "}
                      <span className="text-[10px]">({pct}%)</span>
                    </div>
                    <div className="w-56 truncate text-xs text-muted-foreground italic">
                      {SITEMAP_BUCKET_INSIGHT[b.key]}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {drTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Per Domain Rank
            </CardTitle>
            <CardDescription>
              {drTotal.toLocaleString("sv-SE")} sajter scannade (OpenPageRank). Klicka för att filtrera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {drBuckets.map((b) => {
                const max = Math.max(1, ...drBuckets.map((x) => x.count));
                const w = (b.count / max) * 100;
                const color = DR_BUCKET_COLOR[b.key] ?? "bg-zinc-500";
                const pct = Math.round((b.count / drTotal) * 100);
                return (
                  <Link
                    key={b.key}
                    href={drBucketHref(b.min, b.max)}
                    className="flex items-center gap-3 text-sm rounded px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/40"
                  >
                    <div className="w-32 truncate font-medium">{b.label}</div>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
                      </div>
                    </div>
                    <div className="w-20 text-right tabular-nums text-muted-foreground">
                      {b.count.toLocaleString("sv-SE")}{" "}
                      <span className="text-[10px]">({pct}%)</span>
                    </div>
                    <div className="w-72 truncate text-xs text-muted-foreground italic">
                      {DR_BUCKET_INSIGHT[b.key]}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {techStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per plattform</CardTitle>
            <CardDescription>
              {techStats.reduce((s, t) => s + t.count, 0).toLocaleString("sv-SE")} sajter scannade. Klicka för att filtrera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {techStats.map((t) => {
                const maxCount = techStats[0].count;
                const w = maxCount ? (t.count / maxCount) * 100 : 0;
                const color = TECH_COLOR[t.tech_stack] ?? "bg-zinc-500";
                const label = TECH_LABEL[t.tech_stack] ?? t.tech_stack;
                return (
                  <Link
                    key={t.tech_stack}
                    href={`/leads?techStack=${encodeURIComponent(t.tech_stack)}`}
                    className="flex items-center gap-3 text-sm rounded px-1 py-0.5 -mx-1 transition-colors hover:bg-muted/40"
                  >
                    <div className="w-32 truncate font-medium">{label}</div>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
                      </div>
                    </div>
                    <div className="w-20 text-right tabular-nums text-muted-foreground">
                      {t.count.toLocaleString("sv-SE")}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Per bransch</CardTitle>
          <CardDescription>Antal leads i databasen per kategori</CardDescription>
        </CardHeader>
        <CardContent>
          {branchStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Inga leads i databasen ännu. Gå till <span className="font-medium">Skrapa</span> för att börja.
            </p>
          ) : (
            <div className="space-y-2">
              {branchStats.map((b) => {
                const maxCount = branchStats[0].count;
                const w = maxCount ? (b.count / maxCount) * 100 : 0;
                return (
                  <div key={b.branch} className="flex items-center gap-3 text-sm">
                    <div className="w-40 truncate font-medium">{b.branch}</div>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${w}%` }} />
                      </div>
                    </div>
                    <div className="w-16 text-right tabular-nums text-muted-foreground">
                      {b.count.toLocaleString("sv-SE")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
