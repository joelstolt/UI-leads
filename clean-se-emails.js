#!/usr/bin/env node
/**
 * clean-se-emails.js — rensa skräp ur email-fältet för svenska leads.
 *   • Splittar fler-mejl-fält ("a@x.se, b@x.se") och väljer bästa adressen.
 *   • Droppar hosting/builder-support (support@loopia.com, @webador …), sentry-hashar,
 *     bild-mejl, placeholders.
 *   • Behåller bara rimliga: domän-match, free-mail, eller roll-adress (info@, boka@…).
 *   • NULL:ar fältet om inget rimligt återstår.
 * Skriver alltid en CSV med exakt vad som ändrades/togs bort (insyn).
 *   node clean-se-emails.js --dry     → visa, ändra inget
 *   node clean-se-emails.js           → skriv till DB
 */
const fs = require("node:fs");
const { getDb } = require("./db");
const DRY = process.argv.includes("--dry");
const OUT = "/Users/joelstolt/Downloads/borttagna-mejl-se.csv";

const PROVIDER = /@(loopia\.|webador\.|one\.com|wix\.com|wixpress\.com|squarespace\.|godaddy|secureserver|wordpress\.com|minhemsida\.|hemsida24|sitoo|mysite\.|yourdomain|sentry|ingest\.sentry|\.wixsite\.)/i;
const BLOCK = ["@example", "@test.", "@cdn.", "@google", "@facebook", "@apple", "@microsoft", "@adobe", "@schema.org", "@w3.org", "name@provider.com", "@email.com", "@domain.com", "@2x.", "@3x."];
const BAD_EXT = /\.(png|jpg|jpeg|gif|webp|svg|css|js|woff2?|ttf|ico)$/i;
const FREEMAIL = /@(gmail|hotmail|outlook|yahoo|live|icloud|msn|telia|comhem|spray|bredband2?|tele2|me)\./i;
const ROLE = /^(info|kontakt|kontor|hej|mail|post|order|offert|bokning|boka|sales|forsaljning|reception|kundtjanst|kundservice|support|hello|kontoret|kanslei?)@/i;

function cleanEmail(raw) {
  if (!raw) return "";
  let e = raw.trim().toLowerCase().replace(/^mailto:/, "");
  e = e.replace(/%[0-9a-f]{2}/g, "").replace(/^[^a-z0-9]+/, "").replace(/[\\?.,;:)>\]"'\s]+$/, "");
  return e;
}
function isValid(e) {
  if (!e || e.length < 5 || e.split("@").length !== 2 || !e.includes(".")) return false;
  if (BLOCK.some((b) => e.includes(b))) return false;
  if (PROVIDER.test(e)) return false;
  if (BAD_EXT.test(e)) return false;
  if (/^[a-f0-9]{16,}@/.test(e)) return false;   // hash
  if (/^[0-9]{6,}@/.test(e)) return false;
  return true;
}
const coreLabel = (d) => { const p = (d || "").split("."); return p.length >= 2 ? p[p.length - 2] : p[0] || ""; };
function domainMatch(ed, sd) { if (!ed || !sd) return false; if (ed === sd) return true; const a = coreLabel(ed), b = coreLabel(sd); return a.length >= 4 && a === b; }
function siteDomain(w) { try { return new URL(w.startsWith("http") ? w : "https://" + w).hostname.replace(/^www\./, ""); } catch { return ""; } }

function pickBest(field, website) {
  const dom = siteDomain(website || "");
  const cands = (field || "").split(/[,;\s]+/).map(cleanEmail).filter(isValid);
  const keep = cands.filter((e) => { const ed = e.split("@")[1]; return domainMatch(ed, dom) || FREEMAIL.test(e) || ROLE.test(e); });
  if (!keep.length) return null;
  const score = (e) => { const ed = e.split("@")[1]; let s = 0; if (domainMatch(ed, dom)) s += 10; if (ROLE.test(e)) s += 3; if (FREEMAIL.test(e)) s -= 1; return s; };
  return [...new Set(keep)].sort((a, b) => score(b) - score(a))[0];
}

const db = getDb();
const SE = "branch NOT LIKE 'IE-%' AND branch NOT LIKE 'NO-%' AND branch NOT IN ('Håndverkere','Rengjøring','Malere','Hairdressers','Painters & Decorators')";
const rows = db.prepare(`SELECT place_id, name, website, email FROM companies WHERE ${SE} AND email IS NOT NULL AND TRIM(email)<>''`).all();
const upd = db.prepare("UPDATE companies SET email=?, updated_at=datetime('now') WHERE place_id=?");
const clr = db.prepare("UPDATE companies SET email=NULL, updated_at=datetime('now') WHERE place_id=?");

let changed = 0, removed = 0, same = 0;
const log = [];
const run = db.transaction(() => {
  for (const r of rows) {
    const orig = r.email.trim();
    const best = pickBest(r.email, r.website);
    if (!best) { if (!DRY) clr.run(r.place_id); removed++; log.push(["BORTTAGEN", r.name, orig, ""]); }
    else if (best !== orig.toLowerCase()) { if (!DRY) upd.run(best, r.place_id); changed++; log.push(["STÄDAD", r.name, orig, best]); }
    else same++;
  }
});
run();

const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
fs.writeFileSync(OUT, [["Åtgärd", "Företag", "Före", "Efter"].join(",")].concat(log.map((r) => r.map(esc).join(","))).join("\n"));

console.log(`\n${DRY ? "🔎 DRY (inget skrivet)" : "✅ Skrivet till DB"}  —  ${rows.length} SE-mejl genomgångna`);
console.log(`   Oförändrade (redan rena):           ${same}`);
console.log(`   Städade (multi→bästa / trimmade):   ${changed}`);
console.log(`   Borttagna (bara skräp → NULL):      ${removed}`);
console.log(`   Logg (allt som ändras/tas bort): ${OUT}`);
