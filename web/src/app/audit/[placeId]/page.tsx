import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLeadById, getBranchBenchmark } from "@/lib/db";
import { getBrand, brandForHost } from "@/lib/brands";
import {
  buildIssues,
  buildChecks,
  computeScore,
  buildCategoryBars,
  cleanDomain,
  sevLabel,
} from "../audit-data";
import { t, formatDate } from "../audit-i18n";
import "../audit.css";

export const dynamic = "force-dynamic";

// ── Page ────────────────────────────────────────────────────────────
export default async function AuditPage({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  const lead = await getLeadById(decodeURIComponent(placeId));
  if (!lead) notFound();

  // Brand-prio: 1) host (Vercel multi-domain), 2) lead.brand, 3) default
  const h = await headers();
  const hostBrand = brandForHost(h.get("host") ?? undefined);
  const brand = getBrand(hostBrand ?? lead.brand);
  const lang = brand.language;
  const s = t(lang);

  const bench = lead.branch ? await getBranchBenchmark(lead.branch) : null;
  const issues = buildIssues(lead, lang);
  const checks = buildChecks(lead, lang);
  const { score, grade, gradeClass } = computeScore(lead, checks, lang);
  const bars = buildCategoryBars(lead, bench, lang);

  const domain = cleanDomain(lead.website);
  const failedChecks = checks.filter((c) => c.pass === false).length;
  const totalKnownChecks = checks.filter((c) => c.pass !== null).length;
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const today = formatDate(lang);

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const scoreColor =
    score >= 75 ? "var(--green)" : score >= 50 ? "var(--yellow)" : score >= 30 ? "var(--orange)" : "var(--red)";

  // Brand-färger som CSS-vars override:ar audit.css defaults
  const brandStyle = {
    "--accent": brand.accent,
    "--accent-soft": brand.accentSoft,
    "--accent-amber": brand.accentAmber,
    "--gradient-warm": `linear-gradient(135deg, ${brand.accent} 0%, ${brand.accentSoft} 40%, ${brand.accentAmber} 100%)`,
    "--accent-bg": `${brand.accent}14`,
    "--accent-border": `${brand.accent}40`,
  } as React.CSSProperties;

  return (
    <div className="audit-page -mx-4 -my-4 md:-mx-10 md:-my-10" style={brandStyle}>
      <div className="audit-container">
        {/* Header */}
        <div className="audit-header">
          <div className="audit-header-badge">{s.seoAnalysis}</div>
          <h1>{lead.name}</h1>
          <div className="subtitle">
            {domain ?? s.noWebsite}
            {lead.branch ? ` — ${lead.branch.toLowerCase()}` : ""}
            {lead.city ? (lang === "en" ? ` in ${lead.city}` : ` i ${lead.city}`) : ""}
          </div>
          <div className="date">
            {s.reportGenerated} {today} · {brand.name}
          </div>
          <div className="audit-header-meta">
            {lead.rating != null && (
              <span>
                <strong>{s.googleRating}</strong> ★ {lead.rating.toFixed(1)}
                {lead.reviews != null && ` (${lead.reviews})`}
              </span>
            )}
            {lead.org_nr && (
              <span>
                <strong>{s.orgNr}</strong> {lead.org_nr}
              </span>
            )}
            {lead.employees != null && (
              <span>
                <strong>{s.employees}</strong> {lead.employees}
              </span>
            )}
          </div>
        </div>

        {/* Score */}
        <div className="audit-score-wrap">
          <div className="score-box">
            <div className="score-ring">
              <svg viewBox="0 0 160 160">
                <circle className="bg" r={radius} cx="80" cy="80" />
                <circle
                  className="progress"
                  r={radius}
                  cx="80"
                  cy="80"
                  stroke={scoreColor}
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                />
              </svg>
              <div className="score-number" style={{ color: scoreColor }}>
                {score}
              </div>
            </div>
            <div className="score-label">{s.seoHealth}</div>
            <div className={`score-grade ${gradeClass}`}>{grade}</div>
            <div className="score-sub">{s.checksFailedOf(failedChecks, totalKnownChecks, issues.length)}</div>
          </div>
        </div>

        {/* Sammanfattning */}
        <div className="audit-section">
          <h2>{s.summary}</h2>
          <p>
            {s.summaryAnalyzedPrefix}
            {domain ? <code style={{ color: "var(--accent-soft)" }}>{domain}</code> : s.summaryYourDigitalPresence}
            {s.summaryWithSameChecks}
            {failedChecks > 0 ? s.summaryFoundIssues(issues.length, criticalCount) : s.summaryAllGood}
          </p>
          {bars.length > 0 && (
            <div className="category-bars">
              {bars.map((b) => (
                <div key={b.label} className="cat-bar">
                  <div className="cat-label">{b.label}</div>
                  <div className="cat-track">
                    <div
                      className="cat-fill"
                      style={{
                        width: `${Math.max(2, Math.min(100, b.value))}%`,
                        background:
                          b.value < 40
                            ? "var(--red)"
                            : b.value < 70
                              ? "var(--orange)"
                              : "var(--gradient-warm)",
                      }}
                    />
                  </div>
                  <div className="cat-value">
                    {b.value}
                    {b.benchmark != null && (
                      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                        {" "}/ {b.benchmark}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Issues */}
        {issues.length > 0 && (
          <details className="audit-section" open>
            <summary>
              <div>
                <h2>{s.issuesHeading(issues.length)}</h2>
                <div className="sum-desc">{s.issuesSubtitle}</div>
              </div>
              <span className="sum-toggle">
                <span className="label-closed">{s.showAll}</span>
                <span className="label-open">{s.hide}</span>
                <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </summary>
            <div className="section-body">
              {issues.map((issue, i) => (
                <div key={i} className="suggestion">
                  <div className="suggestion-top">
                    <div className="suggestion-number">{i + 1}</div>
                    <h3>{issue.title}</h3>
                    <span className={`sev sev-${issue.severity}`}>{sevLabel(lang, issue.severity)}</span>
                  </div>
                  <div className="konsekvens">{issue.konsekvens}</div>
                  <div className="losning">{issue.losning}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Checklista */}
        <details className="audit-section">
          <summary>
            <div>
              <h2>{s.checksHeading(checks.length)}</h2>
              <div className="sum-desc"
                dangerouslySetInnerHTML={{
                  __html: s.checksSubtitle(failedChecks, totalKnownChecks).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                }}
              />
            </div>
            <span className="sum-toggle">
              <span className="label-closed">{s.showChecklist}</span>
              <span className="label-open">{s.hide}</span>
              <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </summary>
          <div className="section-body">
            <div className="check-header">
              <div></div>
              <div className="check-col-head">{s.statusCol}</div>
            </div>
            {checks.map((c, i) => (
              <div key={i} className="check-item">
                <div className="check-label">{c.label}</div>
                <div
                  className={`check-col ${
                    c.pass === true ? "check-good" : c.pass === false ? "check-bad" : "check-unknown"
                  }`}
                >
                  {c.pass === true ? "✓" : c.pass === false ? "✗" : "—"}
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Vision */}
        <div className="audit-section">
          <h2>{s.visionHeading}</h2>
          <p>{s.visionIntro}</p>
          <div className="vision-grid">
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M3 3v18h18" />
                  <path d="m7 14 3-3 4 4 5-6" />
                </svg>
              </div>
              <h4>{s.visionCards.ranking.title}</h4>
              <p>
                {s.visionCards.ranking.body(
                  lead.branch?.toLowerCase() ?? s.visionDefaultBranch,
                  lead.city ?? s.visionDefaultCity
                )}
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <h4>{s.visionCards.richSnippets.title}</h4>
              <p>{s.visionCards.richSnippets.body}</p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <h4>{s.visionCards.requests24_7.title}</h4>
              <p>{s.visionCards.requests24_7.body}</p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
                  <circle cx="12" cy="9" r={2.5} />
                </svg>
              </div>
              <h4>{s.visionCards.localAuthority.title}</h4>
              <p>{s.visionCards.localAuthority.body}</p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 2v20" />
                  <path d="M2 12h20" />
                </svg>
              </div>
              <h4>{s.visionCards.performance.title}</h4>
              <p>{s.visionCards.performance.body}</p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 2s3 4 3 7a3 3 0 0 1-6 0c0-3 3-7 3-7Z" />
                  <path d="M5 18a7 7 0 1 0 14 0Z" />
                </svg>
              </div>
              <h4>{s.visionCards.credibility.title}</h4>
              <p>{s.visionCards.credibility.body}</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="cta-section">
          <h2>{s.ctaHeading}</h2>
          <p>{s.ctaLead}</p>
          <ul className="cta-list">
            {s.ctaList.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          <div className="cta-buttons">
            <a
              className="cta-btn cta-btn-primary"
              href={`mailto:${brand.email}?subject=${encodeURIComponent(s.ctaMailSubject(lead.name))}&body=${encodeURIComponent(
                s.ctaMailBody(brand.website)
              )}`}
            >
              {s.ctaButtonPrimary}
            </a>
            <a className="cta-btn cta-btn-ghost" href={`tel:${brand.phone.replace(/\s/g, "")}`}>
              {s.ctaButtonCall} {brand.phone}
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="audit-footer">
          <div className="footer-grid">
            <div>
              <strong>{s.footerCompany}</strong>
              <span>
                {lead.name}
                {lead.address && (
                  <>
                    <br />
                    {lead.address}
                  </>
                )}
                {lead.rating != null && (
                  <>
                    <br />★ {lead.rating.toFixed(1)} {s.footerGoogleStar}
                    {lead.reviews != null && ` · ${lead.reviews} ${s.footerReviews}`}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>{s.footerDomain}</strong>
              <span>
                {domain ?? s.footerDomainEmpty}
                {lead.tech_stack && (
                  <>
                    <br />
                    {s.footerPlatform} {lead.tech_stack}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>{s.footerBranch}</strong>
              <span>
                {lead.branch ?? s.footerDomainEmpty}
                {lead.sni_code && (
                  <>
                    <br />
                    SNI: {lead.sni_code}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>{s.footerAnalyzedBy}</strong>
              <span>
                {brand.name}
                <br />
                {brand.email}
              </span>
            </div>
          </div>
          <div className="footer-copy">
            <p>
              {s.footerReportBy}{" "}
              <Link href={brand.website} target="_blank" rel="noopener">
                {brand.name}
              </Link>{" "}
              · {brand.phone} · {brand.email}
            </p>
          </div>
        </div>

        <div className="deadline">{s.footerConfidential} {today}.</div>
      </div>
    </div>
  );
}
