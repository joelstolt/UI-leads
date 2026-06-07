#!/usr/bin/env node
/**
 * redo-pilot/enrich.js — analyserar hemsidan för alla prospects i sweet spot:
 *
 *   • Tech-stack (WordPress/Wix/Squarespace/Webflow/One.com/Hemsida24/Jimdo/…)
 *   • WP-tema + generic-mall-flagga (Astra/Divi/GeneratePress/Twenty/Hello-Elementor)
 *   • JSON-LD schema yes/no
 *   • og:image, viewport, meta description
 *   • <title> innehåller "redovisning"/"bokföring"/"revisor" + Malmö
 *   • Google Analytics + FB Pixel
 *   • TLS-cert ålder (NotBefore → dagar)
 *   • Senaste blog-post via sitemap-/blog-/nyheter-URL
 *   • PageSpeed Mobile (performance/seo/a11y) + mobile-friendly flagga
 *
 * Två fetch:ar per bolag (sajt + PageSpeed), max 4 parallellt.
 *
 * Användning:
 *   node redo-pilot/enrich.js               → alla i sweet spot utan enriched_at
 *   node redo-pilot/enrich.js --recheck     → kör om även de som redan checkats
 *   node redo-pilot/enrich.js --limit 5
 */

require("dotenv").config({ override: true });
const tls = require("node:tls");
const pLimit = require("p-limit");
const pRetry = require("p-retry");
const { getDb } = require("./db");
const { REVENUE_MIN, REVENUE_MAX, EMPLOYEES_MIN, EMPLOYEES_MAX } = require("./config");

const PSI_KEY = process.env.PAGESPEED_API_KEY || "";
const SITE_TIMEOUT = 12000;
const PSI_TIMEOUT = 45000;

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

// ════════════════════════════════════════════════════════════════════
// Tech-detection (samma logik som leadsgoogle/enrich-tech.js +
// enrich-website-extras.js, men med tema-detection ovanpå)
// ════════════════════════════════════════════════════════════════════

function detectStack(html, headers) {
  const h = html.toLowerCase();
  const gen = (html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)/i) || [])[1] || "";
  const g = gen.toLowerCase();
  const xPB = (headers.get("x-powered-by") || "").toLowerCase();

  if (g.includes("wix") || h.includes("wixstatic.com")) return "wix";
  if (g.includes("squarespace") || h.includes("squarespace-cdn.com")) return "squarespace";
  if (h.includes("cdn.shopify.com") || h.includes("/shopifycloud/")) return "shopify";
  if (g.includes("webflow") || h.includes('data-wf-page="') || h.includes("assets.website-files.com")) return "webflow";
  if (h.includes("sitevision") || (headers.get("server") || "").toLowerCase().includes("sitevision")) return "sitevision";
  if (h.includes("hemsida24") || h.includes("loopiapagebuilder")) return "hemsida24";
  if (h.includes("one.com/pagebuilder") || h.includes("powered by one.com")) return "one.com";
  if (h.includes("jimdo.com") || h.includes("data-jimdo")) return "jimdo";
  if (h.includes("strikinglycdn") || h.includes("strikingly.com")) return "strikingly";
  if (h.includes("godaddysites.com")) return "godaddy";
  if (h.includes("yola.com")) return "yola";
  if (g.includes("joomla") || h.includes("/components/com_")) return "joomla";
  if (g.includes("drupal") || h.includes("drupal-settings-json")) return "drupal";
  if (
    g.includes("wordpress") ||
    h.includes("/wp-content/") ||
    h.includes("/wp-includes/") ||
    h.includes("/wp-json/")
  )
    return "wordpress";
  if (h.includes("__next_data__") || h.includes("/_next/static/")) return "nextjs";
  if (xPB.includes("php")) return "php-custom";
  if (xPB.includes("asp.net")) return "aspnet";
  const scriptCount = (html.match(/<script/gi) || []).length;
  if (scriptCount <= 3) return "plain-html";
  return "custom";
}

// Generic WordPress-mallar — säljvinkeln "ingen ansträngning lagd"
const GENERIC_WP_THEMES = new Set([
  "astra", "divi", "generatepress", "hello-elementor", "elementor-pro",
  "twentytwenty", "twentytwentyone", "twentytwentytwo", "twentytwentythree",
  "twentytwentyfour", "twentytwentyfive", "twentynineteen", "twentyseventeen",
  "twentysixteen", "twentyfifteen", "oceanwp", "neve", "blocksy", "kadence",
  "storefront", "sydney", "colormag",
]);

function detectWpTheme(html) {
  // /wp-content/themes/<slug>/...
  const m = html.match(/\/wp-content\/themes\/([a-z0-9_\-]+)\//i);
  if (!m) return { theme: null, generic: null };
  const slug = m[1].toLowerCase();
  return { theme: slug, generic: GENERIC_WP_THEMES.has(slug) ? 1 : 0 };
}

function detectGA(html) {
  const h = html.toLowerCase();
  return h.includes("google-analytics.com") ||
    h.includes("googletagmanager.com") ||
    h.includes("gtag(") ||
    /['"]g-[a-z0-9]{8,}['"]/i.test(h) ||
    /['"]ua-\d{4,}-\d{1,}['"]/i.test(h)
    ? 1
    : 0;
}

function detectFbPixel(html) {
  const h = html.toLowerCase();
  return h.includes("connect.facebook.net") || h.includes("fbq(") ? 1 : 0;
}

function checkSchema(html) {
  return /<script[^>]*type=["']application\/ld\+json["']/i.test(html) ||
    /itemscope[\s>]/i.test(html)
    ? 1
    : 0;
}

function checkOgImage(html) {
  return /<meta[^>]+property=["']og:image["']/i.test(html) ? 1 : 0;
}

function checkViewport(html) {
  return /<meta[^>]+name=["']viewport["']/i.test(html) ? 1 : 0;
}

function checkMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
  if (!m) return 0;
  const desc = m[1].trim();
  if (desc.length < 40) return 0;
  // Filtrera vanliga generiska "vi erbjuder bokföring, deklaration..."
  const lower = desc.toLowerCase();
  if (/vi erbjuder (bokföring|redovisning)/.test(lower)) return 0;
  return 1;
}

function checkTitleHasCity(html, city) {
  const m = html.match(/<title[^>]*>([^<]+)/i);
  if (!m) return 0;
  const t = m[1].toLowerCase();
  const hasService = /redovisning|bokföring|revisor|byrå/.test(t);
  const hasCity = t.includes(city.toLowerCase());
  return hasService && hasCity ? 1 : 0;
}

// ════════════════════════════════════════════════════════════════════
// TLS cert ålder (dagar sedan NotBefore)
// ════════════════════════════════════════════════════════════════════

async function fetchCertAge(hostname) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        timeout: 5000,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_from) {
            resolve(null);
          } else {
            const notBefore = new Date(cert.valid_from);
            const ageDays = Math.round((Date.now() - notBefore.getTime()) / 86400000);
            resolve(ageDays);
          }
        } catch {
          resolve(null);
        }
        socket.end();
      }
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// Senaste blogpost via sitemap / blog / nyheter
// ════════════════════════════════════════════════════════════════════

async function findLatestBlogIso(siteUrl) {
  const candidates = [
    `${siteUrl.replace(/\/$/, "")}/sitemap.xml`,
    `${siteUrl.replace(/\/$/, "")}/sitemap_index.xml`,
    `${siteUrl.replace(/\/$/, "")}/post-sitemap.xml`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": pickUA() },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      // lastmod-datum (ISO)
      const dates = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/gi)].map((m) =>
        m[1].trim()
      );
      if (dates.length === 0) continue;
      // Plocka senaste
      const parsed = dates
        .map((d) => new Date(d))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => b - a);
      if (parsed[0]) return parsed[0].toISOString();
    } catch {
      // ignore
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// Site-fetch + analys
// ════════════════════════════════════════════════════════════════════

async function analyzeSite(siteUrl, city) {
  const target = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
  const res = await fetch(target, {
    headers: {
      "User-Agent": pickUA(),
      Accept: "text/html,application/xhtml+xml,*/*",
    },
    signal: AbortSignal.timeout(SITE_TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 200) throw new Error("Body for kort");

  const finalUrl = res.url;
  const hostname = new URL(finalUrl).hostname;
  const stack = detectStack(html, res.headers);
  const wp = stack === "wordpress" ? detectWpTheme(html) : { theme: null, generic: null };

  // Parallellt: cert + blog
  const [certAge, blogIso] = await Promise.all([
    fetchCertAge(hostname),
    findLatestBlogIso(new URL(finalUrl).origin),
  ]);

  let blogStaleMonths = null;
  if (blogIso) {
    const dt = new Date(blogIso);
    blogStaleMonths = Math.round((Date.now() - dt.getTime()) / (30 * 86400000));
  }

  return {
    site_status: "ok",
    tech_stack: stack,
    wp_theme: wp.theme,
    wp_theme_generic: wp.generic,
    has_schema: checkSchema(html),
    has_og_image: checkOgImage(html),
    has_ga: detectGA(html),
    has_fb_pixel: detectFbPixel(html),
    has_viewport: checkViewport(html),
    meta_description: checkMetaDescription(html),
    title_has_city: checkTitleHasCity(html, city),
    cert_age_days: certAge,
    blog_last_iso: blogIso,
    blog_stale_months: blogStaleMonths,
  };
}

// ════════════════════════════════════════════════════════════════════
// PageSpeed Mobile
// ════════════════════════════════════════════════════════════════════

async function analyzePagespeed(websiteUrl) {
  const cleanUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
  const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  apiUrl.searchParams.set("url", cleanUrl);
  apiUrl.searchParams.set("strategy", "mobile");
  apiUrl.searchParams.append("category", "performance");
  apiUrl.searchParams.append("category", "seo");
  apiUrl.searchParams.append("category", "accessibility");
  if (PSI_KEY) apiUrl.searchParams.set("key", PSI_KEY);

  const data = await pRetry(
    async () => {
      const res = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(PSI_TIMEOUT) });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json;
    },
    { retries: 2, minTimeout: 3000 }
  );

  const cats = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};
  const viewportScore = audits["viewport"]?.score ?? 0;
  const tapScore = audits["tap-targets"]?.score ?? 1;
  const fontSizeScore = audits["font-size"]?.score ?? 1;
  const mobileOk =
    viewportScore === 1 && tapScore >= 0.8 && fontSizeScore >= 0.8 ? 1 : 0;

  return {
    ps_performance: Math.round((cats.performance?.score || 0) * 100),
    ps_seo: Math.round((cats.seo?.score || 0) * 100),
    ps_accessibility: Math.round((cats.accessibility?.score || 0) * 100),
    ps_mobile_ok: mobileOk,
  };
}

// ════════════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════════════

function getProspectsToEnrich(opts) {
  // Default: alla med hemsida (ej kedjor). Använd --sweet-spot för att begränsa.
  const where = [
    "website IS NOT NULL",
    "website != ''",
    "(is_chain IS NULL OR is_chain = 0)",
  ];
  if (opts.sweetSpot) {
    where.push(`revenue BETWEEN ${REVENUE_MIN} AND ${REVENUE_MAX}`);
    where.push(`employees BETWEEN ${EMPLOYEES_MIN} AND ${EMPLOYEES_MAX}`);
  }
  if (!opts.recheck) where.push("enriched_at IS NULL");

  const sql = `SELECT org_nr, name, city, website FROM prospects
               WHERE ${where.join(" AND ")}
               ORDER BY name ASC
               ${opts.limit ? "LIMIT ?" : ""}`;
  const stmt = getDb().prepare(sql);
  return opts.limit ? stmt.all(opts.limit) : stmt.all();
}

function saveSiteResult(orgnr, data, errMsg) {
  const db = getDb();
  if (errMsg) {
    db.prepare(
      `UPDATE prospects SET
        site_status = ?, enrich_error = ?, enriched_at = datetime('now'), updated_at = datetime('now')
       WHERE org_nr = ?`
    ).run("error", errMsg.slice(0, 200), orgnr);
    return;
  }
  db.prepare(
    `UPDATE prospects SET
      site_status       = ?,
      tech_stack        = ?,
      wp_theme          = ?,
      wp_theme_generic  = ?,
      has_schema        = ?,
      has_og_image      = ?,
      has_ga            = ?,
      has_fb_pixel      = ?,
      has_viewport      = ?,
      meta_description  = ?,
      title_has_city    = ?,
      cert_age_days     = ?,
      blog_last_iso     = ?,
      blog_stale_months = ?,
      enrich_error      = NULL,
      enriched_at       = datetime('now'),
      updated_at        = datetime('now')
     WHERE org_nr = ?`
  ).run(
    data.site_status,
    data.tech_stack,
    data.wp_theme,
    data.wp_theme_generic,
    data.has_schema,
    data.has_og_image,
    data.has_ga,
    data.has_fb_pixel,
    data.has_viewport,
    data.meta_description,
    data.title_has_city,
    data.cert_age_days,
    data.blog_last_iso,
    data.blog_stale_months,
    orgnr
  );
}

function savePagespeed(orgnr, data, errMsg) {
  const db = getDb();
  if (errMsg) {
    db.prepare(
      `UPDATE prospects SET ps_at = datetime('now'), enrich_error = COALESCE(enrich_error, ?), updated_at = datetime('now')
       WHERE org_nr = ?`
    ).run(`psi: ${errMsg.slice(0, 100)}`, orgnr);
    return;
  }
  db.prepare(
    `UPDATE prospects SET
      ps_performance   = ?,
      ps_seo           = ?,
      ps_accessibility = ?,
      ps_mobile_ok     = ?,
      ps_at            = datetime('now'),
      updated_at       = datetime('now')
     WHERE org_nr = ?`
  ).run(
    data.ps_performance,
    data.ps_seo,
    data.ps_accessibility,
    data.ps_mobile_ok,
    orgnr
  );
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { recheck: false, limit: null, sweetSpot: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--recheck") opts.recheck = true;
    if (args[i] === "--sweet-spot") opts.sweetSpot = true;
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const leads = getProspectsToEnrich(opts);

  console.log("🌐 redo-pilot/enrich — sajt + PageSpeed");
  console.log(`   PSI-key:   ${PSI_KEY ? "✓" : "✗ (rate-limit, långsam)"}`);
  console.log(`   Leads:     ${leads.length}`);
  console.log(`   Parallellt: 4`);
  console.log();

  if (leads.length === 0) {
    console.log("Inget att göra (sweet spot är tom eller redan enriched).");
    return;
  }

  const limit = pLimit(4);
  let done = 0;
  let siteOk = 0;
  let siteErr = 0;
  let psOk = 0;
  let psErr = 0;

  await Promise.all(
    leads.map((lead) =>
      limit(async () => {
        // Sajt-analys
        try {
          const data = await analyzeSite(lead.website, lead.city || "Malmö");
          saveSiteResult(lead.org_nr, data, null);
          siteOk++;
        } catch (err) {
          saveSiteResult(lead.org_nr, null, err.message);
          siteErr++;
        }

        // PageSpeed
        try {
          const ps = await analyzePagespeed(lead.website);
          savePagespeed(lead.org_nr, ps, null);
          psOk++;
        } catch (err) {
          savePagespeed(lead.org_nr, null, err.message);
          psErr++;
        }

        done++;
        const pct = Math.round((done / leads.length) * 100);
        process.stdout.write(
          `\r   [${String(pct).padStart(3)}%] ${done}/${leads.length}  sajt ${siteOk}/${siteErr}  PSI ${psOk}/${psErr}    `
        );
      })
    )
  );

  console.log("\n\n✅ Enrich klar");
  console.log(`   Sajt OK:    ${siteOk}`);
  console.log(`   Sajt error: ${siteErr}`);
  console.log(`   PSI OK:     ${psOk}`);
  console.log(`   PSI error:  ${psErr}`);
}

main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
