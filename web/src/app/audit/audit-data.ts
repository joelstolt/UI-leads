/**
 * Delad analyse-logik mellan /audit/[placeId]/page.tsx (live UI)
 * och /api/audit-html/[placeId]/route.ts (statisk HTML-export).
 *
 * Ändringar i issue-detection eller score-beräkning sker här på en plats.
 *
 * All användarvänlig copy (issue-titlar, check-labels, grade-text) hämtas
 * via t(lang) från audit-i18n.ts — lang = brand.language.
 */

import type { BranchBenchmark, Company } from "@/lib/db";
import { t, type Lang } from "./audit-i18n";

export type Severity = "critical" | "high" | "med";
export type Issue = {
  title: string;
  severity: Severity;
  konsekvens: string;
  losning: string;
};

export function sevLabel(lang: Lang | string | undefined, severity: Severity): string {
  const s = t(lang);
  if (severity === "critical") return s.severityCritical;
  if (severity === "high") return s.severityHigh;
  return s.severityMed;
}

export function buildIssues(lead: Company, lang: Lang | string | undefined): Issue[] {
  const s = t(lang).issues;
  const issues: Issue[] = [];
  const name = lead.name;

  if (lead.tech_https === 0) {
    issues.push({
      title: s.noHttps.title,
      severity: "critical",
      konsekvens: s.noHttps.konsekvens(name),
      losning: s.noHttps.losning,
    });
  }

  if (lead.tech_has_viewport === 0) {
    issues.push({
      title: s.noViewport.title,
      severity: "critical",
      konsekvens: s.noViewport.konsekvens,
      losning: s.noViewport.losning,
    });
  }

  if (lead.mobile_friendly === "Nej") {
    issues.push({
      title: s.notMobileFriendly.title,
      severity: "critical",
      konsekvens: s.notMobileFriendly.konsekvens,
      losning: s.notMobileFriendly.losning,
    });
  }

  if (lead.performance != null && lead.performance < 50) {
    issues.push({
      title: s.perfCritical.title(lead.performance),
      severity: "critical",
      konsekvens: s.perfCritical.konsekvens(lead.performance),
      losning: s.perfCritical.losning,
    });
  } else if (lead.performance != null && lead.performance < 80) {
    issues.push({
      title: s.perfHigh.title(lead.performance),
      severity: "high",
      konsekvens: s.perfHigh.konsekvens(lead.performance),
      losning: s.perfHigh.losning,
    });
  }

  if (lead.seo != null && lead.seo < 70) {
    issues.push({
      title: s.seoCritical.title(lead.seo),
      severity: "critical",
      konsekvens: s.seoCritical.konsekvens(lead.seo),
      losning: s.seoCritical.losning,
    });
  } else if (lead.seo != null && lead.seo < 90) {
    issues.push({
      title: s.seoHigh.title(lead.seo),
      severity: "high",
      konsekvens: s.seoHigh.konsekvens(lead.seo),
      losning: s.seoHigh.losning,
    });
  }

  if (lead.tech_has_schema === 0) {
    issues.push({
      title: s.noSchema.title,
      severity: "high",
      konsekvens: s.noSchema.konsekvens,
      losning: s.noSchema.losning,
    });
  }

  if (lead.sitemap_checked_at && (lead.sitemap_url_count ?? 0) === 0) {
    issues.push({
      title: s.noSitemap.title,
      severity: "high",
      konsekvens: s.noSitemap.konsekvens,
      losning: s.noSitemap.losning,
    });
  } else if ((lead.sitemap_url_count ?? 0) > 0 && (lead.sitemap_url_count ?? 0) < 10) {
    const count = lead.sitemap_url_count ?? 0;
    issues.push({
      title: s.thinSitemap.title(count),
      severity: "high",
      konsekvens: s.thinSitemap.konsekvens(count),
      losning: s.thinSitemap.losning,
    });
  }

  if (lead.robots_disallows_root === 1) {
    issues.push({
      title: s.robotsDisallow.title,
      severity: "critical",
      konsekvens: s.robotsDisallow.konsekvens,
      losning: s.robotsDisallow.losning,
    });
  }

  if (lead.email_scraped_at && !lead.email) {
    issues.push({
      title: s.noEmail.title,
      severity: "med",
      konsekvens: s.noEmail.konsekvens,
      losning: s.noEmail.losning,
    });
  }

  if (lead.tech_stack === "wix" || lead.tech_stack === "squarespace") {
    const platform = lead.tech_stack === "wix" ? "Wix" : "Squarespace";
    issues.push({
      title: s.lockedPlatform.title(platform),
      severity: "high",
      konsekvens: s.lockedPlatform.konsekvens(platform),
      losning: s.lockedPlatform.losning,
    });
  }

  if (lead.domain_rank != null && lead.domain_rank < 1) {
    const dr = lead.domain_rank.toFixed(1);
    issues.push({
      title: s.lowDomainRank.title(dr),
      severity: "high",
      konsekvens: s.lowDomainRank.konsekvens(dr),
      losning: s.lowDomainRank.losning,
    });
  }

  if (lead.tech_stack === "error") {
    issues.unshift({
      title: s.siteDown.title,
      severity: "critical",
      konsekvens: s.siteDown.konsekvens,
      losning: s.siteDown.losning,
    });
  }

  return issues;
}

export type Check = { label: string; pass: boolean | null };

export function buildChecks(lead: Company, lang: Lang | string | undefined): Check[] {
  const c = t(lang).checks;
  const ps = lead.performance;
  const seo = lead.seo;
  const a11y = lead.accessibility;
  const dr = lead.domain_rank;
  const sitemap = lead.sitemap_url_count;
  return [
    { label: c.https, pass: lead.tech_https === 1 },
    { label: c.viewport, pass: lead.tech_has_viewport === 1 },
    { label: c.mobileFriendly, pass: lead.mobile_friendly === "Ja" },
    { label: c.schema, pass: lead.tech_has_schema === 1 },
    { label: c.sitemap, pass: (sitemap ?? 0) > 0 },
    { label: c.robotsSitemap, pass: lead.robots_has_sitemap === 1 },
    { label: c.robotsNotBlocking, pass: lead.robots_disallows_root !== 1 },
    { label: c.performance80, pass: ps != null ? ps >= 80 : null },
    { label: c.seo90, pass: seo != null ? seo >= 90 : null },
    { label: c.a11y80, pass: a11y != null ? a11y >= 80 : null },
    { label: c.emailVisible, pass: !!lead.email },
    { label: c.domainRank2, pass: dr != null ? dr >= 2 : null },
    { label: c.sitemap10, pass: (sitemap ?? 0) >= 10 },
  ];
}

export function computeScore(_lead: Company, checks: Check[], lang: Lang | string | undefined) {
  const s = t(lang);
  const passed = checks.filter((c) => c.pass === true).length;
  const total = checks.filter((c) => c.pass !== null).length;
  const score = total === 0 ? 0 : Math.round((passed / total) * 100);
  let grade = s.gradeNeedsImprovement;
  let gradeClass = "grade-f";
  if (score >= 90) { grade = s.gradeA; gradeClass = "grade-a"; }
  else if (score >= 75) { grade = s.gradeB; gradeClass = "grade-b"; }
  else if (score >= 60) { grade = s.gradeC; gradeClass = "grade-c"; }
  else if (score >= 40) { grade = s.gradeD; gradeClass = "grade-d"; }
  return { score, grade, gradeClass };
}

export function buildCategoryBars(
  lead: Company,
  bench: BranchBenchmark | null,
  lang: Lang | string | undefined
) {
  const labels = t(lang).barLabels;
  const bars: { label: string; value: number; benchmark: number | null }[] = [];
  const round = (n: number | null | undefined) => (n != null ? Math.round(n) : null);

  if (lead.performance != null) {
    bars.push({ label: labels.performance, value: lead.performance, benchmark: round(bench?.avgPerformance) });
  }
  if (lead.seo != null) {
    bars.push({ label: labels.seo, value: lead.seo, benchmark: round(bench?.avgSeo) });
  }
  if (lead.accessibility != null) {
    bars.push({ label: labels.accessibility, value: lead.accessibility, benchmark: round(bench?.avgAccessibility) });
  }
  if (lead.domain_rank != null) {
    bars.push({
      label: labels.domainRank,
      value: Math.round(lead.domain_rank * 10),
      benchmark: bench?.avgDomainRank != null ? Math.round(bench.avgDomainRank * 10) : null,
    });
  }
  if ((lead.sitemap_url_count ?? 0) > 0) {
    bars.push({
      label: labels.content,
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
