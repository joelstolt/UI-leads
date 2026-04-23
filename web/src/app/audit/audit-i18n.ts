/**
 * Översättningar för audit-rapport — SV + EN.
 *
 * All användarvänlig copy ligger här. Ingen sträng hårdkodas i page.tsx,
 * audit-html.ts eller audit-data.ts — istället hämtas via `t(lang)`.
 *
 * `lang` kommer alltid från `brand.language` (wlm-se = sv, wlm-ie = en,
 * flodo = sv).
 */

export type Lang = "sv" | "en";

export type Strings = {
  // Header
  seoAnalysis: string;
  reportGenerated: string;
  noWebsite: string;
  googleRating: string;
  orgNr: string;
  employees: string;

  // Score
  seoHealth: string;
  gradeFailing: string;
  checksFailedOf: (failed: number, total: number, issues: number) => string;

  // Summary
  summary: string;
  summaryAnalyzedPrefix: string;
  summaryYourDigitalPresence: string;
  summaryWithSameChecks: string;
  summaryFoundIssues: (issues: number, critical: number) => string;
  summaryAllGood: string;

  // Issues section
  issuesHeading: (n: number) => string;
  issuesSubtitle: string;
  showAll: string;
  hide: string;

  // Checks section
  checksHeading: (n: number) => string;
  checksSubtitle: (failed: number, total: number) => string;
  showChecklist: string;
  statusCol: string;

  // Vision section
  visionHeading: string;
  visionIntro: string;
  visionCards: {
    ranking: { title: string; body: (branch: string, city: string) => string };
    richSnippets: { title: string; body: string };
    requests24_7: { title: string; body: string };
    localAuthority: { title: string; body: string };
    performance: { title: string; body: string };
    credibility: { title: string; body: string };
  };
  visionDefaultBranch: string;
  visionDefaultCity: string;

  // CTA
  ctaHeading: string;
  ctaLead: string;
  ctaList: string[];
  ctaMailSubject: (name: string) => string;
  ctaMailBody: (website: string) => string;
  ctaButtonPrimary: string;
  ctaButtonCall: string;

  // Footer
  footerCompany: string;
  footerDomain: string;
  footerDomainEmpty: string;
  footerPlatform: string;
  footerBranch: string;
  footerAnalyzedBy: string;
  footerReportBy: string;
  footerReviews: string;
  footerGoogleStar: string;
  footerConfidential: string;

  // Grade labels
  gradeA: string;
  gradeB: string;
  gradeC: string;
  gradeD: string;
  gradeNeedsImprovement: string;

  // Severity labels
  severityCritical: string;
  severityHigh: string;
  severityMed: string;

  // Check labels
  checks: {
    https: string;
    viewport: string;
    mobileFriendly: string;
    schema: string;
    sitemap: string;
    robotsSitemap: string;
    robotsNotBlocking: string;
    performance80: string;
    seo90: string;
    a11y80: string;
    emailVisible: string;
    domainRank2: string;
    sitemap10: string;
  };

  // Issue copy
  issues: {
    noHttps: { title: string; konsekvens: (name: string) => string; losning: string };
    noViewport: { title: string; konsekvens: string; losning: string };
    notMobileFriendly: { title: string; konsekvens: string; losning: string };
    perfCritical: { title: (p: number) => string; konsekvens: (p: number) => string; losning: string };
    perfHigh: { title: (p: number) => string; konsekvens: (p: number) => string; losning: string };
    seoCritical: { title: (s: number) => string; konsekvens: (s: number) => string; losning: string };
    seoHigh: { title: (s: number) => string; konsekvens: (s: number) => string; losning: string };
    noSchema: { title: string; konsekvens: string; losning: string };
    noSitemap: { title: string; konsekvens: string; losning: string };
    thinSitemap: { title: (n: number) => string; konsekvens: (n: number) => string; losning: string };
    robotsDisallow: { title: string; konsekvens: string; losning: string };
    noEmail: { title: string; konsekvens: string; losning: string };
    lockedPlatform: { title: (platform: string) => string; konsekvens: (platform: string) => string; losning: string };
    lowDomainRank: { title: (dr: string) => string; konsekvens: (dr: string) => string; losning: string };
    siteDown: { title: string; konsekvens: string; losning: string };
  };

  // Category bar labels
  barLabels: {
    performance: string;
    seo: string;
    accessibility: string;
    domainRank: string;
    content: string;
  };
};

const sv: Strings = {
  seoAnalysis: "SEO-analys",
  reportGenerated: "Rapport genererad",
  noWebsite: "Ingen hemsida registrerad",
  googleRating: "Google-betyg:",
  orgNr: "Org.nr:",
  employees: "Anställda:",

  seoHealth: "SEO-hälsa",
  gradeFailing: "Behöver förbättras",
  checksFailedOf: (failed, total, issues) =>
    `${failed} av ${total} kontrollpunkter misslyckas · ${issues} brister`,

  summary: "Sammanfattning",
  summaryAnalyzedPrefix: "Vi har analyserat ",
  summaryYourDigitalPresence: "er digitala närvaro",
  summaryWithSameChecks: " med samma kontroller som Google Search Console och Lighthouse. ",
  summaryFoundIssues: (issues, critical) =>
    `Vi hittade ${issues} konkreta brister — ${critical} kritiska — som direkt kostar er kunder varje dag.`,
  summaryAllGood:
    "Tekniskt sett ser det mesta bra ut. Vi kan ändå hjälpa er växa genom innehåll, annonser eller konvertering.",

  issuesHeading: (n) => `${n} saker som kostar er kunder idag`,
  issuesSubtitle: "Sorterade efter hur mycket de påverkar er synlighet och konvertering. Alla är fixbara.",
  showAll: "Visa alla",
  hide: "Dölj",

  checksHeading: (n) => `${n} SEO-kontrollpunkter`,
  checksSubtitle: (failed, total) =>
    `Samma kontroller som Google Search Console — **${failed} av ${total} misslyckas** idag.`,
  showChecklist: "Visa checklistan",
  statusCol: "Status",

  visionHeading: "Vad öppnar sig när vi fixat detta",
  visionIntro: "Inom 3-6 månader med rätt teknisk grund och kontinuerlig närvaro — vad ni kan räkna med:",
  visionCards: {
    ranking: {
      title: "Ranking på lokala nyckelord",
      body: (branch, city) =>
        `Sökningar som "${branch} ${city}" — där era konkurrenter ligger idag — blir möjliga att nå med rätt tjänste- + ort-sidor.`,
    },
    richSnippets: {
      title: "Rich Snippets i sökresultaten",
      body:
        "Schema.org-markup visar ert Google-betyg, öppettider och tjänster direkt i sökresultaten. FAQ-schema ger expanderbara utdrag som tar mer plats.",
    },
    requests24_7: {
      title: "Fler förfrågningar dygnet runt",
      body:
        "Dedikerat offertformulär med tjänsteval och tidsram — öppet 24/7 även när telefonen ligger på laddning. Strukturerade leads som kan följas upp nästa dag.",
    },
    localAuthority: {
      title: "Lokal auktoritet som konkurrensfördel",
      body:
        "Ortsspecifika sidor med lokal copy bygger relevans i Googles lokala 3-pack — även utanför stadens kärna. Ni fångar kunder i hela er region, inte bara centralorten.",
    },
    performance: {
      title: "Snabbare sajt = bättre konvertering",
      body:
        "Varje sekund i kortare laddtid = ca 10 % fler konverterade besökare. Moderna bildformat, CDN och cache ger Lighthouse Performance 85+ på mobil.",
    },
    credibility: {
      title: "Trovärdighet som stänger affärer",
      body:
        "Dedikerad referenssida + case på tjänstesidorna. Kunder som googlar er hittar social proof på 30 sekunders skanning — och väljer er framför konkurrenten.",
    },
  },
  visionDefaultBranch: "er tjänst",
  visionDefaultCity: "er ort",

  ctaHeading: "Vill ni att vi fixar det här?",
  ctaLead: "30-min gratis genomgång där vi går igenom rapporten och visar exakt hur vi hade löst varje punkt.",
  ctaList: [
    "Teknisk SEO-grund: HTTPS, schema.org, sitemap, mobilanpassning",
    "Djupa tjänstesidor + ortsidor för lokal ranking",
    "Kontaktformulär + offertformulär öppet dygnet runt",
    "Google Business Profile-optimering (om ej redan gjort)",
    "Löpande SEO-arbete efter lansering — inte bara bygga och lämna",
  ],
  ctaMailSubject: (name) => `Audit för ${name}`,
  ctaMailBody: (website) =>
    `Hej!\n\nJag såg er SEO-rapport: ${website}\n\nJag vill boka 30 min gratis genomgång.\n\nMvh`,
  ctaButtonPrimary: "Boka 30-min genomgång",
  ctaButtonCall: "Ring",

  footerCompany: "Bolag",
  footerDomain: "Analyserad domän",
  footerDomainEmpty: "—",
  footerPlatform: "Plattform:",
  footerBranch: "Bransch",
  footerAnalyzedBy: "Analyserad av",
  footerReportBy: "Rapport av",
  footerReviews: "recensioner",
  footerGoogleStar: "på Google",
  footerConfidential: "Konfidentiellt arbetsmaterial · rapport genererad",

  gradeA: "Grade A",
  gradeB: "Grade B",
  gradeC: "Grade C",
  gradeD: "Grade D",
  gradeNeedsImprovement: "Behöver förbättras",

  severityCritical: "Kritiskt",
  severityHigh: "Hög",
  severityMed: "Medel",

  checks: {
    https: "HTTPS / SSL aktiverat",
    viewport: "Mobil viewport-tagg finns",
    mobileFriendly: "Mobilvänlig enligt Google (tap-targets, textstorlek)",
    schema: "Strukturerad data (schema.org / JSON-LD)",
    sitemap: "Sitemap.xml finns och innehåller sidor",
    robotsSitemap: "robots.txt pekar på sitemap",
    robotsNotBlocking: "robots.txt blockar inte Google",
    performance80: "Performance ≥ 80 (snabb laddning)",
    seo90: "SEO-score ≥ 90",
    a11y80: "Accessibility ≥ 80",
    emailVisible: "E-postadress synlig på sajten",
    domainRank2: "Domain Rank ≥ 2 (etablerad auktoritet)",
    sitemap10: "Minst 10 sidor i sitemap (innehållsrik)",
  },

  issues: {
    noHttps: {
      title: "Sajten använder inte HTTPS",
      konsekvens: (name) =>
        `⚠ ${name}s sajt körs på http:// — inte krypterad. Besökare ser "Ej säker" i adressfältet (Chrome, Safari, Firefox varnar). Google rankar HTTP-sidor lägre sedan 2014 och varnar i sökresultaten. Kontaktformulär och mejladresser blir osäkra.`,
      losning:
        "✓ Vi flyttar sajten till HTTPS via Let's Encrypt — automatiskt påslaget och gratis. Alla länkar och formulär blir säkra från dag ett.",
    },
    noViewport: {
      title: "Ingen viewport-tagg — sajten är inte mobilvänlig",
      konsekvens:
        "⚠ Sajten saknar <meta name=\"viewport\"> — på mobil renderas den i desktop-bredd. Besökare tvingas zooma in och scrolla horisontellt. Google använder mobile-first-indexering sedan 2021. 65 %+ av era besökare kommer från mobil och tappar direkt.",
      losning:
        "✓ Mobile-first-redesign med responsiv layout, sticky header, tap-to-call och hamburger-meny. Testad på iOS, Android och iPad. Lighthouse mobil ≥ 90.",
    },
    notMobileFriendly: {
      title: "Sajten är inte mobilvänlig (enligt Google)",
      konsekvens:
        "⚠ Google klassificerar sajten som icke-mobilvänlig (dåliga tap-targets eller för liten textstorlek). Mobilanvändare kämpar — och 70 % av sökningar sker på mobil. Ni tappar majoriteten av trafiken innan den hinner konvertera.",
      losning:
        "✓ Responsiv design med rätt tap-targets (min 44 px), läsbar textstorlek utan zoom, optimerad navigering för mobilen. Passerar Googles mobilvänlighetstest.",
    },
    perfCritical: {
      title: (p) => `Hemsidan är för långsam (Performance ${p}/100)`,
      konsekvens: (p) =>
        `⚠ PageSpeed Performance: ${p}/100. Snittet för välkonverterande sajter är 80+. Varje sekund extra laddtid tappar ca 10 % av besökare. Google rankar långsamma sajter lägre, särskilt på mobil.`,
      losning:
        "✓ Bildoptimering (WebP/AVIF + lazy-load), kodminifiering, CDN och cache-strategi. Förbättring inom 1-2 veckor. Mål: Performance ≥ 85.",
    },
    perfHigh: {
      title: (p) => `Hemsidan kan bli snabbare (Performance ${p}/100)`,
      konsekvens: (p) =>
        `⚠ Performance ${p}/100 är okej men inte bra. Varje sekund i laddtid = ca 10 % färre konverterade besökare.`,
      losning: "✓ Bildkomprimering + CDN + cache = snabb-fix. Når ofta 90+ på några timmar.",
    },
    seoCritical: {
      title: (s) => `SEO-grunden är inte på plats (SEO-score ${s}/100)`,
      konsekvens: (s) =>
        `⚠ Lighthouse SEO-score: ${s}/100. Google har svårt att förstå er sajt. Title, meta-description, schema.org-markup, canonical-länkar och intern länkstruktur är bristfälliga. Ni rankar inte på något annat än ert exakta firmanamn.`,
      losning:
        "✓ Unik meta-title + meta-description per sida (50-60 tecken respektive 150-160 tecken), schema.org-markup, canonical-URLer och tydlig intern länkstruktur.",
    },
    seoHigh: {
      title: (s) => `SEO-score kan förbättras (${s}/100)`,
      konsekvens: (s) => `⚠ SEO-score ${s}/100. Fundamentet fungerar men ni lämnar Google-rankingar på bordet.`,
      losning: "✓ Finslipa meta-tags, schema.org, intern länkstruktur och H-rubriker per sida.",
    },
    noSchema: {
      title: "Ingen strukturerad data (JSON-LD schema.org)",
      konsekvens:
        "⚠ Sajten saknar schema.org-markup. Ingen LocalBusiness, inga öppettider eller stjärnbetyg i Googles kunskapsgrafer. Ni missar Rich Results, Maps-kopplingar och möjligheten att synas i Googles lokala 3-pack.",
      losning:
        "✓ Komplett JSON-LD: LocalBusiness/Service-schema med öppettider, adress, telefon, areaServed; FAQPage-schema på FAQ-sidan; BreadcrumbList på djupare sidor; AggregateRating för ert Google-betyg.",
    },
    noSitemap: {
      title: "Sajten har ingen sitemap.xml",
      konsekvens:
        "⚠ Ingen sitemap hittades på /sitemap.xml eller via robots.txt. Google måste hitta alla era sidor via länkar istället — många blir inte alls indexerade. Ni syns bara på Google för ert firmanamn, inte för tjänste- eller ortsökord.",
      losning:
        "✓ Auto-genererad sitemap.xml som listar alla sidor med prioritet och uppdateringsfrekvens. Skickas in till Google Search Console så alla sidor indexeras inom 1-2 veckor.",
    },
    thinSitemap: {
      title: (n) => `Tunt innehåll: bara ${n} sidor i sitemap`,
      konsekvens: (n) =>
        `⚠ Er sitemap listar ${n} sidor. Google favoriserar sajter med djupt, ämnesrikt innehåll. Konkurrenter med 30-100 sidor (tjänster × orter × FAQ) vinner sökningarna.`,
      losning:
        "✓ 20+ innehållsrika sidor: djupa tjänstesidor (500-800 ord/st), ortssidor per region ni arbetar i, FAQ, case och om-oss. Skrivs för nyckelord era kunder faktiskt söker på.",
    },
    robotsDisallow: {
      title: "robots.txt blockar Google från att läsa sajten",
      konsekvens:
        "⚠ Er robots.txt har Disallow: / vilket stänger av hela sajten från Googles sökrobot. Sajten indexeras inte alls. Det här är antagligen en kvarglömd dev-inställning.",
      losning:
        "✓ Vi fixar robots.txt och skickar en ny crawl-begäran till Google — sajten börjar synas igen inom några dagar.",
    },
    noEmail: {
      title: "Ingen e-postadress synlig på sajten",
      konsekvens:
        "⚠ Vi hittade ingen e-postadress på er hemsida. Kunder som vill kontakta er digitalt (kvällar, helger) fastnar. Offertförfrågningar går förlorade.",
      losning:
        "✓ Tydlig mail-länk i header och footer + kontaktformulär som skickar direkt till er inbox. Öppet dygnet runt även när telefonen ligger på laddning.",
    },
    lockedPlatform: {
      title: (platform) => `${platform}-plattformen begränsar er SEO`,
      konsekvens: (platform) =>
        `⚠ ${platform} är låst — ni kan inte optimera server-svar, kontrollera schema.org fullt ut, eller migrera till snabbare hosting. Sökmotoroptimeringen blir ytlig och ni är fast i plattformens prissättning.`,
      losning:
        "✓ Migration till WordPress eller Next.js: full kontroll över SEO, snabbare sajt, inga månadsavgifter till plattformen. Vi tar hand om allt — inga nedtider och era sidor indexeras på nytt direkt.",
    },
    lowDomainRank: {
      title: (dr) => `Låg domän-auktoritet (DR ${dr}/10)`,
      konsekvens: (dr) =>
        `⚠ Domain Rank ${dr}/10 betyder att Google inte har någon starkt signal om att er sajt är trovärdig. Ni konkurrerar mot lokala konkurrenter som har 2-4 i DR och vinner därför sökningarna.`,
      losning:
        "✓ Systematisk länkbyggnad: anmälan till branschkataloger, lokala tidningsinslag, partnerlänkar, gästbloggningar och PR. Målet är DR 3+ inom 6 månader.",
    },
    siteDown: {
      title: "Sajten svarar inte — är den nere?",
      konsekvens:
        "⚠ Vi kunde inte ladda er hemsida — sajten svarar med fel (4xx/5xx) eller timeout. Varje minut den är nere = förlorade kunder. Google avindexerar sidor som varit nere för länge.",
      losning:
        "✓ Akut-check av hosting, DNS och SSL. Vi återställer sajten inom 24 h eller flyttar till stabil infrastruktur på Vercel/Netlify.",
    },
  },

  barLabels: {
    performance: "Performance",
    seo: "SEO",
    accessibility: "Accessibility",
    domainRank: "Domain Rank",
    content: "Innehåll (sitemap-sidor)",
  },
};

const en: Strings = {
  seoAnalysis: "SEO Analysis",
  reportGenerated: "Report generated",
  noWebsite: "No website registered",
  googleRating: "Google rating:",
  orgNr: "Reg. no.:",
  employees: "Employees:",

  seoHealth: "SEO health",
  gradeFailing: "Needs improvement",
  checksFailedOf: (failed, total, issues) =>
    `${failed} of ${total} checks failing · ${issues} issues`,

  summary: "Summary",
  summaryAnalyzedPrefix: "We've analysed ",
  summaryYourDigitalPresence: "your digital presence",
  summaryWithSameChecks: " using the same checks as Google Search Console and Lighthouse. ",
  summaryFoundIssues: (issues, critical) =>
    `We found ${issues} concrete issues — ${critical} critical — that directly cost you customers every day.`,
  summaryAllGood:
    "Technically most things look good. We can still help you grow through content, ads or conversion optimisation.",

  issuesHeading: (n) => `${n} things costing you customers today`,
  issuesSubtitle: "Sorted by how much they impact your visibility and conversion. All are fixable.",
  showAll: "Show all",
  hide: "Hide",

  checksHeading: (n) => `${n} SEO checks`,
  checksSubtitle: (failed, total) =>
    `The same checks as Google Search Console — **${failed} of ${total} failing** today.`,
  showChecklist: "Show checklist",
  statusCol: "Status",

  visionHeading: "What opens up once this is fixed",
  visionIntro: "Within 3-6 months with the right technical foundation and continuous presence — what you can expect:",
  visionCards: {
    ranking: {
      title: "Ranking on local keywords",
      body: (branch, city) =>
        `Searches like "${branch} ${city}" — where your competitors sit today — become reachable with the right service + location pages.`,
    },
    richSnippets: {
      title: "Rich snippets in search results",
      body:
        "Schema.org markup shows your Google rating, opening hours and services directly in search results. FAQ schema gives expandable snippets that take up more space.",
    },
    requests24_7: {
      title: "More enquiries around the clock",
      body:
        "A dedicated quote form with service selection and timeframe — open 24/7 even when the phone is charging. Structured leads you can follow up the next day.",
    },
    localAuthority: {
      title: "Local authority as a competitive edge",
      body:
        "Location-specific pages with local copy build relevance in Google's local 3-pack — even outside the city core. You reach customers across your whole region, not just the centre.",
    },
    performance: {
      title: "Faster site = better conversion",
      body:
        "Every second of load time = roughly 10% more converted visitors. Modern image formats, CDN and caching deliver Lighthouse Performance 85+ on mobile.",
    },
    credibility: {
      title: "Credibility that closes deals",
      body:
        "A dedicated reference page + case studies on service pages. Customers who Google you find social proof within a 30-second scan — and pick you over the competitor.",
    },
  },
  visionDefaultBranch: "your service",
  visionDefaultCity: "your area",

  ctaHeading: "Want us to fix this?",
  ctaLead: "30-min free walkthrough where we go through the report and show you exactly how we'd solve each point.",
  ctaList: [
    "Technical SEO foundation: HTTPS, schema.org, sitemap, mobile optimisation",
    "Deep service pages + location pages for local ranking",
    "Contact form + quote form open around the clock",
    "Google Business Profile optimisation (if not already done)",
    "Ongoing SEO work after launch — not just build and leave",
  ],
  ctaMailSubject: (name) => `Audit for ${name}`,
  ctaMailBody: (website) =>
    `Hi!\n\nI saw your SEO report: ${website}\n\nI'd like to book a 30-min free walkthrough.\n\nThanks`,
  ctaButtonPrimary: "Book 30-min walkthrough",
  ctaButtonCall: "Call",

  footerCompany: "Company",
  footerDomain: "Analysed domain",
  footerDomainEmpty: "—",
  footerPlatform: "Platform:",
  footerBranch: "Industry",
  footerAnalyzedBy: "Analysed by",
  footerReportBy: "Report by",
  footerReviews: "reviews",
  footerGoogleStar: "on Google",
  footerConfidential: "Confidential working material · report generated",

  gradeA: "Grade A",
  gradeB: "Grade B",
  gradeC: "Grade C",
  gradeD: "Grade D",
  gradeNeedsImprovement: "Needs improvement",

  severityCritical: "Critical",
  severityHigh: "High",
  severityMed: "Medium",

  checks: {
    https: "HTTPS / SSL enabled",
    viewport: "Mobile viewport tag present",
    mobileFriendly: "Mobile-friendly per Google (tap targets, text size)",
    schema: "Structured data (schema.org / JSON-LD)",
    sitemap: "sitemap.xml present and contains pages",
    robotsSitemap: "robots.txt points to sitemap",
    robotsNotBlocking: "robots.txt does not block Google",
    performance80: "Performance ≥ 80 (fast loading)",
    seo90: "SEO score ≥ 90",
    a11y80: "Accessibility ≥ 80",
    emailVisible: "Email address visible on site",
    domainRank2: "Domain Rank ≥ 2 (established authority)",
    sitemap10: "At least 10 pages in sitemap (content-rich)",
  },

  issues: {
    noHttps: {
      title: "Site doesn't use HTTPS",
      konsekvens: (name) =>
        `⚠ ${name}'s site runs on http:// — not encrypted. Visitors see "Not secure" in the address bar (Chrome, Safari, Firefox all warn). Google has ranked HTTP pages lower since 2014 and warns in search results. Contact forms and email addresses become insecure.`,
      losning:
        "✓ We move the site to HTTPS via Let's Encrypt — automatically enabled and free. All links and forms become secure from day one.",
    },
    noViewport: {
      title: "No viewport tag — site is not mobile-friendly",
      konsekvens:
        "⚠ The site is missing <meta name=\"viewport\"> — on mobile it renders at desktop width. Visitors have to pinch-zoom and scroll sideways. Google has used mobile-first indexing since 2021. 65%+ of your visitors come from mobile and bounce immediately.",
      losning:
        "✓ Mobile-first redesign with responsive layout, sticky header, tap-to-call and hamburger menu. Tested on iOS, Android and iPad. Lighthouse mobile ≥ 90.",
    },
    notMobileFriendly: {
      title: "Site is not mobile-friendly (per Google)",
      konsekvens:
        "⚠ Google classifies the site as not mobile-friendly (poor tap targets or text too small). Mobile users struggle — and 70% of searches happen on mobile. You lose most of the traffic before it can convert.",
      losning:
        "✓ Responsive design with proper tap targets (min 44px), readable text size without zoom, optimised mobile navigation. Passes Google's mobile-friendly test.",
    },
    perfCritical: {
      title: (p) => `Site is too slow (Performance ${p}/100)`,
      konsekvens: (p) =>
        `⚠ PageSpeed Performance: ${p}/100. The average for high-converting sites is 80+. Every extra second of load time loses around 10% of visitors. Google ranks slow sites lower, especially on mobile.`,
      losning:
        "✓ Image optimisation (WebP/AVIF + lazy-load), code minification, CDN and cache strategy. Improvement within 1-2 weeks. Target: Performance ≥ 85.",
    },
    perfHigh: {
      title: (p) => `Site could be faster (Performance ${p}/100)`,
      konsekvens: (p) =>
        `⚠ Performance ${p}/100 is okay but not great. Every second of load time = roughly 10% fewer converted visitors.`,
      losning: "✓ Image compression + CDN + cache = quick win. Usually reaches 90+ within hours.",
    },
    seoCritical: {
      title: (s) => `SEO foundation is not in place (SEO score ${s}/100)`,
      konsekvens: (s) =>
        `⚠ Lighthouse SEO score: ${s}/100. Google has trouble understanding your site. Title, meta description, schema.org markup, canonical links and internal linking are deficient. You don't rank for anything except your exact brand name.`,
      losning:
        "✓ Unique meta title + meta description per page (50-60 chars and 150-160 chars respectively), schema.org markup, canonical URLs and clear internal linking.",
    },
    seoHigh: {
      title: (s) => `SEO score could be improved (${s}/100)`,
      konsekvens: (s) => `⚠ SEO score ${s}/100. The foundation works but you're leaving Google rankings on the table.`,
      losning: "✓ Polish meta tags, schema.org, internal linking and H-headings per page.",
    },
    noSchema: {
      title: "No structured data (JSON-LD schema.org)",
      konsekvens:
        "⚠ Site is missing schema.org markup. No LocalBusiness, no opening hours or star ratings in Google's knowledge graphs. You miss Rich Results, Maps connections and the chance to appear in Google's local 3-pack.",
      losning:
        "✓ Complete JSON-LD: LocalBusiness/Service schema with opening hours, address, phone, areaServed; FAQPage schema on the FAQ page; BreadcrumbList on deeper pages; AggregateRating for your Google rating.",
    },
    noSitemap: {
      title: "Site has no sitemap.xml",
      konsekvens:
        "⚠ No sitemap found at /sitemap.xml or via robots.txt. Google has to discover all your pages via links instead — many don't get indexed at all. You only appear in Google for your brand name, not for service or location keywords.",
      losning:
        "✓ Auto-generated sitemap.xml listing all pages with priority and update frequency. Submitted to Google Search Console so all pages are indexed within 1-2 weeks.",
    },
    thinSitemap: {
      title: (n) => `Thin content: only ${n} pages in sitemap`,
      konsekvens: (n) =>
        `⚠ Your sitemap lists ${n} pages. Google favours sites with deep, topical content. Competitors with 30-100 pages (services × locations × FAQ) win the searches.`,
      losning:
        "✓ 20+ content-rich pages: deep service pages (500-800 words each), location pages per region you serve, FAQ, case studies and about. Written for keywords your customers actually search for.",
    },
    robotsDisallow: {
      title: "robots.txt blocks Google from reading the site",
      konsekvens:
        "⚠ Your robots.txt has Disallow: / which shuts the whole site off from Google's crawler. The site isn't indexed at all. This is probably a leftover dev setting.",
      losning: "✓ We fix robots.txt and request a new crawl from Google — the site reappears within a few days.",
    },
    noEmail: {
      title: "No email address visible on the site",
      konsekvens:
        "⚠ We found no email address on your site. Customers who want to contact you digitally (evenings, weekends) get stuck. Quote requests get lost.",
      losning:
        "✓ Clear mail link in header and footer + contact form that sends directly to your inbox. Open 24/7 even when the phone is charging.",
    },
    lockedPlatform: {
      title: (platform) => `${platform} platform limits your SEO`,
      konsekvens: (platform) =>
        `⚠ ${platform} is locked down — you can't optimise server responses, fully control schema.org, or migrate to faster hosting. SEO stays shallow and you're stuck in the platform's pricing.`,
      losning:
        "✓ Migration to WordPress or Next.js: full SEO control, faster site, no monthly fees to the platform. We handle everything — no downtime and your pages get reindexed right away.",
    },
    lowDomainRank: {
      title: (dr) => `Low domain authority (DR ${dr}/10)`,
      konsekvens: (dr) =>
        `⚠ Domain Rank ${dr}/10 means Google has no strong signal that your site is trustworthy. You compete against local rivals with DR 2-4, who win the searches accordingly.`,
      losning:
        "✓ Systematic link-building: industry directory submissions, local press mentions, partner links, guest posts and PR. Target: DR 3+ within 6 months.",
    },
    siteDown: {
      title: "Site is not responding — is it down?",
      konsekvens:
        "⚠ We couldn't load your site — it's responding with an error (4xx/5xx) or timing out. Every minute it's down = lost customers. Google de-indexes pages that have been down too long.",
      losning:
        "✓ Urgent check of hosting, DNS and SSL. We restore the site within 24 h or move it to stable infrastructure on Vercel/Netlify.",
    },
  },

  barLabels: {
    performance: "Performance",
    seo: "SEO",
    accessibility: "Accessibility",
    domainRank: "Domain Rank",
    content: "Content (sitemap pages)",
  },
};

const STRINGS: Record<Lang, Strings> = { sv, en };

export function t(lang: Lang | string | undefined): Strings {
  if (lang === "en") return en;
  return sv;
}

export function formatDate(lang: Lang | string | undefined): string {
  const locale = lang === "en" ? "en-GB" : "sv-SE";
  return new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}
