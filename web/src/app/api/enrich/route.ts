import type { NextRequest } from "next/server";
import { streamScript } from "@/lib/spawn-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnrichBody = {
  kind:
    | "email"
    | "pagespeed"
    | "both"
    | "corp"
    | "outreach"
    | "meta-ads"
    | "tech"
    | "sitemap"
    | "domainrank";
  limit?: number;
  dryRun?: boolean;
  branches?: string[];
  cities?: string[];
  priorities?: string[];
  branch?: string;
  regenerate?: boolean;
  auditBase?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as EnrichBody;
  const args: string[] = [];

  if (body.kind === "corp") {
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.dryRun) args.push("--dry-run");
    if (body.branches?.length) args.push("--branches", body.branches.join(","));
    if (body.cities?.length) args.push("--cities", body.cities.join(","));
    return streamScript("enrich-corp.js", args, req);
  }

  if (body.kind === "outreach") {
    if (body.priorities?.length) args.push("--priority", body.priorities.join(","));
    if (body.branch) args.push("--branch", body.branch);
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.regenerate) args.push("--regenerate");
    const base = body.auditBase || new URL(req.url).origin;
    args.push("--audit-base", base);
    return streamScript("outreach-gen.js", args, req);
  }

  if (body.kind === "meta-ads") {
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.branch) args.push("--branch", body.branch);
    return streamScript("enrich-ads.js", args, req);
  }

  if (body.kind === "tech") {
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.branch) args.push("--branch", body.branch);
    return streamScript("enrich-tech.js", args, req);
  }

  if (body.kind === "sitemap") {
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.branch) args.push("--branch", body.branch);
    return streamScript("enrich-sitemap.js", args, req);
  }

  if (body.kind === "domainrank") {
    if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
    if (body.branch) args.push("--branch", body.branch);
    return streamScript("enrich-domainrank.js", args, req);
  }

  if (body.kind === "email") args.push("--email-only");
  if (body.kind === "pagespeed") args.push("--pagespeed-only");
  if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
  return streamScript("enrich.js", args, req);
}
