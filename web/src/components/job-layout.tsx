"use client";

import { useJobStream, type LogLine } from "@/lib/use-job-stream";
import { LiveLog } from "@/components/live-log";

export type Job = {
  start: (body: unknown) => void;
  stop: () => void;
  clear: () => void;
  running: boolean;
  logs: LogLine[];
};

type Props = {
  endpoint: string;
  emptyHint?: string;
  logTitle?: string;
  children: (job: Job) => React.ReactNode;
};

export function JobLayout({ endpoint, emptyHint, logTitle, children }: Props) {
  const job = useJobStream(endpoint);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-6">{children(job)}</div>
      <LiveLog
        logs={job.logs}
        running={job.running}
        onClear={job.clear}
        emptyHint={emptyHint}
        title={logTitle}
      />
    </div>
  );
}
