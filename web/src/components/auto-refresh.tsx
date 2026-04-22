"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function AutoRefresh({
  intervalMs = 15000,
  label = "Auto-uppdatera",
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
      setLastRefresh(Date.now());
      setTick((t) => t + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, router]);

  // Refresh "x sek sedan"-text every second
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const sinceSec = Math.floor((Date.now() - lastRefresh) / 1000);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setEnabled((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors hover:bg-accent",
          enabled && "text-primary"
        )}
        title={enabled ? "Pausa auto-uppdatering" : "Återuppta auto-uppdatering"}
      >
        {enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        {label}
      </button>
      <span className="tabular-nums">
        {enabled ? `${sinceSec}s sedan · var ${intervalMs / 1000}s` : "pausad"}
      </span>
      <RefreshCw
        className={cn(
          "h-3 w-3 transition-opacity",
          enabled && tick % 2 === 0 ? "opacity-100" : "opacity-30"
        )}
      />
    </div>
  );
}
