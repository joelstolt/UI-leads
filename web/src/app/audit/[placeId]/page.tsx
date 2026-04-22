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
  formatToday,
  scoreColorVar,
  SEV_LABEL,
} from "../audit-data";
import "../audit.css";

export const dynamic = "force-dynamic";

// Issue/check/score-funktioner är delade via audit-data.ts.

// ── Page ────────────────────────────────────────────────────────────
export default async function AuditPage({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  const lead = await getLeadById(decodeURIComponent(placeId));
  if (!lead) notFound();

  // Brand-prio: 1) host (Vercel multi-domain), 2) lead.brand, 3) default
  const h = await headers();
  const hostBrand = brandForHost(h.get("host") ?? undefined);
  const brand = getBrand(hostBrand ?? lead.brand);

  const bench = lead.branch ? await getBranchBenchmark(lead.branch) : null;
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
          <div className="audit-header-badge">SEO-analys</div>
          <h1>{lead.name}</h1>
          <div className="subtitle">
            {domain ?? "Ingen hemsida registrerad"}
            {lead.branch ? ` — ${lead.branch.toLowerCase()}` : ""}
            {lead.city ? ` i ${lead.city}` : ""}
          </div>
          <div className="date">
            Rapport genererad {formatToday()} · {brand.name}
          </div>
          <div className="audit-header-meta">
            {lead.rating != null && (
              <span>
                <strong>Google-betyg:</strong> ★ {lead.rating.toFixed(1)}
                {lead.reviews != null && ` (${lead.reviews})`}
              </span>
            )}
            {lead.org_nr && (
              <span>
                <strong>Org.nr:</strong> {lead.org_nr}
              </span>
            )}
            {lead.employees != null && (
              <span>
                <strong>Anställda:</strong> {lead.employees}
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
            <div className="score-label">SEO-hälsa</div>
            <div className={`score-grade ${gradeClass}`}>{grade}</div>
            <div className="score-sub">
              {failedChecks} av {totalKnownChecks} kontrollpunkter misslyckas · {issues.length} brister
            </div>
          </div>
        </div>

        {/* Sammanfattning */}
        <div className="audit-section">
          <h2>Sammanfattning</h2>
          <p>
            Vi har analyserat {domain ? <code style={{ color: "var(--accent-soft)" }}>{domain}</code> : "er digitala närvaro"}{" "}
            med samma kontroller som Google Search Console och Lighthouse.{" "}
            {failedChecks > 0
              ? `Vi hittade ${issues.length} konkreta brister — ${issues.filter((i) => i.severity === "critical").length} kritiska — som direkt kostar er kunder varje dag.`
              : "Tekniskt sett ser det mesta bra ut. Vi kan ändå hjälpa er växa genom innehåll, annonser eller konvertering."}
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
                <h2>{issues.length} saker som kostar er kunder idag</h2>
                <div className="sum-desc">
                  Sorterade efter hur mycket de påverkar er synlighet och konvertering. Alla är fixbara.
                </div>
              </div>
              <span className="sum-toggle">
                <span className="label-closed">Visa alla</span>
                <span className="label-open">Dölj</span>
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
                    <span className={`sev sev-${issue.severity}`}>{SEV_LABEL[issue.severity]}</span>
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
              <h2>{checks.length} SEO-kontrollpunkter</h2>
              <div className="sum-desc">
                Samma kontroller som Google Search Console —{" "}
                <strong>
                  {failedChecks} av {totalKnownChecks} misslyckas
                </strong>{" "}
                idag.
              </div>
            </div>
            <span className="sum-toggle">
              <span className="label-closed">Visa checklistan</span>
              <span className="label-open">Dölj</span>
              <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </summary>
          <div className="section-body">
            <div className="check-header">
              <div></div>
              <div className="check-col-head">Status</div>
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
          <h2>Vad öppnar sig när vi fixat detta</h2>
          <p>
            Inom 3-6 månader med rätt teknisk grund och kontinuerlig närvaro — vad ni kan räkna med:
          </p>
          <div className="vision-grid">
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M3 3v18h18" />
                  <path d="m7 14 3-3 4 4 5-6" />
                </svg>
              </div>
              <h4>Ranking på lokala nyckelord</h4>
              <p>
                Sökningar som "{lead.branch?.toLowerCase() ?? "er tjänst"} {lead.city ?? "er ort"}" — där
                era konkurrenter ligger idag — blir möjliga att nå med rätt tjänste- + ort-sidor.
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <h4>Rich Snippets i sökresultaten</h4>
              <p>
                Schema.org-markup visar ert Google-betyg, öppettider och tjänster direkt i sökresultaten.
                FAQ-schema ger expanderbara utdrag som tar mer plats.
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <h4>Fler förfrågningar dygnet runt</h4>
              <p>
                Dedikerat offertformulär med tjänsteval och tidsram — öppet 24/7 även när telefonen ligger
                på laddning. Strukturerade leads som kan följas upp nästa dag.
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
                  <circle cx="12" cy="9" r={2.5} />
                </svg>
              </div>
              <h4>Lokal auktoritet som konkurrensfördel</h4>
              <p>
                Ortsspecifika sidor med lokal copy bygger relevans i Googles lokala 3-pack — även utanför
                stadens kärna. Ni fångar kunder i hela er region, inte bara centralorten.
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 2v20" />
                  <path d="M2 12h20" />
                </svg>
              </div>
              <h4>Snabbare sajt = bättre konvertering</h4>
              <p>
                Varje sekund i kortare laddtid = ca 10 % fler konverterade besökare. Moderna bildformat,
                CDN och cache ger Lighthouse Performance 85+ på mobil.
              </p>
            </div>
            <div className="vision-card">
              <div className="ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 2s3 4 3 7a3 3 0 0 1-6 0c0-3 3-7 3-7Z" />
                  <path d="M5 18a7 7 0 1 0 14 0Z" />
                </svg>
              </div>
              <h4>Trovärdighet som stänger affärer</h4>
              <p>
                Dedikerad referenssida + case på tjänstesidorna. Kunder som googlar er hittar social proof
                på 30 sekunders skanning — och väljer er framför konkurrenten.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="cta-section">
          <h2>Vill ni att vi fixar det här?</h2>
          <p>30-min gratis genomgång där vi går igenom rapporten och visar exakt hur vi hade löst varje punkt.</p>
          <ul className="cta-list">
            <li>Teknisk SEO-grund: HTTPS, schema.org, sitemap, mobilanpassning</li>
            <li>Djupa tjänstesidor + ortsidor för lokal ranking</li>
            <li>Kontaktformulär + offertformulär öppet dygnet runt</li>
            <li>Google Business Profile-optimering (om ej redan gjort)</li>
            <li>Löpande SEO-arbete efter lansering — inte bara bygga och lämna</li>
          </ul>
          <div className="cta-buttons">
            <a
              className="cta-btn cta-btn-primary"
              href={`mailto:${brand.email}?subject=${encodeURIComponent(`Audit för ${lead.name}`)}&body=${encodeURIComponent(
                `Hej!\n\nJag såg er SEO-rapport: ${brand.website}\n\nJag vill boka 30 min gratis genomgång.\n\nMvh`
              )}`}
            >
              Boka 30-min genomgång
            </a>
            <a className="cta-btn cta-btn-ghost" href={`tel:${brand.phone.replace(/\s/g, "")}`}>
              Ring {brand.phone}
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="audit-footer">
          <div className="footer-grid">
            <div>
              <strong>Bolag</strong>
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
                    <br />★ {lead.rating.toFixed(1)} på Google
                    {lead.reviews != null && ` · ${lead.reviews} recensioner`}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>Analyserad domän</strong>
              <span>
                {domain ?? "—"}
                {lead.tech_stack && (
                  <>
                    <br />
                    Plattform: {lead.tech_stack}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>Bransch</strong>
              <span>
                {lead.branch ?? "—"}
                {lead.sni_code && (
                  <>
                    <br />
                    SNI: {lead.sni_code}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>Analyserad av</strong>
              <span>
                {brand.name}
                <br />
                {brand.email}
              </span>
            </div>
          </div>
          <div className="footer-copy">
            <p>
              Rapport av{" "}
              <Link href={brand.website} target="_blank" rel="noopener">
                {brand.name}
              </Link>{" "}
              · {brand.phone} · {brand.email}
            </p>
          </div>
        </div>

        <div className="deadline">Konfidentiellt arbetsmaterial · rapport genererad {formatToday()}.</div>
      </div>
    </div>
  );
}
