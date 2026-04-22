import {
  getLeads,
  getDistinctBranches,
  getDistinctCities,
  getBranchBenchmark,
  getTechStats,
  type BranchBenchmark,
} from "@/lib/db";
import { LeadsTable } from "./leads-table";
import { LeadsFilters } from "./leads-filters";

export const dynamic = "force-dynamic";

type SearchParams = {
  branch?: string;
  city?: string;
  priority?: string;
  techStack?: string;
  sitemapMin?: string;
  sitemapMax?: string;
  domainRankMin?: string;
  domainRankMax?: string;
  brand?: string;
  hasPhone?: string;
  hasEmail?: string;
  hasWebsite?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);

  const sitemapMin = sp.sitemapMin != null && sp.sitemapMin !== "" ? Number(sp.sitemapMin) : undefined;
  const sitemapMax = sp.sitemapMax != null && sp.sitemapMax !== "" ? Number(sp.sitemapMax) : undefined;
  const drMin = sp.domainRankMin != null && sp.domainRankMin !== "" ? Number(sp.domainRankMin) : undefined;
  const drMax = sp.domainRankMax != null && sp.domainRankMax !== "" ? Number(sp.domainRankMax) : undefined;

  const { rows, total, pageSize } = await getLeads({
    branch: sp.branch || undefined,
    city: sp.city || undefined,
    priority: sp.priority || undefined,
    techStack: sp.techStack || undefined,
    sitemapMin: Number.isFinite(sitemapMin) ? sitemapMin : undefined,
    sitemapMax: Number.isFinite(sitemapMax) ? sitemapMax : undefined,
    domainRankMin: Number.isFinite(drMin) ? drMin : undefined,
    domainRankMax: Number.isFinite(drMax) ? drMax : undefined,
    brand: sp.brand || undefined,
    hasPhone: sp.hasPhone === "1",
    hasEmail: sp.hasEmail === "1",
    hasWebsite: sp.hasWebsite === "1",
    search: sp.search || undefined,
    sortBy: sp.sortBy || "created_at",
    sortDir: (sp.sortDir as "asc" | "desc") || "desc",
    page,
  });

  const [branches, cities, techStats] = await Promise.all([
    getDistinctBranches(),
    getDistinctCities(),
    getTechStats(),
  ]);
  const techStacks = techStats.map((t) => t.tech_stack);
  const benchmarks: Record<string, BranchBenchmark> = {};
  const benches = await Promise.all(branches.map((b) => getBranchBenchmark(b)));
  branches.forEach((b, i) => {
    const bench = benches[i];
    if (bench) benchmarks[b] = bench;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
        <p className="text-muted-foreground mt-1">
          {total.toLocaleString("sv-SE")} bolag i databasen
        </p>
      </div>

      <LeadsFilters branches={branches} cities={cities} techStacks={techStacks} />

      <LeadsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sortBy={sp.sortBy || "created_at"}
        sortDir={(sp.sortDir as "asc" | "desc") || "desc"}
        benchmarks={benchmarks}
      />
    </div>
  );
}
