import Link from "next/link";
import { getRuns, getRunStatsByDay } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function formatTs(s: string | null): string {
  if (!s) return "—";
  return s.replace("T", " ").slice(0, 16);
}

function durationSec(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0 || isNaN(ms)) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ rows, total }, dayStats] = await Promise.all([
    getRuns({ limit: PAGE_SIZE, offset }),
    getRunStatsByDay(14),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const maxDayFound = Math.max(1, ...dayStats.map((d) => d.found));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Körningar</h1>
          <p className="text-muted-foreground mt-1">
            {total.toLocaleString("sv-SE")} skrapnings-körningar loggade
          </p>
        </div>
        <AutoRefresh />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Senaste 14 dagar</CardTitle>
          <CardDescription>Antal träffar per dag (mörkare = nya leads)</CardDescription>
        </CardHeader>
        <CardContent>
          {dayStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">Inga körningar de senaste 14 dagarna.</p>
          ) : (
            <div className="space-y-2">
              {dayStats.map((d) => {
                const w = (d.found / maxDayFound) * 100;
                return (
                  <div key={d.day} className="flex items-center gap-3 text-sm">
                    <div className="w-24 text-xs tabular-nums text-muted-foreground">{d.day}</div>
                    <div className="flex-1">
                      <div className="relative h-5 overflow-hidden rounded bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/30"
                          style={{ width: `${w}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-end pr-2 text-xs tabular-nums">
                          {d.found.toLocaleString("sv-SE")} träffar ·{" "}
                          <span className="ml-1 font-medium text-primary">
                            {d.new_count.toLocaleString("sv-SE")} nya
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {d.runs} jobb
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">
                <Clock className="inline h-3 w-3 mr-1" /> Start
              </TableHead>
              <TableHead className="w-[70px] text-right">Tid</TableHead>
              <TableHead>Bransch</TableHead>
              <TableHead>Stad</TableHead>
              <TableHead>Sökfras</TableHead>
              <TableHead className="text-right">Träffar</TableHead>
              <TableHead className="text-right">Nya</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  Inga körningar ännu.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs tabular-nums">{formatTs(r.started_at)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {durationSec(r.started_at, r.finished_at)}
                  </TableCell>
                  <TableCell className="text-xs">{r.branch ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.city ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.query ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.found}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {r.new_count > 0 ? (
                      <span className="text-primary">+{r.new_count}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            Sida {page} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1} className="gap-1">
              <Link href={page <= 1 ? "#" : `/runs?page=${page - 1}`}>
                <ChevronLeft className="h-4 w-4" /> Föregående
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              className="gap-1"
            >
              <Link href={page >= totalPages ? "#" : `/runs?page=${page + 1}`}>
                Nästa <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
