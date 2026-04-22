# Lead Scraper v2 — Svenska Hantverkare & Servicebolag

Skrapar svenska hantverkar-/servicebolag i stor skala via SerpAPI (Google Maps),
berikar med email, PageSpeed-scoring och bolagsinfo, lagrar i SQLite.

Mål: 20 000+ leads över tid, inkrementellt — kör lite i taget.

## Setup

```bash
npm install
cp .env.example .env
# Fyll i SERPAPI_KEY (krävs) och PAGESPEED_API_KEY (valfritt)
```

### API-nycklar

| Nyckel | Var | Kostnad |
|--------|-----|---------|
| `SERPAPI_KEY` | [serpapi.com](https://serpapi.com) | Gratis: 100/mån, Betalt: ~$50/5k |
| `PAGESPEED_API_KEY` | [console.cloud.google.com](https://console.cloud.google.com) | Gratis: $200 kredit/mån |

## Workflow

### Steg 1 — Skrapa bolag (SerpAPI)

```bash
# Testa — en bransch, en stad (dry-run, inga API-anrop)
node scrape.js --branch snickare --city Malmö --dry-run

# En bransch, en stad
node scrape.js --branch snickare --city Stockholm

# En hel bransch, alla 290 kommuner
node scrape.js --branch elektriker

# Alla 15 branscher × 290 kommuner (kör i bakgrunden, tar tid)
node scrape.js
```

Branscher: Tandvård, Skönhet & Hälsa, Frisörer, Restauranger & Caféer,
Redovisningsbyråer, Advokatbyråer, Konsultbolag, Fastighetsmäklare,
Städfirmor, Snickare, Elektriker, Takläggare, Målare, Hantverkare

Data sparas till `leads.db` (SQLite). Bolag med `scraped_at < 30 dagar` skippas.

### Steg 2 — Berika med email + PageSpeed

```bash
# Båda stegen
node enrich.js --limit 200

# Bara email-scraping (snabbt)
node enrich.js --email-only --limit 500

# Bara PageSpeed (långsammare, kräver API-nyckel för bra hastighet)
node enrich.js --pagespeed-only --limit 100
```

### Steg 3 — Bolagsinfo från allabolag.se (valfritt)

```bash
# Försiktig körning — 1 req/2s
node enrich-corp.js --limit 50

# Dry-run
node enrich-corp.js --dry-run
```

Matchar ~70-80% av bolagen mot org_nr, firmatecknare, omsättning, SNI-kod.

### Steg 4 — Exportera till CSV

```bash
# Alla bolag
node export.js

# Bara A+ och A leads med telefon
node export.js --priority "A+,A" --has-phone

# Snickare i Stockholm
node export.js --branch snickare --city Stockholm

# Anpassat filnamn
node export.js --out output/snickare-hot.csv --priority A+ --branch snickare
```

## Prioritetsystem (A+ → C)

| Prioritet | Betydelse | Poäng |
|-----------|-----------|-------|
| 🔥 A+ | Dålig sajt + seriöst bolag → kontakta direkt | ≥8 |
| 🟡 A  | Bra potential | ≥5 |
| 🔵 B  | Okej | ≥3 |
| ⚪ C  | Skippa | <3 |

Poäng ges för: låg SEO-score, låg performance, ej mobilvänlig,
högt Google-betyg (≥4.0), många recensioner (≥20).

## CSV-kolumner

| Kolumn | Beskrivning |
|--------|-------------|
| Bransch | Branschkategori |
| Stad | Kommun |
| Företag | Namn |
| Telefon | Telefonnummer (måste-ha) |
| Hemsida | URL |
| E-post | Scrapad från hemsidan |
| Betyg / Recensioner | Google Maps-betyg |
| Performance / SEO / Accessibility | PageSpeed (0–100) |
| Mobilvänlig | Ja/Nej (baserat på viewport/tap-targets audit) |
| Prioritet | 🔥 A+ → ⚪ C |
| Org.nr | Organisationsnummer (enrich-corp) |
| Firmatecknare | Namn (enrich-corp) |
| Omsättning / Anställda / SNI-kod | Bolagsdata (enrich-corp) |

## Migrera från v1

Befintliga `leads-*.csv` migreras till SQLite med:

```bash
node migrate.js
```

Kör bara en gång. Genererar deterministiska place_id:n från namn+adress.

## Filstruktur

```
scrape.js       — hämtar bolag via SerpAPI → SQLite
enrich.js       — email-scraping + PageSpeed
enrich-corp.js  — bolagsinfo från allabolag.se
export.js       — CSV-export från SQLite
migrate.js      — engångsmigration av gamla CSVer
db.js           — SQLite-schema + queries
config.js       — branscher, kommuner, konstanter
leads.db        — SQLite-databas (gitignorerad)
output/         — CSV-exporter
```
