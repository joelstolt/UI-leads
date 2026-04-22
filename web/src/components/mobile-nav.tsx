"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Rocket,
  Sparkles,
  Table2,
  Wand2,
  Webhook,
  History,
  Menu,
  Compass,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Table2 },
  { href: "/discover", label: "Discover (gratis)", icon: Compass },
  { href: "/scrape", label: "Skrapa (SerpAPI)", icon: Rocket },
  { href: "/enrich", label: "Berika", icon: Wand2 },
  { href: "/sync", label: "CRM-sync", icon: Webhook },
  { href: "/runs", label: "Körningar", icon: History },
];

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const active = nav.find(
    (n) => pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href))
  );

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-card px-4 md:hidden">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Lead Scraper</span>
        {active && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm">{active.label}</span>
          </>
        )}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Öppna meny">
          <Menu className="h-5 w-5" />
        </Button>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Lead Scraper
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col space-y-1 p-3">
            {nav.map(({ href, label, icon: Icon }) => {
              const isActive =
                pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
