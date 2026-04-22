import { NextRequest, NextResponse } from "next/server";
import { getLeadById, getBranchBenchmark } from "@/lib/db";
import { getBrand } from "@/lib/brands";
import { renderAuditHtml } from "@/app/audit/audit-html";
import { slugify } from "@/app/audit/audit-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ placeId: string }> }
) {
  const { placeId } = await params;
  const lead = await getLeadById(decodeURIComponent(placeId));
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  const bench = lead.branch ? await getBranchBenchmark(lead.branch) : null;
  const brand = getBrand(lead.brand);
  const html = renderAuditHtml(lead, bench, brand);

  const filename = `${slugify(lead.name)}.html`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
