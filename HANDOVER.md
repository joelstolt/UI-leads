# Handover — leadsgoogle

**Senast uppdaterad:** 2026-04-22

> Läs detta först om du är en ny Claude-session eller hoppar tillbaka in i projektet efter en paus.

---

## TL;DR — vart vi är nu

Lead-prospekteringssystem för svenska/UK-marknaden, med:
- **CLI-pipeline** (Node.js) för discover + scrape + enrich + outreach
- **Next.js 16-UI** för dashboard, leads-tabell, audit-rapporter
- **Multi-brand** (wlm-se / wlm-ie / flodo) med per-lead-tilldelning
- **AI-genererad outreach** (Claude Haiku 4.5) per A+/A-lead
- **Brand-färgade SEO-rapporter** per lead (live på `/audit/[id]` + statisk HTML-export)

**Just nu:** allt funkar lokalt på `localhost:3001`. Pushad till `https://github.com/joelstolt/UI-leads` (main). DB:n (`leads.db`) ligger lokalt — **ej deployad till Vercel än**.

---

## DB-status (10 868 leads)

| Mätning | Antal |
|---|---|
| Totalt | 10 868 |
| Med telefon | 9 977 |
| Med hemsida | 9 034 |
| Med e-post | 3 194 |
| PageSpeed-analyserade | 300 |
| Tech-stack scannade | 9 033 |
| Sitemap scannade | 9 033 |
| Domain Rank scannade | 9 024 |
| Brand-tilldelade | 10 868 (auto: 9 090 wlm-se, 1 754 wlm-ie, 24 flodo) |
| **Äkta A+** | **2** (efter null-bug-fix; var 39 falska tidigare) |
| **Äkta A** | **109** |
| Sajter med `tech_stack=error` (akuta!) | 676 |

---

## Vad som ÅTERSTÅR (när du kommer tillbaka)

### 1. Turso + Vercel-deploy (~35 min totalt)

Detaljerade steg står i `STEG-FOR-STEG.md` — sammanfattat:

```bash
# Lokalt:
brew install tursodatabase/tap/turso
turso auth login
turso db create leadsgoogle
turso db show leadsgoogle --url       # → TURSO_DATABASE_URL i .env
turso db tokens create leadsgoogle    # → TURSO_AUTH_TOKEN i .env
node sync-to-turso.js                 # ~3 min, lyfter alla 10 868 leads
```

Sedan i Vercel-dashboarden:
1. Add New → Project → Import `joelstolt/UI-leads`
2. Root Directory: `web`
3. Env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `PAGESPEED_API_KEY`, `OPENPAGERANK_API_KEY`
4. Deploy

### 2. Lägg till subdomäner (Cloudflare)

Per domän (welovemarketing.se / welovemarketing.ie / flodo.se):
- DNS → Add record
- Type: `CNAME`, Name: `audit`, Target: `cname.vercel-dns.com`
- Proxy status: **DNS only (grå moln)** — viktigt, inte orange

### 3. Uppdatera brand-config

I `web/src/lib/brands.ts` — byt `domain` per brand till `audit.*`-varianten:
- `domain: "welovemarketing.se"` → `domain: "audit.welovemarketing.se"`
- Samma för wlm-ie + flodo

Push → Vercel auto-deploys.

### 4. Workflow efter deploy

Varje gång du kört en batch lokalt (`npm run pipeline` eller enskilda steg):

```bash
node sync-to-turso.js   # eller: npm run sync
```

Det pushar nya/ändrade rader till Turso. Live-sajten uppdateras automatiskt.

---

## Vad som finns färdigt (alla committade på `main`)

### CLI-scripts (i projektroten)
- `scrape.js` — Google Maps via SerpAPI
- `enrich.js` — email-scrape + PageSpeed
- `enrich-tech.js` — tech-stack detection (Wix/WP/etc)
- `enrich-sitemap.js` — sitemap.xml + robots.txt
- `enrich-domainrank.js` — OpenPageRank DR
- `enrich-corp.js` — allabolag.se bolagsinfo
- `enrich-ads.js` — Meta Ad Library (kräver `META_ACCESS_TOKEN`)
- `outreach-gen.js` — AI-genererad mejl/LinkedIn/telefon-pitcher
- `discover-allabolag.js` — gratis SerpAPI-killer (~$0/lead vs $0.01)
- `assign-brands.js` — engångs-migration brand-tilldelning
- `sync-to-turso.js` — lokal SQLite → Turso cloud
- `pipeline.js` — orkestrerar alla enrich-steg sekventiellt
- `crm-sync.js` — webhook till CRM
- `export.js` — CSV-export
- `migrate.js` — ursprunglig CSV → SQLite

### UI (i `web/`)
- Dashboard med widgets per brand/sitemap-storlek/DR/plattform
- `/leads` — combobox-filter, brand-dropdown, detail-Sheet, CSV+ZIP-export
- `/discover` — brand-picker + bransch + stad
- `/scrape` — brand-picker + branscher + städer + cost-estimat
- `/enrich` — 9 olika enrich-typer
- `/sync` — CRM-sync
- `/runs` — historik per dag + paginerad lista
- `/audit/[placeId]` — brand-färgad SEO-rapport per lead
- `/api/audit-html/[placeId]` — standalone HTML-download
- `/api/audit-html-zip` — bulk-zip av filtrerade leads

### Brand-system
- 3 brands i `web/src/lib/brands.ts`:
  - **wlm-se** (We Love Marketing SE) — röd #E63946 — auto för SE/NO/DK
  - **wlm-ie** (We Love Marketing IE) — röd, engelsk copy — auto för GB/IE
  - **flodo** (Flodo) — grön #22C55E — manuell tilldelning
- BrandPicker på Discover + Skrapa med localStorage-persistence
- Brand-dropdown per lead i Sheet:en
- Audit-rendering: brand från `lead.brand` ELLER request.host

---

## Konfiguration

### .env (lokalt — ej committad)
Kräver minst:
```
SERPAPI_KEY=...                      # för scrape.js
PAGESPEED_API_KEY=...                # gratis 25k/dag, $200 free credit
ANTHROPIC_API_KEY=sk-ant-...         # för outreach-gen + enrich-usp
OPENPAGERANK_API_KEY=...             # gratis 1000/dag, krävs för enrich-domainrank
META_ACCESS_TOKEN=                   # valfritt, för enrich-ads
TURSO_DATABASE_URL=                  # behövs när du satt upp Turso
TURSO_AUTH_TOKEN=                    # samma
```

`.env.example` finns committad med dokumentation per nyckel.

### Brand-config (`web/src/lib/brands.ts`)
Här ändrar du namn, mejl, telefon, tagline, accent-färger per brand. Påverkar audit-sidor + outreach-mejl + footer.

---

## Sentida arkitektur-val

### Varför Turso (libsql) över Supabase (Postgres)?
Samma SQL-syntax som lokal SQLite → mindre migration-jobb. Web-app:en async-ifierad (alla queries `await`), CLI-scripten skriver fortfarande mot lokal `leads.db`. Sync sker via `sync-to-turso.js`.

### Varför separat audit-subdomän per brand?
Befintliga sajter (welovemarketing.se etc) ligger redan på Vercel som SEPARATA projekt. Vi kan inte peka samma rotdomän på två deploys, så `audit.*`-subdomäner pekar på vår audit-deploy. Brand-rendering sker via host-detection i `web/src/app/audit/[placeId]/page.tsx`.

### Varför CLI lokalt + Turso för UI?
SerpAPI/PageSpeed-quota lever i ditt lokala konto. CLI är snabbt mot lokal SQLite. Sync-script pushar bara ändringar — inga dubbletter.

---

## Buggfixar att vara medveten om

Tidigare PageSpeed-batchar sparade `0/100` istället för `null` vid timeout — gjorde att 8+ leads klassades som falska A+. **Fixat** i commit `12a781a`. Om du re-mäter äldre data kan du kolla:

```sql
SELECT COUNT(*) FROM companies WHERE performance = 0 AND load_time = '?';
```

Om det är >0: kör `sqlite3 leads.db "UPDATE companies SET performance=NULL, seo=NULL, accessibility=NULL, load_time=NULL, mobile_friendly=NULL, priority=NULL, pagespeed_at=NULL WHERE performance=0 AND load_time='?';"` och sedan `node enrich.js --pagespeed-only --limit 500`.

Liknande null-handling-fixar i `enrich-domainrank.js`, `enrich-tech.js`, `outreach-gen.js`, `audit-page.tsx` — commit `7e29fdb`.

---

## Senaste commit-kedja

```
f918bfd feat(db): migrera till libsql/Turso för Vercel-deploy
ad675e6 feat(audit): standalone HTML-export per lead + bulk-zip
5b01ff1 feat(brand): brand-picker på Discover + Skrapa, persistent default
60814a9 feat: multi-brand setup (wlm-se / wlm-ie / flodo)
7e29fdb fix: 5 null-handling-buggar i enrich + outreach-pipeline
12a781a fix(enrich): spara null vid partiell PageSpeed-mätning, inte 0
4f79980 feat(audit): WeLoveMarketing-stilad SEO-rapport per lead
ee4eae3 feat: per-Domain-Rank-widget på dashboard + DR-filter
c237d98 feat: per-sitemap-storlek-widget på dashboarden
2c1c887 feat: Domain Rank via OpenPageRank (gratis 1000/dag)
16c4236 feat: Bolagsverket-style discovery via allabolag.se
ab0e644 feat: tech-stack detection
```

Hela historik på branchen `main` i `https://github.com/joelstolt/UI-leads`.

---

## Quick-start om du är en ny chatt

1. **Läs denna fil först** — orientera om var vi är
2. Kör `git log --oneline -15` för senaste ändringar
3. Kör `npm run dev` i `web/` för att se UI:n på localhost:3001
4. Kolla `STEG-FOR-STEG.md` (om den finns) för deploy-steg
5. Användaren vill troligen fortsätta från "Återstår"-sektionen ovan

---

## Kontakt + brand-info som koden refererar

```ts
// web/src/lib/brands.ts
{
  "wlm-se":  { domain: "welovemarketing.se",  email: "joel@welovemarketing.se",   phone: "+46 73 554 69 68" },
  "wlm-ie":  { domain: "welovemarketing.ie",  email: "hello@welovemarketing.ie", phone: "+46 73 554 69 68" },
  "flodo":   { domain: "flodo.se",            email: "hej@flodo.se",              phone: "+46 72 987 03 87" },
}
```
