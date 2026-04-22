import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lead Scraper",
  description: "Svenska hantverkare & servicebolag — leads & scraping",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Sidebar />
        <MobileNav />
        <main className="md:pl-60">
          <div className="mx-auto max-w-7xl p-4 md:p-10">{children}</div>
        </main>
      </body>
    </html>
  );
}
