import { createClient, type Client, type InValue } from "@libsql/client";
import path from "node:path";
import "server-only";

/**
 * Stödjer både:
 * - Lokal SQLite-fil (file:./leads.db) i dev
 * - Remote Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) i prod
 *
 * Vercel-deploys måste ha env-vars satta — annars fail-out.
 */

let _client: Client | null = null;

export function getClient(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (url) {
    _client = createClient({ url, authToken });
  } else {
    // Lokal fallback (samma fil som CLI-scripten)
    const local = path.resolve(process.cwd(), "..", "leads.db");
    _client = createClient({ url: `file:${local}` });
  }
  return _client;
}

export type Company = {
  place_id: string;
  name: string;
  branch: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  rating: number | null;
  reviews: number | null;
  status: string | null;
  email: string | null;
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  mobile_friendly: string | null;
  load_time: string | null;
  priority: string | null;
  org_nr: string | null;
  firmatecknare: string | null;
  revenue: number | null;
  employees: number | null;
  sni_code: string | null;
  usp_1: string | null;
  usp_2: string | null;
  usp_3: string | null;
  scraped_at: string | null;
  email_scraped_at: string | null;
  pagespeed_at: string | null;
  corp_enriched_at: string | null;
  usp_extracted_at: string | null;
  crm_synced_at: string | null;
  outreach_email_subject: string | null;
  outreach_email_body: string | null;
  outreach_linkedin: string | null;
  outreach_phone: string | null;
  outreach_generated_at: string | null;
  meta_ads_active: number | null;
  meta_ads_count: number | null;
  meta_ads_checked_at: string | null;
  tech_stack: string | null;
  tech_https: number | null;
  tech_has_schema: number | null;
  tech_has_viewport: number | null;
  tech_checked_at: string | null;
  sitemap_url: string | null;
  sitemap_url_count: number | null;
  robots_has_sitemap: number | null;
  robots_disallows_root: number | null;
  sitemap_checked_at: string | null;
  domain_rank: number | null;
  domain_rank_int: number | null;
  domain_rank_at: string | null;
  brand: string | null;
  created_at: string;
  updated_at: string;
};

export type Stats = {
  total: number;
  withPhone: number;
  withWebsite: number;
  withEmail: number;
  withPagespeed: number;
  withCorp: number;
  withCrmSynced: number;
  withOutreach: number;
  withMetaAds: number;
  withTech: number;
  withSitemap: number;
  withDomainRank: number;
  hotLeads: number;
  aLeads: number;
};

// ── Helpers ───────────────────────────────────────────────────

const _colCache = new Map<string, Set<string>>();

async function colsOf(table: string): Promise<Set<string>> {
  if (_colCache.has(table)) return _colCache.get(table)!;
  const r = await getClient().execute(`PRAGMA table_info(${table})`);
  const cols = new Set(r.rows.map((row) => String(row.name)));
  _colCache.set(table, cols);
  return cols;
}

async function colExists(table: string, col: string): Promise<boolean> {
  return (await colsOf(table)).has(col);
}

async function n(sql: string, args: InValue[] = []): Promise<number> {
  const r = await getClient().execute({ sql, args });
  return Number(r.rows[0]?.n ?? 0);
}

// ── Stats ─────────────────────────────────────────────────────

export async function getStats(): Promise<Stats> {
  const db = getClient();
  const q = async (sql: string) =>
    Number((await db.execute(sql)).rows[0]?.n ?? 0);

  const safe = async (col: string, sql: string) =>
    (await colExists("companies", col)) ? q(sql) : 0;

  const [
    total,
    withPhone,
    withWebsite,
    withEmail,
    withPagespeed,
    withCorp,
    withCrmSynced,
    withOutreach,
    withMetaAds,
    withTech,
    withSitemap,
    withDomainRank,
    hotLeads,
    aLeads,
  ] = await Promise.all([
    q("SELECT COUNT(*) as n FROM companies"),
    q("SELECT COUNT(*) as n FROM companies WHERE phone IS NOT NULL AND phone != ''"),
    q("SELECT COUNT(*) as n FROM companies WHERE website IS NOT NULL AND website != ''"),
    q("SELECT COUNT(*) as n FROM companies WHERE email IS NOT NULL AND email != ''"),
    q("SELECT COUNT(*) as n FROM companies WHERE pagespeed_at IS NOT NULL"),
    q("SELECT COUNT(*) as n FROM companies WHERE corp_enriched_at IS NOT NULL"),
    q("SELECT COUNT(*) as n FROM companies WHERE crm_synced_at IS NOT NULL"),
    safe("outreach_generated_at", "SELECT COUNT(*) as n FROM companies WHERE outreach_generated_at IS NOT NULL"),
    safe("meta_ads_checked_at", "SELECT COUNT(*) as n FROM companies WHERE meta_ads_checked_at IS NOT NULL"),
    safe("tech_checked_at", "SELECT COUNT(*) as n FROM companies WHERE tech_checked_at IS NOT NULL"),
    safe("sitemap_checked_at", "SELECT COUNT(*) as n FROM companies WHERE sitemap_checked_at IS NOT NULL"),
    safe("domain_rank_at", "SELECT COUNT(*) as n FROM companies WHERE domain_rank_at IS NOT NULL"),
    q("SELECT COUNT(*) as n FROM companies WHERE priority LIKE '%A+%'"),
    q("SELECT COUNT(*) as n FROM companies WHERE priority LIKE '%A%' AND priority NOT LIKE '%A+%'"),
  ]);

  return {
    total, withPhone, withWebsite, withEmail, withPagespeed, withCorp, withCrmSynced,
    withOutreach, withMetaAds, withTech, withSitemap, withDomainRank, hotLeads, aLeads,
  };
}

// ── Branch + city + tech stats ────────────────────────────────

export async function getBranchStats() {
  const r = await getClient().execute(
    `SELECT branch, COUNT(*) as count FROM companies
     WHERE branch IS NOT NULL GROUP BY branch ORDER BY count DESC`
  );
  return r.rows.map((row) => ({
    branch: String(row.branch),
    count: Number(row.count),
  }));
}

export type SitemapBucket = { key: string; label: string; min: number; max: number | null; count: number };

export async function getSitemapBuckets(): Promise<SitemapBucket[]> {
  if (!(await colExists("companies", "sitemap_url_count"))) return [];
  const buckets: Omit<SitemapBucket, "count">[] = [
    { key: "0", label: "0 sidor", min: 0, max: 0 },
    { key: "1-9", label: "1–9 sidor", min: 1, max: 9 },
    { key: "10-49", label: "10–49 sidor", min: 10, max: 49 },
    { key: "50-99", label: "50–99 sidor", min: 50, max: 99 },
    { key: "100+", label: "100+ sidor", min: 100, max: null },
  ];
  return Promise.all(
    buckets.map(async (b) => ({
      ...b,
      count: await n(
        b.max == null
          ? "SELECT COUNT(*) as n FROM companies WHERE sitemap_checked_at IS NOT NULL AND sitemap_url_count >= ?"
          : "SELECT COUNT(*) as n FROM companies WHERE sitemap_checked_at IS NOT NULL AND sitemap_url_count >= ? AND sitemap_url_count <= ?",
        b.max == null ? [b.min] : [b.min, b.max]
      ),
    }))
  );
}

export type DomainRankBucket = { key: string; label: string; min: number; max: number | null; count: number };

export async function getDomainRankBuckets(): Promise<DomainRankBucket[]> {
  if (!(await colExists("companies", "domain_rank"))) return [];
  const buckets: Omit<DomainRankBucket, "count">[] = [
    { key: "0", label: "DR 0", min: 0, max: 0.99 },
    { key: "1-2", label: "DR 1–2", min: 1, max: 2.99 },
    { key: "3-4", label: "DR 3–4", min: 3, max: 4.99 },
    { key: "5+", label: "DR 5+", min: 5, max: null },
  ];
  return Promise.all(
    buckets.map(async (b) => ({
      ...b,
      count: await n(
        b.max == null
          ? "SELECT COUNT(*) as n FROM companies WHERE domain_rank_at IS NOT NULL AND domain_rank >= ?"
          : "SELECT COUNT(*) as n FROM companies WHERE domain_rank_at IS NOT NULL AND domain_rank >= ? AND domain_rank <= ?",
        b.max == null ? [b.min] : [b.min, b.max]
      ),
    }))
  );
}

export type TechStat = { tech_stack: string; count: number };

export async function getTechStats(): Promise<TechStat[]> {
  if (!(await colExists("companies", "tech_stack"))) return [];
  const r = await getClient().execute(
    `SELECT tech_stack, COUNT(*) as count FROM companies
     WHERE tech_stack IS NOT NULL GROUP BY tech_stack ORDER BY count DESC`
  );
  return r.rows.map((row) => ({
    tech_stack: String(row.tech_stack),
    count: Number(row.count),
  }));
}

export type BrandStat = { brand: string; count: number };

export async function getBrandStats(): Promise<BrandStat[]> {
  if (!(await colExists("companies", "brand"))) return [];
  const r = await getClient().execute(
    `SELECT COALESCE(brand, '__none__') as brand, COUNT(*) as count FROM companies
     GROUP BY brand ORDER BY count DESC`
  );
  return r.rows.map((row) => ({
    brand: String(row.brand),
    count: Number(row.count),
  }));
}

export async function setLeadBrand(placeId: string, brand: string | null): Promise<void> {
  if (!(await colExists("companies", "brand"))) {
    await getClient().execute("ALTER TABLE companies ADD COLUMN brand TEXT");
    _colCache.delete("companies");
  }
  await getClient().execute({
    sql: "UPDATE companies SET brand = ?, updated_at = datetime('now') WHERE place_id = ?",
    args: [brand, placeId],
  });
}

// ── Filters + queries ─────────────────────────────────────────

export type LeadFilters = {
  branch?: string;
  city?: string;
  priority?: string;
  techStack?: string;
  sitemapMin?: number;
  sitemapMax?: number;
  domainRankMin?: number;
  domainRankMax?: number;
  brand?: string;
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasWebsite?: boolean;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORTABLE = new Set([
  "name", "branch", "city", "rating", "reviews",
  "performance", "seo", "priority", "revenue",
  "created_at", "updated_at",
]);

async function buildWhere(filters: LeadFilters): Promise<{ sql: string; params: InValue[] }> {
  const where: string[] = [];
  const params: InValue[] = [];
  if (filters.branch) { where.push("branch = ?"); params.push(filters.branch); }
  if (filters.city) { where.push("city = ?"); params.push(filters.city); }
  if (filters.priority) { where.push("priority LIKE ?"); params.push(`%${filters.priority}%`); }
  if (filters.techStack && (await colExists("companies", "tech_stack"))) {
    where.push("tech_stack = ?"); params.push(filters.techStack);
  }
  if (filters.sitemapMin !== undefined && (await colExists("companies", "sitemap_url_count"))) {
    where.push("sitemap_checked_at IS NOT NULL AND sitemap_url_count >= ?");
    params.push(filters.sitemapMin);
  }
  if (filters.sitemapMax !== undefined && (await colExists("companies", "sitemap_url_count"))) {
    where.push("sitemap_checked_at IS NOT NULL AND sitemap_url_count <= ?");
    params.push(filters.sitemapMax);
  }
  if (filters.domainRankMin !== undefined && (await colExists("companies", "domain_rank"))) {
    where.push("domain_rank_at IS NOT NULL AND domain_rank >= ?");
    params.push(filters.domainRankMin);
  }
  if (filters.domainRankMax !== undefined && (await colExists("companies", "domain_rank"))) {
    where.push("domain_rank_at IS NOT NULL AND domain_rank <= ?");
    params.push(filters.domainRankMax);
  }
  if (filters.brand && (await colExists("companies", "brand"))) {
    where.push("brand = ?"); params.push(filters.brand);
  }
  if (filters.hasPhone) where.push("phone IS NOT NULL AND phone != ''");
  if (filters.hasEmail) where.push("email IS NOT NULL AND email != ''");
  if (filters.hasWebsite) where.push("website IS NOT NULL AND website != ''");
  if (filters.search) {
    where.push("(name LIKE ? OR city LIKE ? OR address LIKE ?)");
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export async function getLeads(filters: LeadFilters = {}) {
  const db = getClient();
  const { sql: whereSql, params } = await buildWhere(filters);

  const sortBy = SORTABLE.has(filters.sortBy ?? "") ? filters.sortBy : "created_at";
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const [totalRes, rowsRes] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) as n FROM companies ${whereSql}`, args: params }),
    db.execute({
      sql: `SELECT * FROM companies ${whereSql}
            ORDER BY ${sortBy} ${sortDir} NULLS LAST
            LIMIT ? OFFSET ?`,
      args: [...params, pageSize, offset],
    }),
  ]);

  return {
    rows: rowsRes.rows.map((r) => ({ ...r })) as unknown as Company[],
    total: Number(totalRes.rows[0]?.n ?? 0),
    page,
    pageSize,
  };
}

export async function getLeadById(placeId: string): Promise<Company | null> {
  const r = await getClient().execute({
    sql: "SELECT * FROM companies WHERE place_id = ?",
    args: [placeId],
  });
  const row = r.rows[0];
  return row ? ({ ...row } as unknown as Company) : null;
}

export async function getLeadsForExport(filters: LeadFilters = {}): Promise<Company[]> {
  const { sql: whereSql, params } = await buildWhere(filters);
  const r = await getClient().execute({
    sql: `SELECT * FROM companies ${whereSql}
          ORDER BY
            CASE priority
              WHEN '🔥 A+' THEN 1
              WHEN '🟡 A'  THEN 2
              WHEN '🔵 B'  THEN 3
              WHEN '⚪ C'  THEN 4
              ELSE 5
            END,
            rating DESC NULLS LAST`,
    args: params,
  });
  return r.rows.map((row) => ({ ...row })) as unknown as Company[];
}

export async function getDistinctBranches(): Promise<string[]> {
  const r = await getClient().execute(
    "SELECT DISTINCT branch FROM companies WHERE branch IS NOT NULL ORDER BY branch"
  );
  return r.rows.map((row) => String(row.branch));
}

export async function getDistinctCities(): Promise<string[]> {
  const r = await getClient().execute(
    "SELECT DISTINCT city FROM companies WHERE city IS NOT NULL ORDER BY city"
  );
  return r.rows.map((row) => String(row.city));
}

// ── Branch benchmarks ─────────────────────────────────────────

export type BranchBenchmark = {
  branch: string;
  count: number;
  avgPerformance: number | null;
  avgSeo: number | null;
  avgAccessibility: number | null;
  avgRating: number | null;
  avgReviews: number | null;
  avgRevenue: number | null;
  avgEmployees: number | null;
  avgSitemapUrls: number | null;
  avgDomainRank: number | null;
};

export async function getBranchBenchmark(branch: string): Promise<BranchBenchmark | null> {
  if (!branch) return null;
  const sitemapAvg = (await colExists("companies", "sitemap_url_count"))
    ? "AVG(NULLIF(sitemap_url_count, 0)) as avgSitemapUrls,"
    : "NULL as avgSitemapUrls,";
  const drAvg = (await colExists("companies", "domain_rank"))
    ? "AVG(NULLIF(domain_rank, 0)) as avgDomainRank,"
    : "NULL as avgDomainRank,";

  const r = await getClient().execute({
    sql: `SELECT
            COUNT(*)                           as count,
            AVG(NULLIF(performance, 0))        as avgPerformance,
            AVG(NULLIF(seo, 0))                as avgSeo,
            AVG(NULLIF(accessibility, 0))      as avgAccessibility,
            AVG(rating)                        as avgRating,
            AVG(reviews)                       as avgReviews,
            AVG(NULLIF(revenue, 0))            as avgRevenue,
            AVG(NULLIF(employees, 0))          as avgEmployees,
            ${sitemapAvg}
            ${drAvg}
            ? as branch
          FROM companies WHERE branch = ?`,
    args: [branch, branch],
  });

  const row = r.rows[0];
  if (!row || Number(row.count) === 0) return null;

  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    branch,
    count: Number(row.count),
    avgPerformance: num(row.avgPerformance),
    avgSeo: num(row.avgSeo),
    avgAccessibility: num(row.avgAccessibility),
    avgRating: num(row.avgRating),
    avgReviews: num(row.avgReviews),
    avgRevenue: num(row.avgRevenue),
    avgEmployees: num(row.avgEmployees),
    avgSitemapUrls: num(row.avgSitemapUrls),
    avgDomainRank: num(row.avgDomainRank),
  };
}

// ── Runs ──────────────────────────────────────────────────────

export type Run = {
  id: number;
  started_at: string;
  finished_at: string | null;
  branch: string | null;
  city: string | null;
  query: string | null;
  found: number;
  new_count: number;
};

export async function getRuns({
  limit = 100,
  offset = 0,
}: { limit?: number; offset?: number } = {}): Promise<{ rows: Run[]; total: number }> {
  const db = getClient();
  const [totalRes, rowsRes] = await Promise.all([
    db.execute("SELECT COUNT(*) as n FROM runs"),
    db.execute({
      sql: `SELECT id, started_at, finished_at, branch, city, query, found, new_count
            FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      args: [limit, offset],
    }),
  ]);
  return {
    rows: rowsRes.rows as unknown as Run[],
    total: Number(totalRes.rows[0]?.n ?? 0),
  };
}

export type RunDayStat = { day: string; runs: number; found: number; new_count: number };

export async function getRunStatsByDay(days = 14): Promise<RunDayStat[]> {
  const r = await getClient().execute({
    sql: `SELECT date(started_at) as day,
                 COUNT(*) as runs,
                 COALESCE(SUM(found), 0) as found,
                 COALESCE(SUM(new_count), 0) as new_count
          FROM runs
          WHERE started_at >= date('now', ?)
          GROUP BY day ORDER BY day DESC`,
    args: [`-${days} days`],
  });
  return r.rows.map((row) => ({
    day: String(row.day),
    runs: Number(row.runs),
    found: Number(row.found),
    new_count: Number(row.new_count),
  }));
}
