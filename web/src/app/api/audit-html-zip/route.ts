import { NextRequest } from "next/server";
import JSZip from "jszip";
import { getLeadsForExport, getBranchBenchmark, type BranchBenchmark } from "@/lib/db";
import { getBrand } from "@/lib/brands";
import { renderAuditHtml } from "@/app/audit/audit-html";
import { slugify } from "@/app/audit/audit-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Säkerhets-cap så vi inte exporterar 10 000 filer av misstag
  const cap = Math.min(rows.length, 500);
  const limited = rows.slice(0, cap);

  const zip = new JSZip();
  const benchCache = new Map<string, BranchBenchmark | null>();
  const usedNames = new Set<string>();

  for (const lead of limited) {
    let bench: BranchBenchmark | null = null;
    if (lead.branch) {
      if (!benchCache.has(lead.branch)) {
        benchCache.set(lead.branch, await getBranchBenchmark(lead.branch));
      }
      bench = benchCache.get(lead.branch) ?? null;
    }
    const brand = getBrand(lead.brand);
    const html = renderAuditHtml(lead, bench, brand);
    let filename = `${slugify(lead.name)}.html`;
    let n = 1;
    while (usedNames.has(filename)) {
      filename = `${slugify(lead.name)}-${++n}.html`;
    }
    usedNames.add(filename);
    zip.file(filename, html);
  }

  const buf = await zip.generateAsync({ type: "arraybuffer" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="audit-rapporter-${stamp}.zip"`,
      "cache-control": "no-store",
    },
  });
}
