/**
 * Exportera till CSV — separata filer per bransch med orgnr + firmatecknare
 */
const fs = require("fs");
const path = require("path");

const AUDITS_DIR = path.join(__dirname, "output", "seo-audits");
const OUT_DIR = path.join(__dirname, "output");
const BASE_URLS = {
  "Städfirmor": "https://www.welovemarketing.se/analys",
  "Hantverkare": "https://www.welovemarketing.se/analys",
  "Elektriker": "https://www.welovemarketing.se/analys",
  "Carpenters": "https://www.welovemarketing.se/analys",
  "Plumbers": "https://www.welovemarketing.se/analys",
  default: "https://www.flodo.se/analys",
};
function getBaseUrl(b) { return BASE_URLS[b] || BASE_URLS.default; }

function slugify(s) {
  return s.toLowerCase().replace(/å|ä/g, "a").replace(/ö/g, "o").replace(/é|è/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function esc(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function normalizeDomain(url) {
  if (!url) return "";
  return url.toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

const files = fs.readdirSync(AUDITS_DIR).filter((f) => f.endsWith(".json"));
const rowsByBransch = {};
const allRows = [];
const seenDomains = new Map(); // domain → best row (högst score)

for (const f of files) {
  const a = JSON.parse(fs.readFileSync(path.join(AUDITS_DIR, f), "utf-8"));
  if (!a.lead || a.error || !a.scores) continue;
  if (!a.lead.Telefon || !a.lead.Telefon.trim()) continue;
  const slug = slugify(`${a.lead.Företag}-${a.lead.Stad}`);
  const people = a.extracted?.people || [];
  const row = {
    bransch: a.lead.Bransch,
    stad: a.lead.Stad,
    foretag: a.lead.Företag,
    totalt: a.scores.overall,
    tech: a.scores.tech,
    content: a.scores.content,
    betyg: a.lead.Betyg,
    recensioner: a.lead.Recensioner || a.lead["Antal recensioner"] || "",
    telefon: a.lead.Telefon,
    email: a.lead["E-post"] || (a.extracted?.emails?.[0]) || "",
    hemsida: a.lead.Hemsida,
    orgnr: a.extracted?.orgnr || "",
    firmatecknare: people.map((p) => `${p.name} (${p.title})`).join("; "),
    namn1: people[0]?.name || "",
    titel1: people[0]?.title || "",
    rapport: `${getBaseUrl(a.lead.Bransch)}/${slug}.html`,
  };
  // Dedup på domän
  const domain = normalizeDomain(a.lead.Hemsida);
  const dedupKey = domain || `noweb:${a.lead.Företag}:${a.lead.Telefon}`;
  if (seenDomains.has(dedupKey)) continue;
  seenDomains.set(dedupKey, row);

  allRows.push(row);
  const key = a.lead.Bransch || "Övrigt";
  if (!rowsByBransch[key]) rowsByBransch[key] = [];
  rowsByBransch[key].push(row);
}

const HEADER = "Bransch,Stad,Företag,Totalt,Tech,Content,Google-betyg,Recensioner,Telefon,E-post,Hemsida,Orgnr,Firmatecknare/VD,Namn,Titel,Rapport-URL\n";
function toCsv(rows) {
  rows.sort((a, b) => a.totalt - b.totalt);
  return HEADER + rows.map((r) => [
    esc(r.bransch), esc(r.stad), esc(r.foretag),
    r.totalt, r.tech, r.content,
    esc(r.betyg), esc(r.recensioner), esc(r.telefon), esc(r.email),
    esc(r.hemsida), esc(r.orgnr), esc(r.firmatecknare),
    esc(r.namn1), esc(r.titel1), esc(r.rapport),
  ].join(",")).join("\n") + "\n";
}

// Total-lista
fs.writeFileSync(path.join(OUT_DIR, "lead-lista.csv"), toCsv([...allRows]));
console.log(`✅ Totalt: ${allRows.length} leads → lead-lista.csv`);

// Per bransch
for (const [bransch, rows] of Object.entries(rowsByBransch)) {
  const fname = `lead-${slugify(bransch)}.csv`;
  fs.writeFileSync(path.join(OUT_DIR, fname), toCsv([...rows]));
  console.log(`   ${bransch}: ${rows.length} → ${fname}`);
}
