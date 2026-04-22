import { getStats, getDistinctBranches } from "@/lib/db";
import { SyncForm } from "./sync-form";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  const [stats, branches] = await Promise.all([getStats(), getDistinctBranches()]);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">CRM-sync</h1>
        <p className="text-muted-foreground mt-1">
          Skicka leads till CRM-webhook. Endast bolag med telefon synkas. CRM-dedup på orgnummer + e-post.
        </p>
      </div>
      <SyncForm stats={stats} branches={branches} />
    </div>
  );
}
