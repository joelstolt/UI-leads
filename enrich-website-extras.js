#!/usr/bin/env node
/**
 * enrich-website-extras.js — detekterar allt extra på företagets hemsida
 * i ETT fetch-anrop per sajt:
 *
 *   • Tech-stack-utökning  (one.com, Hemsida24, Jimdo, Joomla, Drupal, Sitevision)
 *   • Chatbot-plattform    (Intercom, Drift, Tidio, Crisp, Tawk, LiveChat, Zendesk)
 *   • Bokningssystem       (Calendly, Bokadirekt, Bokamera, SimplyBook)
 *   • has_google_analytics (GA / G4)
 *   • has_facebook_pixel
 *   • has_cookie_banner    (vanlig GDPR-banner)
 *
 * Komplement till enrich-tech.js (som redan detekterar wix/wordpress/etc).
 * Körs på alla bolag (oavsett land) som har website.
 *
 * Användning:
 *   node enrich-website-extras.js              → alla bolag med website utan extras
 *   node enrich-website-extras.js --recheck    → kör om även de som redan checkats
 *   node enrich-website-extras.js --limit 100
 *   node enrich-website-extras.js --concurrency 20
 */

const { getDb } = require("./db");
const pLimit = require("p-limit");

// ════════════════════════════════════════════════════════════════════
// Konfig
// ════════════════════════════════════════════════════════════════════

const UAs = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const pickUA = () => UAs[Math.floor(Math.random() * UAs.length)];

// Kolumner att lägga till
const NEW_COLUMNS = [
  ["tech_extra", "TEXT"], // one.com|hemsida24|jimdo|joomla|drupal|sitevision|null
  ["chatbot", "TEXT"], // intercom|drift|tidio|crisp|tawk|livechat|zendesk|null
  ["booking", "TEXT"], // calendly|bokadirekt|bokamera|simplybook|null
  ["has_ga", "INTEGER"], // 1 = Google Analytics
  ["has_fb_pixel", "INTEGER"],
  ["has_cookie_banner", "INTEGER"],
  ["website_extras_at", "TEXT"],
];

function ensureColumns() {
  const db = getDb();
  const existing = new Set(
    db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name)
  );
  for (const [name, type] of NEW_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
      console.log(`   + Lade till kolumn: ${name}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// Detektorer (allt körs på samma HTML — en fetch per sajt)
// ════════════════════════════════════════════════════════════════════

function detectTechExtra(html, headers) {
  const h = html.toLowerCase();
  const gen = (headers.get("server") || "") + " " + (headers.get("x-powered-by") || "");
  const g = gen.toLowerCase();

  // Sitevision (svenskt CMS)
  if (h.includes("sitevision") || g.includes("sitevision")) return "sitevision";
  // Joomla
  if (h.includes("/components/com_") || h.includes("joomla") || h.includes("/modules/mod_")) return "joomla";
  // Drupal
  if (h.includes('content="drupal') || h.includes("/sites/default/files") || h.includes("drupal-")) return "drupal";
  // Jimdo
  if (h.includes("jimdo.com") || h.includes("data-jimdo") || h.includes("jimdo-")) return "jimdo";
  // Hemsida24 (Loopia)
  if (h.includes("hemsida24") || h.includes("loopia.se") || h.includes("loopiapagebuilder")) return "hemsida24";
  // one.com pagebuilder
  if (h.includes("one.com/pagebuilder") || h.includes("one-com") || h.includes("powered by one.com")) return "one.com";
  // Yola
  if (h.includes("yola.com") || h.includes("yola-")) return "yola";
  // GoDaddy Website Builder
  if (h.includes("godaddysites.com") || h.includes("websitebuilder.godaddy")) return "godaddy";
  // Strikingly
  if (h.includes("strikinglycdn") || h.includes("strikingly.com")) return "strikingly";
  return null;
}

function detectChatbot(html) {
  const h = html.toLowerCase();
  if (h.includes("intercom") || h.includes("widget.intercom.io")) return "intercom";
  if (h.includes("drift.com") || h.includes("driftt.com") || h.includes("js.driftt.com")) return "drift";
  if (h.includes("tidio.co") || h.includes("code.tidio.co") || h.includes("tidio-chat")) return "tidio";
  if (h.includes("crisp.chat") || h.includes("crisp-cdn") || h.includes("client.crisp.chat")) return "crisp";
  if (h.includes("tawk.to") || h.includes("embed.tawk.to")) return "tawk";
  if (h.includes("livechatinc.com") || h.includes("cdn.livechatinc.com")) return "livechat";
  if (h.includes("zendesk.com/embeddable") || h.includes("zdassets.com")) return "zendesk";
  if (h.includes("hubspot.com/usemessages") || h.includes("hs-scripts.com")) return "hubspot";
  if (h.includes("smartsupp.com") || h.includes("widget-arena.smartsupp.com")) return "smartsupp";
  if (h.includes("freshchat.com") || h.includes("widget.freshworks.com")) return "freshchat";
  if (h.includes("messengerwidget") && h.includes("facebook")) return "messenger";
  return null;
}

function detectBooking(html) {
  const h = html.toLowerCase();
  if (h.includes("calendly.com") || h.includes("assets.calendly.com")) return "calendly";
  if (h.includes("bokadirekt.se") || h.includes("bokadirekt-widget")) return "bokadirekt";
  if (h.includes("bokamera.se")) return "bokamera";
  if (h.includes("simplybook.me") || h.includes("simplybook.it")) return "simplybook";
  if (h.includes("youcanbook.me")) return "youcanbookme";
  if (h.includes("squarespacescheduling") || h.includes("acuityscheduling.com")) return "acuity";
  if (h.includes("setmore.com") || h.includes("widget.setmore.com")) return "setmore";
  if (h.includes("appointy.com")) return "appointy";
  if (h.includes("supersaas.com")) return "supersaas";
  if (h.includes("mitfyrhjul") || h.includes("vgrf-bokning")) return "vgrf";
  return null;
}

function detectGA(html) {
  const h = html.toLowerCase();
  return (
    h.includes("google-analytics.com") ||
    h.includes("googletagmanager.com") ||
    h.includes("gtag(") ||
    h.includes("ga('send'") ||
    /['"]g-[a-z0-9]{8,}['"]/i.test(h) || // GA4 measurement ID
    /['"]ua-\d{4,}-\d{1,}['"]/i.test(h)  // Universal Analytics ID
  ) ? 1 : 0;
}

function detectFbPixel(html) {
  const h = html.toLowerCase();
  return (
    h.includes("connect.facebook.net") ||
    h.includes("fbq(") ||
    h.includes("facebook-pixel") ||
    /pixel\s*id['":\s]/i.test(h) && h.includes("facebook")
  ) ? 1 : 0;
}

function detectCookieBanner(html) {
  const h = html.toLowerCase();
  return (
    h.includes("cookieyes") ||
    h.includes("cookiebot.com") ||
    h.includes("cookie-consent") ||
    h.includes("onetrust.com") ||
    h.includes("cmp.osano.com") ||
    h.includes("complianz") ||
    /<[^>]+(class|id)=["'][^"']*cookie[^"']*["']/i.test(h)
  ) ? 1 : 0;
}

// ════════════════════════════════════════════════════════════════════
// Fetch + analys
// ════════════════════════════════════════════════════════════════════

async function analyzeWebsite(url) {
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith("http")) normalizedUrl = `https://${normalizedUrl}`;

  try {
    const res = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": pickUA(),
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 200) return null;

    return {
      tech_extra: detectTechExtra(html, res.headers),
      chatbot: detectChatbot(html),
      booking: detectBooking(html),
      has_ga: detectGA(html),
      has_fb_pixel: detectFbPixel(html),
      has_cookie_banner: detectCookieBanner(html),
    };
  } catch {
    return null;
  }
}

function saveResult(placeId, data) {
  if (!data) {
    // Markera som checkad även om analys misslyckades, så vi inte försöker igen
    getDb()
      .prepare(
        `UPDATE companies SET website_extras_at = datetime('now'), updated_at = datetime('now')
         WHERE place_id = ?`
      )
      .run(placeId);
    return;
  }
  getDb()
    .prepare(
      `UPDATE companies SET
        tech_extra        = ?,
        chatbot           = ?,
        booking           = ?,
        has_ga            = ?,
        has_fb_pixel      = ?,
        has_cookie_banner = ?,
        website_extras_at = datetime('now'),
        updated_at        = datetime('now')
       WHERE place_id = ?`
    )
    .run(
      data.tech_extra,
      data.chatbot,
      data.booking,
      data.has_ga,
      data.has_fb_pixel,
      data.has_cookie_banner,
      placeId
    );
}

// ════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: null, concurrency: 12, recheck: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (args[i] === "--concurrency" && args[i + 1])
      opts.concurrency = parseInt(args[++i]);
    else if (args[i] === "--recheck") opts.recheck = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log("🌐 enrich-website-extras — chatbot/booking/GA/FB-pixel/CMS-extras\n");
  console.log(`   Concurrency: ${opts.concurrency}`);
  console.log(`   Recheck:     ${opts.recheck ? "ja" : "nej"}`);
  console.log("");

  ensureColumns();
  console.log("");

  const where = ["website IS NOT NULL", "website != ''"];
  if (!opts.recheck) where.push("website_extras_at IS NULL");
  const baseQuery = `SELECT place_id, name, website FROM companies
                     WHERE ${where.join(" AND ")}
                     ORDER BY place_id`;
  const need = opts.limit
    ? getDb().prepare(`${baseQuery} LIMIT ?`).all(opts.limit)
    : getDb().prepare(baseQuery).all();

  console.log(`📋 Sajter att analysera: ${need.length.toLocaleString()}\n`);

  const limit = pLimit(opts.concurrency);
  const counters = {
    done: 0,
    success: 0,
    failed: 0,
    chatbot: 0,
    booking: 0,
    ga: 0,
    fbPixel: 0,
    techExtra: 0,
  };

  await Promise.all(
    need.map((c) =>
      limit(async () => {
        const data = await analyzeWebsite(c.website);
        saveResult(c.place_id, data);
        counters.done++;
        if (data) {
          counters.success++;
          if (data.chatbot) counters.chatbot++;
          if (data.booking) counters.booking++;
          if (data.has_ga) counters.ga++;
          if (data.has_fb_pixel) counters.fbPixel++;
          if (data.tech_extra) counters.techExtra++;
        } else {
          counters.failed++;
        }
        if (counters.done % 100 === 0 || counters.done === need.length) {
          const pct = Math.round((counters.done / need.length) * 100);
          process.stdout.write(
            `\r   [${String(pct).padStart(3)}%] ${counters.done.toLocaleString()}/${need.length.toLocaleString()} | chatbot ${counters.chatbot} | booking ${counters.booking} | GA ${counters.ga} | FB ${counters.fbPixel}   `
          );
        }
      })
    )
  );

  console.log("\n\n📊 Resultat:");
  console.log(`   Lyckades läsa:    ${counters.success.toLocaleString()}`);
  console.log(`   Misslyckades:     ${counters.failed.toLocaleString()}`);
  console.log(`   Chatbot hittad:   ${counters.chatbot.toLocaleString()}`);
  console.log(`   Booking hittad:   ${counters.booking.toLocaleString()}`);
  console.log(`   Google Analytics: ${counters.ga.toLocaleString()}`);
  console.log(`   FB Pixel:         ${counters.fbPixel.toLocaleString()}`);
  console.log(`   Extra-CMS:        ${counters.techExtra.toLocaleString()}`);
}

main().catch((err) => {
  console.error("\n❌ Fel:", err.message || err);
  process.exit(1);
});
