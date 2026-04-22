"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BranchBenchmark, Company } from "@/lib/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadDetail } from "./lead-detail";

function priorityVariant(priority: string | null): {
  variant: "default" | "secondary" | "outline" | "destructive";
  className?: string;
} {
  if (!priority) return { variant: "outline" };
  if (priority.includes("A+"))
    return { variant: "default", className: "bg-red-500 hover:bg-red-600 text-white" };
  if (priority.includes("A"))
    return { variant: "default", className: "bg-amber-500 hover:bg-amber-600 text-white" };
  if (priority.includes("B"))
    return { variant: "default", className: "bg-blue-500 hover:bg-blue-600 text-white" };
  return { variant: "secondary" };
}

function ScoreCell({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const color =
    value >= 90 ? "text-green-600" : value >= 50 ? "text-amber-600" : "text-red-600";
  return <span className={cn("font-medium tabular-nums", color)}>{value}</span>;
}

function fmtRevenue(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mkr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} tkr`;
  return String(n);
}

export function LeadsTable({
  rows,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
  benchmarks,
}: {
  rows: Company[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  benchmarks: Record<string, BranchBenchmark>;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Company | null>(null);

  const setSort = (col: string) => {
    const params = new URLSearchParams(sp.toString());
    const nextDir = sortBy === col && sortDir === "desc" ? "asc" : "desc";
    params.set("sortBy", col);
    params.set("sortDir", nextDir);
    params.delete("page");
    router.replace(`/leads?${params.toString()}`);
  };

  const goPage = (p: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    router.replace(`/leads?${params.toString()}`);
  };

  const exportHref = `/api/export?${sp.toString()}`;
  const htmlZipHref = `/api/audit-html-zip?${sp.toString()}`;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const SortHeader = ({ col, label, className }: { col: string; label: string; className?: string }) => (
    <TableHead className={className}>
      <button
        onClick={() => setSort(col)}
        className="flex items-center gap-1 text-xs font-medium hover:text-foreground"
      >
        {label}
        {sortBy === col ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={exportHref} download>
            <Download className="h-3.5 w-3.5" /> CSV ({total.toLocaleString("sv-SE")})
          </a>
        </Button>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href={htmlZipHref} download>
            <Download className="h-3.5 w-3.5" /> Audit-rapporter (ZIP, max 500)
          </a>
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader col="name" label="Företag" />
              <SortHeader col="branch" label="Bransch" />
              <SortHeader col="city" label="Stad" />
              <TableHead>Kontakt</TableHead>
              <SortHeader col="rating" label="Betyg" className="text-right" />
              <SortHeader col="revenue" label="Omsättning" className="text-right" />
              <SortHeader col="performance" label="Perf" className="text-right" />
              <SortHeader col="seo" label="SEO" className="text-right" />
              <SortHeader col="priority" label="Prioritet" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  Inga leads matchar dina filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const prio = priorityVariant(r.priority);
                return (
                  <TableRow
                    key={r.place_id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="font-medium max-w-[240px]">
                      <div className="truncate">{r.name}</div>
                      {r.address && (
                        <div className="truncate text-xs text-muted-foreground">{r.address}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.branch ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.city ?? "—"}</TableCell>
                    <TableCell className="text-xs" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-0.5">
                        {r.phone && <span>{r.phone}</span>}
                        {r.email && (
                          <span className="text-muted-foreground truncate max-w-[200px]" title={r.email}>
                            {r.email}
                          </span>
                        )}
                        {r.website && (
                          <Link
                            href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                            target="_blank"
                            rel="noopener"
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Hemsida
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {r.rating ? (
                        <>
                          {r.rating.toFixed(1)}
                          {r.reviews != null && (
                            <span className="text-muted-foreground"> ({r.reviews})</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {fmtRevenue(r.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={r.performance} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={r.seo} />
                    </TableCell>
                    <TableCell>
                      {r.priority ? (
                        <Badge variant={prio.variant} className={prio.className}>
                          {r.priority}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <div className="text-muted-foreground">
            Visar {from}–{to} av {total.toLocaleString("sv-SE")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goPage(page - 1)}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Föregående
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages}
              className="gap-1"
            >
              Nästa <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <LeadDetail
        lead={selected}
        bench={selected?.branch ? (benchmarks[selected.branch] ?? null) : null}
        open={selected !== null}
        onOpenChange={(v) => !v && setSelected(null)}
      />
    </>
  );
}
