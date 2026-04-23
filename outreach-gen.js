/**
 * outreach-gen.js — Genererar personlig kall-outreach (mejl + LinkedIn + telefon-pitch) per lead
 *
 * Använder Claude Haiku 4.5 med tool-use för strukturerad output.
 * Prompt-cachar systemprompten så kostnaden per lead blir minimal (~$0.0005).
 *
 * Användning:
 *   node outreach-gen.js                       → alla A+ utan outreach_generated_at
 *   node outreach-gen.js --priority "A+,A"     → A+ och A
 *   node outreach-gen.js --branch snickare     → bara en bransch
 *   node outreach-gen.js --limit 50
 *   node outreach-gen.js --regenerate          → kör om även de som redan har copy
 *   node outreach-gen.js --audit-base https://leads.stoltmarketing.se   → URL till audit-sidan
 *
 * Kräver: ANTHROPIC_API_KEY i .env
 */

require("dotenv").config({ override: true });
const Anthropic = require("@anthropic-ai/sdk").default;
const { getDb } = require("./db");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("❌ Saknar ANTHROPIC_API_KEY i .env");
  process.exit(1);
}

const client = new Anthropic({ apiKey: API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

// Brand-config (måste hållas i sync med web/src/lib/brands.ts)
const BRANDS = {
  "wlm-se": {
    name: "We Love Marketing",
    domain: "welovemarketing.se",
    email: "joel@welovemarketing.se",
    language: "sv",
    pitch: "vi bygger sajter som rankar och konverterar — sökmotoroptimering, design, tekniskt fundament",
  },
  "wlm-ie": {
    name: "We Love Marketing",
    domain: "welovemarketing.ie",
    email: "hello@welovemarketing.ie",
    language: "en",
    pitch: "we build websites that rank and convert — SEO, design and technical foundation",
  },
  flodo: {
    name: "Flodo",
    domain: "flodo.se",
    email: "hej@flodo.se",
    language: "sv",
    pitch: "vi gör det enkelt och billigt för småbolag att synas på Google — fast pris 495 kr/mån, allt ingår",
  },
};
const DEFAULT_BRAND = "wlm-se";

function getBrandFor(lead) {
  const key = lead.brand && BRANDS[lead.brand] ? lead.brand : DEFAULT_BRAND;
  return BRANDS[key];
}

// ── DB-helpers ────────────────────────────────────────────────

function ensureOutreachColumns() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  const adds = [
    ["outreach_email_subject", "TEXT"],
    ["outreach_email_body", "TEXT"],
    ["outreach_linkedin", "TEXT"],
    ["outreach_phone", "TEXT"],
    ["outreach_generated_at", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
    }
  }
}

function getLeadsForOutreach(opts) {
  const conditions = [];
  const params = [];

  if (!opts.regenerate) conditions.push("outreach_generated_at IS NULL");

  if (opts.priorities?.length) {
    const ph = opts.priorities.map(() => "?").join(", ");
    conditions.push(`priority IN (${ph})`);
    params.push(...opts.priorities);
  } else {
    conditions.push("priority IS NOT NULL");
  }

  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }

  // Vi behöver något att skriva om — kräver att de har hemsida+PageSpeed
  conditions.push("website IS NOT NULL AND website != ''");
  conditions.push("pagespeed_at IS NOT NULL");

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  return getDb()
    .prepare(
      `SELECT place_id, name, branch, city, phone, website, email, email_scraped_at,
              performance, seo, accessibility, mobile_friendly, priority,
              org_nr, firmatecknare, revenue, employees, sni_code,
              usp_1, usp_2, usp_3,
              tech_stack, tech_https, tech_has_schema, tech_has_viewport,
              sitemap_url_count, sitemap_checked_at,
              domain_rank, domain_rank_at,
              brand
       FROM companies ${where}
       ORDER BY
         CASE priority WHEN '🔥 A+' THEN 1 WHEN '🟡 A' THEN 2 WHEN '🔵 B' THEN 3 ELSE 4 END,
         rating DESC NULLS LAST
       LIMIT ?`
    )
    .all(...params, opts.limit);
}

function saveOutreach(placeId, copy) {
  getDb()
    .prepare(
      `UPDATE companies
       SET outreach_email_subject = ?,
           outreach_email_body    = ?,
           outreach_linkedin      = ?,
           outreach_phone         = ?,
           outreach_generated_at  = datetime('now'),
           updated_at             = datetime('now')
       WHERE place_id = ?`
    )
    .run(copy.email_subject, copy.email_body, copy.linkedin_dm, copy.phone_pitch, placeId);
}

// ── Prompt-design ─────────────────────────────────────────────

function systemPromptFor(brand) {
  const lang = brand.language === "en"
    ? "ENGLISH (the recipient is in UK or Ireland)"
    : "SVENSKA (mottagaren är i Sverige/Norge/Danmark)";
  return `Du är säljcopywriter på ${brand.name}, en digital byrå som ${brand.pitch}.
Vi säljer hemside-bygge, SEO och Google Ads till lokala/regionala företag.

Skriv kall-outreach som ENBART består av påståenden vi kan belägga från datan vi ger dig.
Hitta INTE på saker. Om vi inte har data om något (t.ex. USP), nämn det inte.

Ton: jordnära, vänlig, kompetent. Inte säljig. Som en kollega som tipsar.
Pek på ETT konkret problem (det allvarligaste) och föreslå att vi kan hjälpa.
Aldrig: "Hej {namn}", "hoppas det går bra", "kort fråga". Hoppa direkt in.

Skriv på ${lang}.

Mottagare är typiskt: ägare eller marknadsansvarig på ett SMB. De är upptagna.

Generera tre versioner:
1. email_subject: <50 tecken, väcker nyfikenhet utan clickbait
2. email_body: 4-6 rader, max 500 tecken. Inkludera audit-länken om det finns.
3. linkedin_dm: <300 tecken, ännu mer direkt
4. phone_pitch: 30-sek manus när de svarar — börja med varför du ringer dem specifikt`;
}

const TOOL = {
  name: "save_outreach",
  description: "Spara den genererade outreach-copyn",
  input_schema: {
    type: "object",
    properties: {
      email_subject: { type: "string", description: "Ämnesrad, max 50 tecken" },
      email_body: { type: "string", description: "Mejlbody, max 500 tecken" },
      linkedin_dm: { type: "string", description: "LinkedIn-DM, max 300 tecken" },
      phone_pitch: { type: "string", description: "30-sek telefonpitch" },
    },
    required: ["email_subject", "email_body", "linkedin_dm", "phone_pitch"],
  },
};

function buildLeadContext(lead, auditUrl) {
  const usps = [lead.usp_1, lead.usp_2, lead.usp_3].filter(Boolean);
  const facts = [];
  facts.push(`Bolagsnamn: ${lead.name}`);
  if (lead.branch) facts.push(`Bransch: ${lead.branch}`);
  if (lead.city) facts.push(`Ort: ${lead.city}`);
  if (lead.website) facts.push(`Hemsida: ${lead.website}`);
  if (lead.performance != null) facts.push(`PageSpeed Performance: ${lead.performance}/100`);
  if (lead.seo != null) facts.push(`PageSpeed SEO: ${lead.seo}/100`);
  if (lead.accessibility != null) facts.push(`Accessibility: ${lead.accessibility}/100`);
  if (lead.mobile_friendly) facts.push(`Mobilvänlig: ${lead.mobile_friendly}`);
  // Endast påstå "ingen e-post" om vi faktiskt har scrapat sajten — annars
  // riskerar vi att skicka mejl som säger "ni saknar e-post" trots att vi
  // aldrig har testat.
  if (lead.email_scraped_at && !lead.email) facts.push(`Vi hittade ingen e-post på sajten`);
  if (lead.revenue) facts.push(`Omsättning: ${Math.round(lead.revenue / 1_000_000)} Mkr`);
  if (lead.employees) facts.push(`Anställda: ${lead.employees}`);
  if (usps.length) facts.push(`USP enligt deras egen sajt: ${usps.join("; ")}`);

  // Tech-stack: skip "error" (sajten nere → annan pitch), bara påstå
  // saknade tekniska detaljer när vi VET de saknas (=== 0, ej null).
  if (lead.tech_stack === "error") {
    facts.push(`Sajten svarar inte / är nere just nu — kunder kan inte nå er online`);
  } else if (lead.tech_stack && lead.tech_stack !== "unknown") {
    facts.push(`Plattform sajten är byggd på: ${lead.tech_stack}`);
    if (lead.tech_https === 0) facts.push(`Sajten saknar HTTPS (säkerhetsproblem)`);
    if (lead.tech_has_schema === 0) facts.push(`Sajten saknar schema.org-markup (försvårar Google-rich-results)`);
    if (lead.tech_has_viewport === 0) facts.push(`Sajten saknar viewport-meta (mobil-fail)`);
  }

  // Sitemap: bara påstå sidantal om vi faktiskt har scannat. Skip "0 sidor"
  // om sitemap_checked_at saknas (då vet vi inte).
  if (lead.sitemap_checked_at && lead.sitemap_url_count != null) {
    facts.push(`Antal sidor i sajten (sitemap.xml): ${lead.sitemap_url_count}`);
  }
  // Domain Rank: bara om vi har riktig mätning, inte API-fel.
  if (lead.domain_rank_at && lead.domain_rank != null) {
    facts.push(`Domain Rank (OpenPageRank, 0-10): ${lead.domain_rank.toFixed(1)}`);
  }

  const audit = auditUrl ? `\n\nPersonlig audit-länk att lägga i mejlet: ${auditUrl}` : "";
  return `Här är leadens data:\n\n${facts.join("\n")}${audit}\n\nGenerera outreach-copy via tool save_outreach.`;
}

async function generate(lead, auditBase) {
  const brand = getBrandFor(lead);
  // Audit-URL pekar alltid på brandets domän (ej auditBase) i prod.
  // I dev/lokalt: använd auditBase (localhost).
  const isProd = auditBase && !auditBase.includes("localhost");
  const baseUrl = isProd ? `https://${brand.domain}` : auditBase;
  const auditUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/audit/${encodeURIComponent(lead.slug || lead.place_id)}`
    : null;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "save_outreach" },
    system: [
      {
        type: "text",
        text: systemPromptFor(brand),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildLeadContext(lead, auditUrl) }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Inget tool_use i svaret");
  return toolUse.input;
}

// ── CLI ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    priorities: null,
    branch: null,
    limit: 50,
    regenerate: false,
    auditBase: process.env.AUDIT_BASE_URL || "http://localhost:3001",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--priority" && args[i + 1]) {
      opts.priorities = args[++i].split(",").map((p) => p.trim()).map((p) => {
        if (p === "A+" || p === "🔥 A+") return "🔥 A+";
        if (p === "A" || p === "🟡 A") return "🟡 A";
        if (p === "B" || p === "🔵 B") return "🔵 B";
        if (p === "C" || p === "⚪ C") return "⚪ C";
        return p;
      });
    }
    if (args[i] === "--branch" && args[i + 1]) opts.branch = args[++i];
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === "--regenerate") opts.regenerate = true;
    if (args[i] === "--audit-base" && args[i + 1]) opts.auditBase = args[++i];
  }
  return opts;
}

async function main() {
  ensureOutreachColumns();
  const opts = parseArgs();
  const leads = getLeadsForOutreach(opts);

  console.log("✍️  Outreach-generator (Claude Haiku 4.5)");
  console.log(`   Modell:       ${MODEL}`);
  console.log(`   Audit-base:   ${opts.auditBase}`);
  console.log(`   Prioriteter:  ${opts.priorities?.join(", ") || "alla med pagespeed"}`);
  if (opts.branch) console.log(`   Bransch:      ${opts.branch}`);
  console.log(`   Att generera: ${leads.length} bolag`);
  console.log();

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const tag = `[${i + 1}/${leads.length}] ${lead.name.slice(0, 38).padEnd(38)}`;
    process.stdout.write(`  ${tag} `);
    try {
      const copy = await generate(lead, opts.auditBase);
      saveOutreach(lead.place_id, copy);
      ok++;
      process.stdout.write(`✓ "${copy.email_subject.slice(0, 40)}"\n`);
    } catch (err) {
      fail++;
      process.stdout.write(`✗ ${err.message}\n`);
    }
  }

  console.log();
  console.log(`✅ Klart! ${ok} ok, ${fail} fel`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
