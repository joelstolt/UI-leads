"use client";

import { useCallback, useRef, useState } from "react";

export type LogLine = { kind: "start" | "stdout" | "stderr" | "error" | "exit"; text: string };

export function useJobStream(endpoint: string) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (body: unknown) => {
      if (abortRef.current) return;
      setLogs([]);
      setRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let delim: number;
          while ((delim = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, delim);
            buffer = buffer.slice(delim + 2);
            const eventMatch = frame.match(/^event:\s*(.+)$/m);
            const dataMatch = frame.match(/^data:\s*(.+)$/m);
            if (!eventMatch || !dataMatch) continue;
            const kind = eventMatch[1] as LogLine["kind"];
            const text = JSON.parse(dataMatch[1]) as string;
            setLogs((prev) => [...prev, { kind, text }]);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setLogs((prev) => [...prev, { kind: "error", text: (err as Error).message }]);
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [endpoint]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  return { logs, running, start, stop, clear };
}
