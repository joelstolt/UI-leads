/**
 * Brand-config — central plats att lägga till/ändra varumärken.
 *
 * Varje lead har en `brand` (kolumn i companies). Audit-sidan, outreach-mejl
 * och CSV-export använder brand:ets info för att rendera rätt logo, färger,
 * mejl, telefon och språk.
 *
 * Auto-tilldelning sker via `countries`-listan (vid discover/scrape).
 * Manuell override via dropdown i lead-Sheet.
 *
 * För Vercel multi-domain: middleware mappar request.host → brand.key så att
 * audit-länkar alltid landar på rätt domän oavsett vilket brand leaden har.
 */

export type BrandKey = "wlm-se" | "wlm-ie" | "flodo";

export type Brand = {
  key: BrandKey;
  name: string;
  domain: string;          // för audit-URL i outreach-mejl
  email: string;
  phone: string;
  website: string;
  tagline: string;
  language: "sv" | "en";
  // Hex-färger används som CSS-variabler i audit.css overrides
  accent: string;
  accentSoft: string;
  accentAmber: string;
  // Auto-tilldelning: leads från dessa countries → detta brand
  countries: string[];
  // Vad outreach-prompt:n säger om vad ni "gör"
  pitch: string;
};

export const BRANDS: Record<BrandKey, Brand> = {
  "wlm-se": {
    key: "wlm-se",
    name: "We Love Marketing",
    domain: "audit.welovemarketing.se",
    email: "joel@welovemarketing.se",
    phone: "+46 73 554 69 68",
    website: "https://www.welovemarketing.se",
    tagline: "Vi bygger sajter som rankar och konverterar för nordiska SMB:er",
    language: "sv",
    accent: "#E63946",
    accentSoft: "#FF6B6B",
    accentAmber: "#F59E0B",
    countries: ["SE", "NO", "DK"],
    pitch: "vi bygger sajter som rankar och konverterar — sökmotoroptimering, design, tekniskt fundament",
  },
  "wlm-ie": {
    key: "wlm-ie",
    name: "We Love Marketing",
    domain: "audit.welovemarketing.ie",
    email: "hello@welovemarketing.ie",
    phone: "+46 73 554 69 68",
    website: "https://www.welovemarketing.ie",
    tagline: "We build websites that rank and convert for Irish SMBs",
    language: "en",
    accent: "#E63946",
    accentSoft: "#FF6B6B",
    accentAmber: "#F59E0B",
    countries: ["GB", "IE"],
    pitch: "we build websites that rank and convert — SEO, design and technical foundation",
  },
  flodo: {
    key: "flodo",
    name: "Flodo",
    domain: "audit.flodo.se",
    email: "hej@flodo.se",
    phone: "+46 72 987 03 87",
    website: "https://flodo.se",
    tagline: "Få telefonen att ringa. 495 kr/mån, allt ingår.",
    language: "sv",
    accent: "#22C55E",
    accentSoft: "#10B981",
    accentAmber: "#F59E0B",
    // Inga auto-länder — manuell tilldelning eller via SNI/branch
    countries: [],
    pitch: "vi gör det enkelt och billigt för småbolag att synas på Google — fast pris 495 kr/mån, allt ingår",
  },
};

export const DEFAULT_BRAND: BrandKey = "wlm-se";

/**
 * Hitta brand baserat på country-kod (SE/NO/IE/...).
 * Returnerar DEFAULT_BRAND om ingen match.
 */
export function brandForCountry(countryCode: string | null): BrandKey {
  if (!countryCode) return DEFAULT_BRAND;
  const cc = countryCode.toUpperCase();
  for (const brand of Object.values(BRANDS)) {
    if (brand.countries.includes(cc)) return brand.key;
  }
  return DEFAULT_BRAND;
}

/**
 * Mappa request host (welovemarketing.se / .ie / flodo.se) till brand.
 * Används av middleware för Vercel multi-domain deploy.
 */
export function brandForHost(host: string | undefined): BrandKey | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const brand of Object.values(BRANDS)) {
    if (brand.domain === h) return brand.key;
  }
  return null;
}

export function getBrand(key: string | null | undefined): Brand {
  if (!key) return BRANDS[DEFAULT_BRAND];
  return BRANDS[key as BrandKey] ?? BRANDS[DEFAULT_BRAND];
}

export function listBrands(): Brand[] {
  return Object.values(BRANDS);
}
