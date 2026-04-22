import { getStats } from "@/lib/db";
import { EnrichForm } from "./enrich-form";

export const dynamic = "force-dynamic";

export default async function EnrichPage() {
  const stats = await getStats();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Berika leads</h1>
        <p className="text-muted-foreground mt-1">
          E-post, PageSpeed och bolagsinfo (allabolag.se) för redan skrapade bolag.
        </p>
      </div>
      <EnrichForm stats={stats} />
    </div>
  );
}
