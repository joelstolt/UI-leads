"use client";

import { useEffect, useState } from "react";
import { BRANDS, DEFAULT_BRAND, type BrandKey } from "@/lib/brands";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const STORAGE_KEY = "leadsgoogle:default-brand";

type Props = {
  value: BrandKey;
  onChange: (v: BrandKey) => void;
  /** Visar inte hela kortet — bara raden. För inline-bruk. */
  compact?: boolean;
};

/**
 * Brand-väljare med localStorage-persistence.
 * Använd via `useDefaultBrand()` om du vill ha samma värde i flera komponenter.
 */
export function BrandPicker({ value, onChange, compact }: Props) {
  const handleChange = (next: BrandKey) => {
    onChange(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  };

  const inner = (
    <div className="flex flex-wrap gap-2">
      {Object.values(BRANDS).map((b) => {
        const on = value === b.key;
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => handleChange(b.key)}
            className={
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors " +
              (on
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-accent hover:text-accent-foreground")
            }
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: b.accent }}
            />
            <span className="font-medium">{b.name}</span>
            <span className="text-xs text-muted-foreground">{b.domain}</span>
          </button>
        );
      })}
    </div>
  );

  if (compact) return inner;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tilldela brand</CardTitle>
        <CardDescription>
          Alla nya leads från detta jobb taggas med valt brand. Ändras kan per-lead i
          Sheet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label className="text-xs mb-2 block">Default för nya leads</Label>
        {inner}
      </CardContent>
    </Card>
  );
}

export function useDefaultBrand(): [BrandKey, (v: BrandKey) => void] {
  const [brand, setBrand] = useState<BrandKey>(DEFAULT_BRAND);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in BRANDS) setBrand(stored as BrandKey);
  }, []);

  const setAndPersist = (next: BrandKey) => {
    setBrand(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  };

  return [brand, setAndPersist];
}
