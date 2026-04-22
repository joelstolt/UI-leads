import type { NextRequest } from "next/server";
import { streamScript } from "@/lib/spawn-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  branch?: string;
  city?: string;
  maxPages?: number;
  dryRun?: boolean;
  brand?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const args: string[] = [];
  if (body.branch) args.push("--branch", body.branch);
  if (body.city) args.push("--city", body.city);
  if (body.maxPages && body.maxPages > 0) args.push("--max-pages", String(body.maxPages));
  if (body.dryRun) args.push("--dry-run");
  if (body.brand) args.push("--brand", body.brand);
  return streamScript("discover-allabolag.js", args, req);
}
