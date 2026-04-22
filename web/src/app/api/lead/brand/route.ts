import { NextRequest, NextResponse } from "next/server";
import { setLeadBrand } from "@/lib/db";
import { BRANDS } from "@/lib/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { placeId, brand } = (await req.json()) as { placeId: string; brand: string | null };
  if (!placeId) return NextResponse.json({ error: "missing placeId" }, { status: 400 });
  if (brand && !(brand in BRANDS))
    return NextResponse.json({ error: `unknown brand: ${brand}` }, { status: 400 });
  await setLeadBrand(placeId, brand);
  return NextResponse.json({ ok: true });
}
