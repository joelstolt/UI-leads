"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown } from "lucide-react";
import type { LogLine } from "@/lib/use-job-stream";

type Props = {
  logs: LogLine[];
  running: boolean;
  onClear: () => void;
  emptyHint?: string;
  title?: string;
  height?: string;
};

export function LiveLog({
  logs,
  running,
  onClear,
  emptyHint = 'Klicka på "Starta" för att börja',
  title = "Live output",
  height = "h-[520px]",
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <Card className="lg:sticky lg:top-6 h-fit">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {running ? (
                <span className="flex items-center gap-2 text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" /> Kör…
                </span>
              ) : logs.length === 0 ? (
                "Inget jobb kör just nu"
              ) : (
                "Klart"
              )}
            </CardDescription>
          </div>
          {logs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={running}>
              Rensa
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={ref}
          className={`font-mono text-xs bg-zinc-950 text-zinc-100 rounded-md p-3 overflow-y-auto ${height}`}
        >
          {logs.length === 0 ? (
            <div className="text-zinc-500">
              <ChevronDown className="inline h-3 w-3" /> {emptyHint}
            </div>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.kind === "stderr" || l.kind === "error"
                    ? "text-red-400"
                    : l.kind === "start"
                      ? "text-cyan-400"
                      : l.kind === "exit"
                        ? "text-amber-400"
                        : "text-zinc-100"
                }
              >
                {l.kind === "start" && <span className="text-zinc-500">$ </span>}
                {l.kind === "exit" && <span className="text-zinc-500">Exit code: </span>}
                {l.text.replace(/\n+$/, "")}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
