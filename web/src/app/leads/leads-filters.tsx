"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRANDS } from "@/lib/brands";

const ALL = "__all__";

export function LeadsFilters({
  branches,
  cities,
  techStacks,
}: {
  branches: string[];
  cities: string[];
  techStacks: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(sp.get("search") ?? "");

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === ALL) params.delete(k);
        else params.set(k, v);
      }
      params.delete("page");
      router.replace(`/leads?${params.toString()}`);
    },
    [router, sp]
  );

  useEffect(() => {
    const h = setTimeout(() => {
      if (search !== (sp.get("search") ?? "")) update({ search: search || null });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const branch = sp.get("branch") ?? "";
  const city = sp.get("city") ?? "";
  const priority = sp.get("priority") ?? "";
  const techStack = sp.get("techStack") ?? "";
  const brand = sp.get("brand") ?? "";
  const hasPhone = sp.get("hasPhone") === "1";
  const hasEmail = sp.get("hasEmail") === "1";
  const hasWebsite = sp.get("hasWebsite") === "1";

  const activeCount =
    (branch ? 1 : 0) +
    (city ? 1 : 0) +
    (priority ? 1 : 0) +
    (techStack ? 1 : 0) +
    (brand ? 1 : 0) +
    (hasPhone ? 1 : 0) +
    (hasEmail ? 1 : 0) +
    (hasWebsite ? 1 : 0) +
    (search ? 1 : 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs">Sök</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Företagsnamn, stad, adress…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bransch</Label>
            <Combobox
              value={branch}
              onChange={(v) => update({ branch: v || null })}
              options={branches}
              placeholder="Alla branscher"
              allLabel="Alla branscher"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Stad</Label>
            <Combobox
              value={city}
              onChange={(v) => update({ city: v || null })}
              options={cities}
              placeholder="Alla städer"
              allLabel="Alla städer"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Prioritet</Label>
            <Select value={priority || ALL} onValueChange={(v) => update({ priority: v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="Alla" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla</SelectItem>
                <SelectItem value="A+">A+</SelectItem>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={hasPhone}
              onCheckedChange={(v) => update({ hasPhone: v === true ? "1" : null })}
            />
            Har telefon
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={hasEmail}
              onCheckedChange={(v) => update({ hasEmail: v === true ? "1" : null })}
            />
            Har e-post
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={hasWebsite}
              onCheckedChange={(v) => update({ hasWebsite: v === true ? "1" : null })}
            />
            Har hemsida
          </label>

          {techStacks.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs">Plattform</Label>
              <Select
                value={techStack || ALL}
                onValueChange={(v) => update({ techStack: v === ALL ? null : v })}
              >
                <SelectTrigger className="h-8 w-[160px]">
                  <SelectValue placeholder="Alla" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alla plattformar</SelectItem>
                  {techStacks.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "error" ? "🔴 Sajt nere" : t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label className="text-xs">Brand</Label>
            <Select value={brand || ALL} onValueChange={(v) => update({ brand: v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="Alla" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla brands</SelectItem>
                {Object.values(BRANDS).map((b) => (
                  <SelectItem key={b.key} value={b.key}>
                    {b.name} ({b.domain})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() => {
                setSearch("");
                router.push("/leads");
              }}
            >
              <X className="h-3 w-3" /> Rensa filter ({activeCount})
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
