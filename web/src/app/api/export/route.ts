import type { NextRequest } from "next/server";
import { getLeadsForExport, type Company } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "Bransch", "Stad", "Företag", "Telefon", "Hemsida", "E-post",
  "Adress", "Betyg", "Recensioner", "Status",
  "Performance", "SEO", "Accessibility", "Mobilvänlig", "Laddtid", "Prioritet",
  "Org.nr", "Firmatecknare", "Omsättning (kr)", "Anställda", "SNI-kod",
  "USP 1", "USP 2", "USP 3",
  "Scrapad", "PageSpeed-analys", "Corp-enrichad", "USP-extraherad",
];

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatFirmatecknare(jsonStr: string | null): string {
  if (!jsonStr) return "";
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr.join("; ") : String(arr);
  } catch {
    return jsonStr;
  }
}

function rowToCsv(r: Company): string {
  return [
    r.branch, r.city, r.name, r.phone, r.website, r.email,
    r.address, r.rating, r.reviews, r.status,
    r.performance, r.seo, r.accessibility, r.mobile_friendly, r.load_time, r.priority,
    r.org_nr, formatFirmatecknare(r.firmatecknare), r.revenue, r.employees, r.sni_code,
    r.usp_1, r.usp_2, r.usp_3,
    r.scraped_at?.slice(0, 10) ?? "",
    r.pagespeed_at?.slice(0, 10) ?? "",
    r.corp_enriched_at?.slice(0, 10) ?? "",
    r.usp_extracted_at?.slice(0, 10) ?? "",
  ].map(escapeCSV).join(",");
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const minStr = sp.get("sitemapMin");
  const maxStr = sp.get("sitemapMax");
  const sitemapMin = minStr != null && minStr !== "" ? Number(minStr) : undefined;
  const sitemapMax = maxStr != null && maxStr !== "" ? Number(maxStr) : undefined;
  const drMinStr = sp.get("domainRankMin");
  const drMaxStr = sp.get("domainRankMax");
  const drMin = drMinStr != null && drMinStr !== "" ? Number(drMinStr) : undefined;
  const drMax = drMaxStr != null && drMaxStr !== "" ? Number(drMaxStr) : undefined;

  const rows = await getLeadsForExport({
    branch: sp.get("branch") || undefined,
    city: sp.get("city") || undefined,
    priority: sp.get("priority") || undefined,
    techStack: sp.get("techStack") || undefined,
    sitemapMin: Number.isFinite(sitemapMin) ? sitemapMin : undefined,
    sitemapMax: Number.isFinite(sitemapMax) ? sitemapMax : undefined,
    domainRankMin: Number.isFinite(drMin) ? drMin : undefined,
    domainRankMax: Number.isFinite(drMax) ? drMax : undefined,
    brand: sp.get("brand") || undefined,
    hasPhone: sp.get("hasPhone") === "1",
    hasEmail: sp.get("hasEmail") === "1",
    hasWebsite: sp.get("hasWebsite") === "1",
    search: sp.get("search") || undefined,
  });

  const lines = [HEADERS.join(",")];
  for (const r of rows) lines.push(rowToCsv(r));
  const csv = "\uFEFF" + lines.join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `leads-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
