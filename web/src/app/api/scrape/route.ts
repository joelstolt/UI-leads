import type { NextRequest } from "next/server";
import { streamScript } from "@/lib/spawn-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScrapeBody = {
  branches?: string[];
  cities?: string[];
  maxPages?: number;
  maxResults?: number;
  dryRun?: boolean;
  country?: string;
  hl?: string;
  gl?: string;
  brand?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ScrapeBody;
  const args: string[] = [];
  if (body.branches?.length) args.push("--branches", body.branches.join(","));
  if (body.cities?.length) args.push("--cities", body.cities.join(","));
  if (body.maxPages) args.push("--max-pages", String(body.maxPages));
  if (body.maxResults && body.maxResults > 0) args.push("--max-results", String(body.maxResults));
  if (body.dryRun) args.push("--dry-run");
  if (body.country) args.push("--country", body.country);
  if (body.hl) args.push("--hl", body.hl);
  if (body.gl) args.push("--gl", body.gl);
  if (body.brand) args.push("--brand", body.brand);

  return streamScript("scrape.js", args, req);
}
