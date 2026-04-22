/**
 * Standalone HTML-template för cold outreach-export.
 *
 * Returnerar self-contained HTML (med inline CSS) som du laddar upp till
 * t.ex. wlm/public/rapport/cafe-ray.html. Ingen JS, ingen extern CSS,
 * ingen sidebar — bara en ren rapport som lever på dig egen domän.
 *
 * Använder samma issues/checks/score-data som /audit/[placeId]-sidan
 * (via audit-data.ts) — samma siffror, samma copy.
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
  formatToday,
  scoreColorVar,
  SEV_LABEL,
} from "./audit-data";

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
  const issues = buildIssues(lead);
  const checks = buildChecks(lead);
  const { score, grade, gradeClass } = computeScore(lead, checks);
  const bars = buildCategoryBars(lead, bench);

  const domain = cleanDomain(lead.website);
  const failedChecks = checks.filter((c) => c.pass === false).length;
  const totalKnownChecks = checks.filter((c) => c.pass !== null).length;

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
      `<span><strong>Google-betyg:</strong> ★ ${lead.rating.toFixed(1)}${lead.reviews != null ? ` (${lead.reviews})` : ""}</span>`
    );
  }
  if (lead.org_nr) headerMeta.push(`<span><strong>Org.nr:</strong> ${escapeHtml(lead.org_nr)}</span>`);
  if (lead.employees != null) headerMeta.push(`<span><strong>Anställda:</strong> ${lead.employees}</span>`);

  const subtitleParts: string[] = [];
  if (domain) subtitleParts.push(escapeHtml(domain));
  else subtitleParts.push("Ingen hemsida registrerad");
  if (lead.branch) subtitleParts.push(`— ${escapeHtml(lead.branch.toLowerCase())}`);
  if (lead.city) subtitleParts.push(`i ${escapeHtml(lead.city)}`);

  const summaryText =
    failedChecks > 0
      ? `Vi hittade ${issues.length} konkreta brister — ${issues.filter((i) => i.severity === "critical").length} kritiska — som direkt kostar er kunder varje dag.`
      : "Tekniskt sett ser det mesta bra ut. Vi kan ändå hjälpa er växa genom innehåll, annonser eller konvertering.";

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
            <span class="sev sev-${issue.severity}">${SEV_LABEL[issue.severity]}</span>
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

  const today = formatToday();
  const mailtoSubject = encodeURIComponent(`Audit för ${lead.name}`);
  const mailtoBody = encodeURIComponent(
    `Hej!\n\nJag såg er SEO-rapport.\n\nJag vill boka 30 min gratis genomgång.\n\nMvh`
  );

  return `<!DOCTYPE html>
<html lang="${brand.language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>SEO-analys – ${escapeHtml(lead.name)} | ${escapeHtml(brand.name)}</title>
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
      <div class="audit-header-badge">SEO-analys</div>
      <h1>${escapeHtml(lead.name)}</h1>
      <div class="subtitle">${subtitleParts.join(" ")}</div>
      <div class="date">Rapport genererad ${today} · ${escapeHtml(brand.name)}</div>
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
        <div class="score-label">SEO-hälsa</div>
        <div class="score-grade ${gradeClass}">${grade}</div>
        <div class="score-sub">${failedChecks} av ${totalKnownChecks} kontrollpunkter misslyckas · ${issues.length} brister</div>
      </div>
    </div>

    <div class="audit-section">
      <h2>Sammanfattning</h2>
      <p>Vi har analyserat ${domain ? `<code style="color:var(--accent-soft)">${escapeHtml(domain)}</code>` : "er digitala närvaro"} med samma kontroller som Google Search Console och Lighthouse. ${summaryText}</p>
      ${bars.length ? `<div class="category-bars">${barsHtml}</div>` : ""}
    </div>

    ${
      issues.length > 0
        ? `<details class="audit-section" open>
      <summary>
        <div>
          <h2>${issues.length} saker som kostar er kunder idag</h2>
          <div class="sum-desc">Sorterade efter hur mycket de påverkar er synlighet och konvertering. Alla är fixbara.</div>
        </div>
        <span class="sum-toggle"><span class="label-closed">Visa alla</span><span class="label-open">Dölj</span></span>
      </summary>
      <div class="section-body">${issuesHtml}</div>
    </details>`
        : ""
    }

    <details class="audit-section">
      <summary>
        <div>
          <h2>${checks.length} SEO-kontrollpunkter</h2>
          <div class="sum-desc">Samma kontroller som Google Search Console — <strong>${failedChecks} av ${totalKnownChecks} misslyckas</strong> idag.</div>
        </div>
        <span class="sum-toggle"><span class="label-closed">Visa checklistan</span><span class="label-open">Dölj</span></span>
      </summary>
      <div class="section-body">
        <div class="check-header"><div></div><div class="check-col-head">Status</div></div>
        ${checksHtml}
      </div>
    </details>

    <div class="cta-section">
      <h2>Vill ni att vi fixar det här?</h2>
      <p>30-min gratis genomgång där vi går igenom rapporten och visar exakt hur vi hade löst varje punkt.</p>
      <ul class="cta-list">
        <li>Teknisk SEO-grund: HTTPS, schema.org, sitemap, mobilanpassning</li>
        <li>Djupa tjänstesidor + ortsidor för lokal ranking</li>
        <li>Kontaktformulär + offertformulär öppet dygnet runt</li>
        <li>Google Business Profile-optimering (om ej redan gjort)</li>
        <li>Löpande SEO-arbete efter lansering — inte bara bygga och lämna</li>
      </ul>
      <div class="cta-buttons">
        <a class="cta-btn cta-btn-primary" href="mailto:${brand.email}?subject=${mailtoSubject}&body=${mailtoBody}">Boka 30-min genomgång</a>
        <a class="cta-btn cta-btn-ghost" href="tel:${brand.phone.replace(/\s/g, "")}">Ring ${escapeHtml(brand.phone)}</a>
      </div>
    </div>

    <div class="audit-footer">
      <div class="footer-grid">
        <div>
          <strong>Bolag</strong>
          <span>${escapeHtml(lead.name)}${lead.address ? `<br>${escapeHtml(lead.address)}` : ""}${lead.rating != null ? `<br>★ ${lead.rating.toFixed(1)} på Google${lead.reviews != null ? ` · ${lead.reviews} recensioner` : ""}` : ""}</span>
        </div>
        <div>
          <strong>Analyserad domän</strong>
          <span>${domain ? escapeHtml(domain) : "—"}${lead.tech_stack ? `<br>Plattform: ${escapeHtml(lead.tech_stack)}` : ""}</span>
        </div>
        <div>
          <strong>Bransch</strong>
          <span>${lead.branch ? escapeHtml(lead.branch) : "—"}${lead.sni_code ? `<br>SNI: ${escapeHtml(lead.sni_code)}` : ""}</span>
        </div>
        <div>
          <strong>Analyserad av</strong>
          <span>${escapeHtml(brand.name)}<br>${escapeHtml(brand.email)}</span>
        </div>
      </div>
      <div class="footer-copy">
        <p>Rapport av <a href="${brand.website}" target="_blank" rel="noopener">${escapeHtml(brand.name)}</a> · ${escapeHtml(brand.phone)} · ${escapeHtml(brand.email)}</p>
      </div>
    </div>

    <div class="deadline">Konfidentiellt arbetsmaterial · rapport genererad ${today}.</div>
  </div>
</div>

</body>
</html>`;
}
