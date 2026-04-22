import type { NextRequest } from "next/server";
import { streamScript } from "@/lib/spawn-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncBody = {
  projectId?: string;
  limit?: number;
  priorities?: string[];
  branch?: string;
  dryRun?: boolean;
  reset?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SyncBody;
  const args: string[] = [];
  if (body.projectId) args.push("--project-id", body.projectId);
  if (body.limit && body.limit > 0) args.push("--limit", String(body.limit));
  if (body.priorities?.length) args.push("--priority", body.priorities.join(","));
  if (body.branch) args.push("--branch", body.branch);
  if (body.dryRun) args.push("--dry-run");
  if (body.reset) args.push("--reset");
  return streamScript("crm-sync.js", args, req);
}
