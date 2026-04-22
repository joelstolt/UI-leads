/**
 * Delad analyse-logik mellan /audit/[placeId]/page.tsx (live UI)
 * och /api/audit-html/[placeId]/route.ts (statisk HTML-export).
 *
 * Ändringar i issue-detection eller score-beräkning sker här på en plats.
 */

import type { BranchBenchmark, Company } from "@/lib/db";

export type Severity = "critical" | "high" | "med";
export type Issue = {
  title: string;
  severity: Severity;
  konsekvens: string;
  losning: string;
};

export const SEV_LABEL: Record<Severity, string> = {
  critical: "Kritiskt",
  high: "Hög",
  med: "Medel",
};

export function buildIssues(lead: Company): Issue[] {
  const issues: Issue[] = [];
  const name = lead.name;

  if (lead.tech_https === 0) {
    issues.push({
      title: "Sajten använder inte HTTPS",
      severity: "critical",
      konsekvens: `⚠ ${name}s sajt körs på http:// — inte krypterad. Besökare ser "Ej säker" i adressfältet (Chrome, Safari, Firefox varnar). Google rankar HTTP-sidor lägre sedan 2014 och varnar i sökresultaten. Kontaktformulär och mejladresser blir osäkra.`,
      losning:
        "✓ Vi flyttar sajten till HTTPS via Let's Encrypt — automatiskt påslaget och gratis. Alla länkar och formulär blir säkra från dag ett.",
    });
  }

  if (lead.tech_has_viewport === 0) {
    issues.push({
      title: "Ingen viewport-tagg — sajten är inte mobilvänlig",
      severity: "critical",
      konsekvens:
        "⚠ Sajten saknar <meta name=\"viewport\"> — på mobil renderas den i desktop-bredd. Besökare tvingas zooma in och scrolla horisontellt. Google använder mobile-first-indexering sedan 2021. 65 %+ av era besökare kommer från mobil och tappar direkt.",
      losning:
        "✓ Mobile-first-redesign med responsiv layout, sticky header, tap-to-call och hamburger-meny. Testad på iOS, Android och iPad. Lighthouse mobil ≥ 90.",
    });
  }

  if (lead.mobile_friendly === "Nej") {
    issues.push({
      title: "Sajten är inte mobilvänlig (enligt Google)",
      severity: "critical",
      konsekvens:
        "⚠ Google klassificerar sajten som icke-mobilvänlig (dåliga tap-targets eller för liten textstorlek). Mobilanvändare kämpar — och 70 % av sökningar sker på mobil. Ni tappar majoriteten av trafiken innan den hinner konvertera.",
      losning:
        "✓ Responsiv design med rätt tap-targets (min 44 px), läsbar textstorlek utan zoom, optimerad navigering för mobilen. Passerar Googles mobilvänlighetstest.",
    });
  }

  if (lead.performance != null && lead.performance < 50) {
    issues.push({
      title: `Hemsidan är för långsam (Performance ${lead.performance}/100)`,
      severity: "critical",
      konsekvens: `⚠ PageSpeed Performance: ${lead.performance}/100. Snittet för välkonverterande sajter är 80+. Varje sekund extra laddtid tappar ca 10 % av besökare. Google rankar långsamma sajter lägre, särskilt på mobil.`,
      losning:
        "✓ Bildoptimering (WebP/AVIF + lazy-load), kodminifiering, CDN och cache-strategi. Förbättring inom 1-2 veckor. Mål: Performance ≥ 85.",
    });
  } else if (lead.performance != null && lead.performance < 80) {
    issues.push({
      title: `Hemsidan kan bli snabbare (Performance ${lead.performance}/100)`,
      severity: "high",
      konsekvens: `⚠ Performance ${lead.performance}/100 är okej men inte bra. Varje sekund i laddtid = ca 10 % färre konverterade besökare.`,
      losning: "✓ Bildkomprimering + CDN + cache = snabb-fix. Når ofta 90+ på några timmar.",
    });
  }

  if (lead.seo != null && lead.seo < 70) {
    issues.push({
      title: `SEO-grunden är inte på plats (SEO-score ${lead.seo}/100)`,
      severity: "critical",
      konsekvens: `⚠ Lighthouse SEO-score: ${lead.seo}/100. Google har svårt att förstå er sajt. Title, meta-description, schema.org-markup, canonical-länkar och intern länkstruktur är bristfälliga. Ni rankar inte på något annat än ert exakta firmanamn.`,
      losning:
        "✓ Unik meta-title + meta-description per sida (50-60 tecken respektive 150-160 tecken), schema.org-markup, canonical-URLer och tydlig intern länkstruktur.",
    });
  } else if (lead.seo != null && lead.seo < 90) {
    issues.push({
      title: `SEO-score kan förbättras (${lead.seo}/100)`,
      severity: "high",
      konsekvens: `⚠ SEO-score ${lead.seo}/100. Fundamentet fungerar men ni lämnar Google-rankingar på bordet.`,
      losning: "✓ Finslipa meta-tags, schema.org, intern länkstruktur och H-rubriker per sida.",
    });
  }

  if (lead.tech_has_schema === 0) {
    issues.push({
      title: "Ingen strukturerad data (JSON-LD schema.org)",
      severity: "high",
      konsekvens:
        "⚠ Sajten saknar schema.org-markup. Ingen LocalBusiness, inga öppettider eller stjärnbetyg i Googles kunskapsgrafer. Ni missar Rich Results, Maps-kopplingar och möjligheten att synas i Googles lokala 3-pack.",
      losning:
        "✓ Komplett JSON-LD: LocalBusiness/Service-schema med öppettider, adress, telefon, areaServed; FAQPage-schema på FAQ-sidan; BreadcrumbList på djupare sidor; AggregateRating för ert Google-betyg.",
    });
  }

  if (lead.sitemap_checked_at && (lead.sitemap_url_count ?? 0) === 0) {
    issues.push({
      title: "Sajten har ingen sitemap.xml",
      severity: "high",
      konsekvens:
        "⚠ Ingen sitemap hittades på /sitemap.xml eller via robots.txt. Google måste hitta alla era sidor via länkar istället — många blir inte alls indexerade. Ni syns bara på Google för ert firmanamn, inte för tjänste- eller ortsökord.",
      losning:
        "✓ Auto-genererad sitemap.xml som listar alla sidor med prioritet och uppdateringsfrekvens. Skickas in till Google Search Console så alla sidor indexeras inom 1-2 veckor.",
    });
  } else if ((lead.sitemap_url_count ?? 0) > 0 && (lead.sitemap_url_count ?? 0) < 10) {
    issues.push({
      title: `Tunt innehåll: bara ${lead.sitemap_url_count} sidor i sitemap`,
      severity: "high",
      konsekvens: `⚠ Er sitemap listar ${lead.sitemap_url_count} sidor. Google favoriserar sajter med djupt, ämnesrikt innehåll. Konkurrenter med 30-100 sidor (tjänster × orter × FAQ) vinner sökningarna.`,
      losning:
        "✓ 20+ innehållsrika sidor: djupa tjänstesidor (500-800 ord/st), ortssidor per region ni arbetar i, FAQ, case och om-oss. Skrivs för nyckelord era kunder faktiskt söker på.",
    });
  }

  if (lead.robots_disallows_root === 1) {
    issues.push({
      title: "robots.txt blockar Google från att läsa sajten",
      severity: "critical",
      konsekvens:
        "⚠ Er robots.txt har Disallow: / vilket stänger av hela sajten från Googles sökrobot. Sajten indexeras inte alls. Det här är antagligen en kvarglömd dev-inställning.",
      losning: "✓ Vi fixar robots.txt och skickar en ny crawl-begäran till Google — sajten börjar synas igen inom några dagar.",
    });
  }

  if (lead.email_scraped_at && !lead.email) {
    issues.push({
      title: "Ingen e-postadress synlig på sajten",
      severity: "med",
      konsekvens:
        "⚠ Vi hittade ingen e-postadress på er hemsida. Kunder som vill kontakta er digitalt (kvällar, helger) fastnar. Offertförfrågningar går förlorade.",
      losning:
        "✓ Tydlig mail-länk i header och footer + kontaktformulär som skickar direkt till er inbox. Öppet dygnet runt även när telefonen ligger på laddning.",
    });
  }

  if (lead.tech_stack === "wix" || lead.tech_stack === "squarespace") {
    const platform = lead.tech_stack === "wix" ? "Wix" : "Squarespace";
    issues.push({
      title: `${platform}-plattformen begränsar er SEO`,
      severity: "high",
      konsekvens: `⚠ ${platform} är låst — ni kan inte optimera server-svar, kontrollera schema.org fullt ut, eller migrera till snabbare hosting. Sökmotoroptimeringen blir ytlig och ni är fast i plattformens prissättning.`,
      losning:
        "✓ Migration till WordPress eller Next.js: full kontroll över SEO, snabbare sajt, inga månadsavgifter till plattformen. Vi tar hand om allt — inga nedtider och era sidor indexeras på nytt direkt.",
    });
  }

  if (lead.domain_rank != null && lead.domain_rank < 1) {
    issues.push({
      title: `Låg domän-auktoritet (DR ${lead.domain_rank.toFixed(1)}/10)`,
      severity: "high",
      konsekvens: `⚠ Domain Rank ${lead.domain_rank.toFixed(1)}/10 betyder att Google inte har någon starkt signal om att er sajt är trovärdig. Ni konkurrerar mot lokala konkurrenter som har 2-4 i DR och vinner därför sökningarna.`,
      losning:
        "✓ Systematisk länkbyggnad: anmälan till branschkataloger, lokala tidningsinslag, partnerlänkar, gästbloggningar och PR. Målet är DR 3+ inom 6 månader.",
    });
  }

  if (lead.tech_stack === "error") {
    issues.unshift({
      title: "Sajten svarar inte — är den nere?",
      severity: "critical",
      konsekvens:
        "⚠ Vi kunde inte ladda er hemsida — sajten svarar med fel (4xx/5xx) eller timeout. Varje minut den är nere = förlorade kunder. Google avindexerar sidor som varit nere för länge.",
      losning:
        "✓ Akut-check av hosting, DNS och SSL. Vi återställer sajten inom 24 h eller flyttar till stabil infrastruktur på Vercel/Netlify.",
    });
  }

  return issues;
}

export type Check = { label: string; pass: boolean | null };

export function buildChecks(lead: Company): Check[] {
  const ps = lead.performance;
  const seo = lead.seo;
  const a11y = lead.accessibility;
  const dr = lead.domain_rank;
  const sitemap = lead.sitemap_url_count;
  return [
    { label: "HTTPS / SSL aktiverat", pass: lead.tech_https === 1 },
    { label: "Mobil viewport-tagg finns", pass: lead.tech_has_viewport === 1 },
    { label: "Mobilvänlig enligt Google (tap-targets, textstorlek)", pass: lead.mobile_friendly === "Ja" },
    { label: "Strukturerad data (schema.org / JSON-LD)", pass: lead.tech_has_schema === 1 },
    { label: "Sitemap.xml finns och innehåller sidor", pass: (sitemap ?? 0) > 0 },
    { label: "robots.txt pekar på sitemap", pass: lead.robots_has_sitemap === 1 },
    { label: "robots.txt blockar inte Google", pass: lead.robots_disallows_root !== 1 },
    { label: "Performance ≥ 80 (snabb laddning)", pass: ps != null ? ps >= 80 : null },
    { label: "SEO-score ≥ 90", pass: seo != null ? seo >= 90 : null },
    { label: "Accessibility ≥ 80", pass: a11y != null ? a11y >= 80 : null },
    { label: "E-postadress synlig på sajten", pass: !!lead.email },
    { label: "Domain Rank ≥ 2 (etablerad auktoritet)", pass: dr != null ? dr >= 2 : null },
    { label: "Minst 10 sidor i sitemap (innehållsrik)", pass: (sitemap ?? 0) >= 10 },
  ];
}

export function computeScore(_lead: Company, checks: Check[]) {
  const passed = checks.filter((c) => c.pass === true).length;
  const total = checks.filter((c) => c.pass !== null).length;
  const score = total === 0 ? 0 : Math.round((passed / total) * 100);
  let grade = "Behöver förbättras";
  let gradeClass = "grade-f";
  if (score >= 90) { grade = "Grade A"; gradeClass = "grade-a"; }
  else if (score >= 75) { grade = "Grade B"; gradeClass = "grade-b"; }
  else if (score >= 60) { grade = "Grade C"; gradeClass = "grade-c"; }
  else if (score >= 40) { grade = "Grade D"; gradeClass = "grade-d"; }
  return { score, grade, gradeClass };
}

export function buildCategoryBars(lead: Company, bench: BranchBenchmark | null) {
  const bars: { label: string; value: number; benchmark: number | null }[] = [];
  const round = (n: number | null | undefined) => (n != null ? Math.round(n) : null);

  if (lead.performance != null) {
    bars.push({ label: "Performance", value: lead.performance, benchmark: round(bench?.avgPerformance) });
  }
  if (lead.seo != null) {
    bars.push({ label: "SEO", value: lead.seo, benchmark: round(bench?.avgSeo) });
  }
  if (lead.accessibility != null) {
    bars.push({ label: "Accessibility", value: lead.accessibility, benchmark: round(bench?.avgAccessibility) });
  }
  if (lead.domain_rank != null) {
    bars.push({
      label: "Domain Rank",
      value: Math.round(lead.domain_rank * 10),
      benchmark: bench?.avgDomainRank != null ? Math.round(bench.avgDomainRank * 10) : null,
    });
  }
  if ((lead.sitemap_url_count ?? 0) > 0) {
    bars.push({
      label: "Innehåll (sitemap-sidor)",
      value: Math.min(100, (lead.sitemap_url_count ?? 0) * 2),
      benchmark: bench?.avgSitemapUrls != null ? Math.min(100, Math.round(bench.avgSitemapUrls * 2)) : null,
    });
  }

  return bars;
}

export function cleanDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatToday(): string {
  return new Date().toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric" });
}

export function scoreColorVar(score: number): string {
  return score >= 75 ? "var(--green)" : score >= 50 ? "var(--yellow)" : score >= 30 ? "var(--orange)" : "var(--red)";
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
