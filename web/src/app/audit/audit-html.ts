/**
 * Standalone HTML-template för cold outreach-export.
 *
 * Returnerar self-contained HTML (med inline CSS) som du laddar upp till
 * t.ex. wlm/public/rapport/cafe-ray.html. Ingen JS, ingen extern CSS,
 * ingen sidebar — bara en ren rapport som lever på dig egen domän.
 *
 * Använder samma issues/checks/score-data som /audit/[placeId]-sidan
 * (via audit-data.ts) — samma siffror, samma copy.
 *
 * Språk kommer från brand.language (sv/en) och används för att rendera
 * rätt t()-strängar.
 */

import fs from "node:fs";
import path from "node:path";
import "server-only";

import type { BranchBenchmark, Company } from "@/lib/db";
import type { Brand } from "@/lib/brands";
import {
  buildIssues,
  buildChecks,
  computeScore,
  buildCategoryBars,
  cleanDomain,
  scoreColorVar,
  sevLabel,
} from "./audit-data";
import { t, formatDate } from "./audit-i18n";

let _cssCache: string | null = null;
function readAuditCss(): string {
  if (_cssCache) return _cssCache;
  // process.cwd() är Next.js-projektroten (web/) i prod och dev
  const cssPath = path.resolve(process.cwd(), "src/app/audit/audit.css");
  _cssCache = fs.readFileSync(cssPath, "utf8");
  return _cssCache;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAuditHtml(
  lead: Company,
  bench: BranchBenchmark | null,
  brand: Brand
): string {
  const lang = brand.language;
  const s = t(lang);
  const issues = buildIssues(lead, lang);
  const checks = buildChecks(lead, lang);
  const { score, grade, gradeClass } = computeScore(lead, checks, lang);
  const bars = buildCategoryBars(lead, bench, lang);

  const domain = cleanDomain(lead.website);
  const failedChecks = checks.filter((c) => c.pass === false).length;
  const totalKnownChecks = checks.filter((c) => c.pass !== null).length;
  const criticalCount = issues.filter((i) => i.severity === "critical").length;

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const sc = scoreColorVar(score);

  const css = readAuditCss();

  const brandStyle = `
    --accent: ${brand.accent};
    --accent-soft: ${brand.accentSoft};
    --accent-amber: ${brand.accentAmber};
    --gradient-warm: linear-gradient(135deg, ${brand.accent} 0%, ${brand.accentSoft} 40%, ${brand.accentAmber} 100%);
    --accent-bg: ${brand.accent}14;
    --accent-border: ${brand.accent}40;
  `.trim();

  const headerMeta: string[] = [];
  if (lead.rating != null) {
    headerMeta.push(
      `<span><strong>${s.googleRating}</strong> ★ ${lead.rating.toFixed(1)}${lead.reviews != null ? ` (${lead.reviews})` : ""}</span>`
    );
  }
  if (lead.org_nr) headerMeta.push(`<span><strong>${s.orgNr}</strong> ${escapeHtml(lead.org_nr)}</span>`);
  if (lead.employees != null) headerMeta.push(`<span><strong>${s.employees}</strong> ${lead.employees}</span>`);

  const subtitleParts: string[] = [];
  if (domain) subtitleParts.push(escapeHtml(domain));
  else subtitleParts.push(s.noWebsite);
  if (lead.branch) subtitleParts.push(`— ${escapeHtml(lead.branch.toLowerCase())}`);
  if (lead.city) subtitleParts.push(lang === "en" ? `in ${escapeHtml(lead.city)}` : `i ${escapeHtml(lead.city)}`);

  const summaryText =
    failedChecks > 0 ? s.summaryFoundIssues(issues.length, criticalCount) : s.summaryAllGood;

  const barsHtml = bars
    .map(
      (b) => `
        <div class="cat-bar">
          <div class="cat-label">${escapeHtml(b.label)}</div>
          <div class="cat-track">
            <div class="cat-fill" style="width:${Math.max(2, Math.min(100, b.value))}%;background:${b.value < 40 ? "var(--red)" : b.value < 70 ? "var(--orange)" : "var(--gradient-warm)"}"></div>
          </div>
          <div class="cat-value">${b.value}${b.benchmark != null ? `<span style="color:var(--text-muted);font-weight:400"> / ${b.benchmark}</span>` : ""}</div>
        </div>`
    )
    .join("");

  const issuesHtml = issues
    .map(
      (issue, i) => `
        <div class="suggestion">
          <div class="suggestion-top">
            <div class="suggestion-number">${i + 1}</div>
            <h3>${escapeHtml(issue.title)}</h3>
            <span class="sev sev-${issue.severity}">${sevLabel(lang, issue.severity)}</span>
          </div>
          <div class="konsekvens">${escapeHtml(issue.konsekvens)}</div>
          <div class="losning">${escapeHtml(issue.losning)}</div>
        </div>`
    )
    .join("");

  const checksHtml = checks
    .map(
      (c) => `
        <div class="check-item">
          <div class="check-label">${escapeHtml(c.label)}</div>
          <div class="check-col ${c.pass === true ? "check-good" : c.pass === false ? "check-bad" : "check-unknown"}">${c.pass === true ? "✓" : c.pass === false ? "✗" : "—"}</div>
        </div>`
    )
    .join("");

  const today = formatDate(lang);
  const mailtoSubject = encodeURIComponent(s.ctaMailSubject(lead.name));
  const mailtoBody = encodeURIComponent(s.ctaMailBody(brand.website));
  const checksSubtitleHtml = s
    .checksSubtitle(failedChecks, totalKnownChecks)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const ctaListHtml = s.ctaList.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const summaryAnalyzedHtml = domain
    ? `<code style="color:var(--accent-soft)">${escapeHtml(domain)}</code>`
    : s.summaryYourDigitalPresence;

  return `<!DOCTYPE html>
<html lang="${brand.language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(s.seoAnalysis)} – ${escapeHtml(lead.name)} | ${escapeHtml(brand.name)}</title>
<style>
${css}
/* Standalone-overrides: ingen sidebar, full-width body */
.audit-page { margin: 0 !important; padding: 0 !important; min-height: 100vh; background: var(--bg); }
body { background: #0A0A0A; }
</style>
</head>
<body>

<div class="audit-page" style="${brandStyle}">
  <div class="audit-container">

    <div class="audit-header">
      <div class="audit-header-badge">${escapeHtml(s.seoAnalysis)}</div>
      <h1>${escapeHtml(lead.name)}</h1>
      <div class="subtitle">${subtitleParts.join(" ")}</div>
      <div class="date">${escapeHtml(s.reportGenerated)} ${today} · ${escapeHtml(brand.name)}</div>
      ${headerMeta.length ? `<div class="audit-header-meta">${headerMeta.join("")}</div>` : ""}
    </div>

    <div class="audit-score-wrap">
      <div class="score-box">
        <div class="score-ring">
          <svg viewBox="0 0 160 160">
            <circle class="bg" r="${radius}" cx="80" cy="80"/>
            <circle class="progress" r="${radius}" cx="80" cy="80" stroke="${sc}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
          </svg>
          <div class="score-number" style="color:${sc}">${score}</div>
        </div>
        <div class="score-label">${escapeHtml(s.seoHealth)}</div>
        <div class="score-grade ${gradeClass}">${escapeHtml(grade)}</div>
        <div class="score-sub">${s.checksFailedOf(failedChecks, totalKnownChecks, issues.length)}</div>
      </div>
    </div>

    <div class="audit-section">
      <h2>${escapeHtml(s.summary)}</h2>
      <p>${escapeHtml(s.summaryAnalyzedPrefix)}${summaryAnalyzedHtml}${escapeHtml(s.summaryWithSameChecks)}${escapeHtml(summaryText)}</p>
      ${bars.length ? `<div class="category-bars">${barsHtml}</div>` : ""}
    </div>

    ${
      issues.length > 0
        ? `<details class="audit-section" open>
      <summary>
        <div>
          <h2>${escapeHtml(s.issuesHeading(issues.length))}</h2>
          <div class="sum-desc">${escapeHtml(s.issuesSubtitle)}</div>
        </div>
        <span class="sum-toggle"><span class="label-closed">${escapeHtml(s.showAll)}</span><span class="label-open">${escapeHtml(s.hide)}</span></span>
      </summary>
      <div class="section-body">${issuesHtml}</div>
    </details>`
        : ""
    }

    <details class="audit-section">
      <summary>
        <div>
          <h2>${escapeHtml(s.checksHeading(checks.length))}</h2>
          <div class="sum-desc">${checksSubtitleHtml}</div>
        </div>
        <span class="sum-toggle"><span class="label-closed">${escapeHtml(s.showChecklist)}</span><span class="label-open">${escapeHtml(s.hide)}</span></span>
      </summary>
      <div class="section-body">
        <div class="check-header"><div></div><div class="check-col-head">${escapeHtml(s.statusCol)}</div></div>
        ${checksHtml}
      </div>
    </details>

    <div class="cta-section">
      <h2>${escapeHtml(s.ctaHeading)}</h2>
      <p>${escapeHtml(s.ctaLead)}</p>
      <ul class="cta-list">${ctaListHtml}</ul>
      <div class="cta-buttons">
        <a class="cta-btn cta-btn-primary" href="mailto:${brand.email}?subject=${mailtoSubject}&body=${mailtoBody}">${escapeHtml(s.ctaButtonPrimary)}</a>
        <a class="cta-btn cta-btn-ghost" href="tel:${brand.phone.replace(/\s/g, "")}">${escapeHtml(s.ctaButtonCall)} ${escapeHtml(brand.phone)}</a>
      </div>
    </div>

    <div class="audit-footer">
      <div class="footer-grid">
        <div>
          <strong>${escapeHtml(s.footerCompany)}</strong>
          <span>${escapeHtml(lead.name)}${lead.address ? `<br>${escapeHtml(lead.address)}` : ""}${lead.rating != null ? `<br>★ ${lead.rating.toFixed(1)} ${escapeHtml(s.footerGoogleStar)}${lead.reviews != null ? ` · ${lead.reviews} ${escapeHtml(s.footerReviews)}` : ""}` : ""}</span>
        </div>
        <div>
          <strong>${escapeHtml(s.footerDomain)}</strong>
          <span>${domain ? escapeHtml(domain) : s.footerDomainEmpty}${lead.tech_stack ? `<br>${escapeHtml(s.footerPlatform)} ${escapeHtml(lead.tech_stack)}` : ""}</span>
        </div>
        <div>
          <strong>${escapeHtml(s.footerBranch)}</strong>
          <span>${lead.branch ? escapeHtml(lead.branch) : s.footerDomainEmpty}${lead.sni_code ? `<br>SNI: ${escapeHtml(lead.sni_code)}` : ""}</span>
        </div>
        <div>
          <strong>${escapeHtml(s.footerAnalyzedBy)}</strong>
          <span>${escapeHtml(brand.name)}<br>${escapeHtml(brand.email)}</span>
        </div>
      </div>
      <div class="footer-copy">
        <p>${escapeHtml(s.footerReportBy)} <a href="${brand.website}" target="_blank" rel="noopener">${escapeHtml(brand.name)}</a> · ${escapeHtml(brand.phone)} · ${escapeHtml(brand.email)}</p>
      </div>
    </div>

    <div class="deadline">${escapeHtml(s.footerConfidential)} ${today}.</div>
  </div>
</div>

</body>
</html>`;
}
