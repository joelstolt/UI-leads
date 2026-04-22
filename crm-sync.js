/**
 * crm-sync.js — Synkroniserar leads från SQLite till CRM via webhook
 *
 * Skickar bolag ett i taget till CRM:ets webhook-endpoint.
 * CRM:et hanterar dedup automatiskt (på orgnummer + mejl).
 *
 * Användning:
 *   node crm-sync.js --project-id <id>          → obligatorisk (eller via env)
 *   node crm-sync.js --project-id <id> --limit 100
 *   node crm-sync.js --project-id <id> --priority "A+,A"
 *   node crm-sync.js --project-id <id> --branch snickare
 *   node crm-sync.js --project-id <id> --dry-run
 *   node crm-sync.js --project-id <id> --reset   → nollställ crm_synced_at (om-synka)
 *
 * Kräver i .env:
 *   CRM_WEBHOOK_URL    = https://ditt-crm.vercel.app/api/webhook/leads/TOKEN
 *   CRM_WEBHOOK_TOKEN  = din-token (inbakat i URL:en ovan, men används som header-backup)
 *   CRM_DEFAULT_PROJECT_ID = (fallback om --project-id ej anges)
 */

require("dotenv").config({ override: true });
const { getDb } = require("./db");

const WEBHOOK_URL   = process.env.CRM_WEBHOOK_URL;
const WEBHOOK_TOKEN = process.env.CRM_WEBHOOK_TOKEN;

if (!WEBHOOK_URL) {
  console.error("❌ Saknar CRM_WEBHOOK_URL i .env");
  process.exit(1);
}

// Rate-limit: max 50 req/min med säkerhetsmarginal (60-req/min är max i CRM)
const DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── DB-helpers ────────────────────────────────────────────────

function ensureSyncColumn() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(companies)").all().map((r) => r.name);
  if (!cols.includes("crm_synced_at")) {
    db.exec("ALTER TABLE companies ADD COLUMN crm_synced_at TEXT;");
  }
}

function getCompaniesForSync(opts) {
  const conditions = ["(crm_synced_at IS NULL)"];
  const params = [];

  if (opts.priorities?.length) {
    const placeholders = opts.priorities.map(() => "?").join(", ");
    conditions.push(`priority IN (${placeholders})`);
    params.push(...opts.priorities);
  }

  if (opts.branch) {
    conditions.push("branch LIKE ?");
    params.push(`%${opts.branch}%`);
  }

  // Kräver telefon (CRM-leads utan telefon är inte användbara)
  conditions.push("phone IS NOT NULL AND phone != ''");

  const where = "WHERE " + conditions.join(" AND ");
  const sql = `
    SELECT place_id, name, phone, website, email, branch, city, address,
           rating, reviews, seo, performance, priority,
           org_nr, firmatecknare, revenue, employees
    FROM companies ${where}
    ORDER BY
      CASE priority
        WHEN '🔥 A+' THEN 1
        WHEN '🟡 A'  THEN 2
        WHEN '🔵 B'  THEN 3
        WHEN '⚪ C'  THEN 4
        ELSE 5
      END,
      rating DESC NULLS LAST
    LIMIT ?
  `;
  params.push(opts.limit);
  return getDb().prepare(sql).all(...params);
}

function markSynced(placeId, leadId) {
  getDb()
    .prepare(`
      UPDATE companies
      SET crm_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE place_id = ?
    `)
    .run(placeId);
}

function resetSyncedAt(opts) {
  const db = getDb();
  let sql = "UPDATE companies SET crm_synced_at = NULL";
  const params = [];
  if (opts.branch) { sql += " WHERE branch LIKE ?"; params.push(`%${opts.branch}%`); }
  const n = db.prepare(sql).run(...params).changes;
  console.log(`Återställde crm_synced_at för ${n} bolag.`);
}

// ── Fältmappning: SQLite → CRM webhook ───────────────────────

function toSeoScore(company) {
  // seo_score-fältet i CRM är text — vi skickar "SEO:XX / Perf:XX / Prio:X"
  const parts = [];
  if (company.seo != null)         parts.push(`SEO:${company.seo}`);
  if (company.performance != null) parts.push(`Perf:${company.performance}`);
  if (company.priority)            parts.push(company.priority.replace(/[🔥🟡🔵⚪]/g, "").trim());
  return parts.join(" / ");
}

function toOmsattningMsek(revenue) {
  if (!revenue) return "";
  // revenue i DB är i SEK → konvertera till MSEK (miljoner)
  return (revenue / 1_000_000).toFixed(2);
}

function mapToWebhookPayload(company) {
  const firmatecknareStr = (() => {
    if (!company.firmatecknare) return "";
    try {
      const arr = JSON.parse(company.firmatecknare);
      return Array.isArray(arr) ? arr[0] || "" : String(arr);
    } catch {
      return String(company.firmatecknare);
    }
  })();

  return {
    foretagsnamn:    company.name,
    orgnummer:       company.org_nr || "",
    bransch:         company.branch || "",
    ort:             company.city || "",
    lan:             "",                        // Saknas i leadsgoogle-data
    telefon:         company.phone || "",
    anstallda:       company.employees != null ? String(company.employees) : "",
    omsattning_msek: toOmsattningMsek(company.revenue),
    firmatecknare:   firmatecknareStr,
    hemsida:         company.website || "",
    mejl:            company.email || "",
    seo_score:       toSeoScore(company),
    rapport_url:     "",
  };
}

// ── Webhook-anrop ─────────────────────────────────────────────

async function sendToWebhook(payload) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (WEBHOOK_TOKEN) {
    headers["Authorization"] = `Bearer ${WEBHOOK_TOKEN}`;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data.error || JSON.stringify(data)}`);
  }

  return data; // { ok: true, status: "created"|"duplicate", lead_id: "..." }
}

// ── CLI-argument ──────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    projectId:  null,
    limit:      5000,
    priorities: null,
    branch:     null,
    dryRun:     false,
    reset:      false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-id" && args[i + 1]) opts.projectId = args[++i];
    if (args[i] === "--limit"      && args[i + 1]) opts.limit     = parseInt(args[++i]);
    if (args[i] === "--branch"     && args[i + 1]) opts.branch    = args[++i];
    if (args[i] === "--priority"   && args[i + 1]) {
      opts.priorities = args[++i].split(",").map((p) => p.trim()).map((p) => {
        if (p === "A+" || p === "🔥 A+") return "🔥 A+";
        if (p === "A"  || p === "🟡 A")  return "🟡 A";
        if (p === "B"  || p === "🔵 B")  return "🔵 B";
        if (p === "C"  || p === "⚪ C")  return "⚪ C";
        return p;
      });
    }
    if (args[i] === "--dry-run") opts.dryRun = true;
    if (args[i] === "--reset")   opts.reset  = true;
  }

  // Fallback till env-variabel
  if (!opts.projectId) {
    opts.projectId = process.env.CRM_DEFAULT_PROJECT_ID || null;
  }

  if (!opts.projectId && !opts.dryRun && !opts.reset) {
    console.error("❌ --project-id krävs (eller sätt CRM_DEFAULT_PROJECT_ID i .env)");
    process.exit(1);
  }

  return opts;
}

// ── Huvudprogram ─────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  ensureSyncColumn();

  if (opts.reset) {
    resetSyncedAt(opts);
    return;
  }

  const companies = getCompaniesForSync(opts);

  console.log("🔗 CRM Sync — webhook");
  console.log(`   Endpoint:  ${WEBHOOK_URL.replace(/\/[^/]+$/, "/***")}`);
  console.log(`   Project:   ${opts.projectId || "(anges i webhook-token)"}`);
  console.log(`   Bolag:     ${companies.length}`);
  console.log(`   Hastighet: ~50 req/min`);
  if (opts.priorities) console.log(`   Prioritet: ${opts.priorities.join(", ")}`);
  if (opts.branch)     console.log(`   Bransch:   ${opts.branch}`);

  if (opts.dryRun) {
    console.log("\n[DRY-RUN] Inga anrop görs. Exempelrad:");
    if (companies[0]) {
      console.log(JSON.stringify(mapToWebhookPayload(companies[0]), null, 2));
    }
    return;
  }

  console.log();

  let created = 0;
  let duplicates = 0;
  let errors = 0;
  let i = 0;

  for (const company of companies) {
    i++;
    const payload = mapToWebhookPayload(company);

    try {
      const result = await sendToWebhook(payload);
      if (result.status === "duplicate") {
        duplicates++;
      } else {
        created++;
        markSynced(company.place_id, result.lead_id);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`\n  ✗ ${company.name}: ${err.message}`);
      }
    }

    if (i % 25 === 0 || i === companies.length) {
      process.stdout.write(
        `\r  ${i}/${companies.length} | skapade: ${created} | dubblett: ${duplicates} | fel: ${errors}   `
      );
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n\n✅ Klart!`);
  console.log(`   Skapade:    ${created}`);
  console.log(`   Dubbletter: ${duplicates} (redan i CRM)`);
  if (errors > 0) console.log(`   Fel:        ${errors}`);
}

main().catch(console.error);
