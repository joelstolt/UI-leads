# Affärsplan — Färska Leads (arbetsnamn)

> En fokuserad, färskhets-driven lead-tjänst byggd på leadsgoogle-motorn.
> Modell: **hybrid** (done-for-you tjänst nu → self-serve SaaS sen).
> Beachhead: **B2B-säljteam, mötesbokare & telemarketing i Sverige.**
> Upplägg: **eget separat bolag**, fristående från Stolt/WLM.
> Status: utkast 2026-06-06.

---

## 1. Tesen (en mening)

> Vi säljer **Vainu-kvalitet på datan, levererad som en färdig ringlista till en tusenlapp** —
> till de tusentals säljteam som aldrig kommer köpa ett enterprise-verktyg men idag
> sitter och prospekterar för hand.

Marknaden saknar inte data. Den saknar **träffsäkra, berikade, FÄRSKA, färdiga listor
till SMB-pris.** Det är tomrummet mellan *gratis-men-manuellt* (allabolag/hitta/eniro)
och *dyrt-enterprise* (Vainu/Bisnode/Cognism, 15–50k+/år). Vår motor sitter exakt där.

---

## 2. Problemet (validerat)

Bevis #1: Joels kusin — teamleader, B2B-säljare i flera år — prospekterar **manuellt**,
trots att han känner till verktygen, och sa spontant att han **lätt betalar 1 000 kr/mån**
för att slippa. Han är inte ett undantag; han är representativ för en hel köparklass.

Vad en säljare faktiskt vill ha:
- Rätt bolag (nisch + storlek + geografi), inte 10 000 brusiga rader.
- **Telefonnummer + rätt kontaktperson + roll** — inte bara info@.
- Berikning som hjälper pitchen (omsättning, Google-betyg, om de redan annonserar).
- **Nya leads varje månad** — inte samma lista om och om igen.
- Levererat. Inget verktyg att lära sig.

---

## 3. Produkten

### Byggd på en motor som redan finns (leadsgoogle)
- **105 000+ bolag** i DB, 5 länder, ~490 städer, ~60 branscher.
- **Gratis allabolag-discovery** (`/api/search`) → namn, orgnr, telefon, omsättning,
  anställda, SNI, adress. *Eliminerar den största löpande kostnaden i branschen.*
- **10+ berikningssteg:** e-post, PageSpeed/SEO, bolagsdata, tech-stack, sitemap,
  Domain Rank, Meta-annonser, chatbot/booking/pixel, hitta.se-omdömen, AI-USP.
- **Scoring + AI-outreach** (mejl/LinkedIn/telefon-pitch) + per-lead-rapporter.
- **Next.js-dashboard**, CSV/ZIP-export, multi-tenant brand-system, Turso-sync.

### Vad som måste byggas för att bli en produkt åt andra (gapet)
1. **Templatisera filtren.** Idag är varje lista ett bespoke-script. Gör reglagen till
   en återanvändbar produkt: `bransch/SNI · geografi · omsättning · anställda · Google-betyg · har hemsida · marknadsföringsspärr`.
2. **Generisk scoring.** Dagens A+/C letar "dålig sajt att sälja marknadsföring till" — det
   är *vår* gamla nisch. Köparen behöver scoring efter *deras* mål (storlek, mognad, intent).
3. **Färskhets-/trigger-flöde** (se §7 — detta är vad som gör det till en prenumeration).
4. **Leverans-ops:** order → kö → automatisk berikning on-demand → snygg leverans.
5. **Senare (SaaS-fasen):** auth, Stripe-billing, självbetjänings-orderformulär, kundportal.

---

## 4. Målgrupp (beachhead → expansion)

**Beachhead (fas 1): B2B-säljteam, mötesbokare, telemarketing.**
- Köper telefon-listor per nisch. Priskänsliga men höga ROI (en bokad affär betalar månader).
- Varmast ingång: via kusinen (han känner peers, byråer, andra teamledare).

**Expansion (senare), samma motor, andra filter/triggers:**
- Marknads- & SEO-byråer (dålig-sajt-signal passar din befintliga scoring).
- Rekrytering & bemanning (bolag som växer/anställer → trigger-leads).
- SaaS/tech-säljteam, försäkrings-/energi-/telecom-mäklare, konsulter.

**ICP fas 1 (vem vi jagar först):** litet/mellan säljteam (2–20 säljare) eller
mötesboknings-/telemarketingbyrå i Sverige som kör utgående mot SMB i en definierbar bransch.

---

## 5. Marknad & potential (Sverige)

> Ärliga, bottom-up-estimat — inte uppblåst TAM. Markerade som antaganden.

- **TAM (Sverige):** alla med utgående B2B-sälj mot en definierbar bransch — tiotusentals
  bolag/team (säljteam, byråer, rekryterare, bemanning, mäklare). Grovt: **10 000–20 000**
  potentiella köpenheter.
- **SAM (realistiskt nåbara fas 1–2):** små/mellan säljoperationer + mötesbokare som värderar
  färdiga listor — grovt **3 000–6 000** köpenheter.
- **SOM (vinnbart år 1–2):** **100–400 betalande kunder** är fullt realistiskt utan raketbränsle.

**Jämförelse (för proportion):** Vainu (nordiskt, samma kategori) omsatte i storleksordning
€10–20M på toppen med enterprise-pris; Bisnode/D&B Nordic är mångmiljardklass. Vi tar inte
dem — vi tar **den billiga änden de struntar i.** Även en liten skiva = flermiljonsbolag.

---

## 6. Affärsmodell & prissättning

| Paket | Pris/mån | Innehåll |
|------|----------|----------|
| **Starter** | 990 kr | 1 nisch, 1 region, ~150 färska leads/mån, telefon + grundberikning |
| **Pro** | 2 490 kr | Flera nischer/regioner, ~500 leads/mån, full berikning + triggers + kontaktperson |
| **Team/Byrå** | 5 900 kr | Multi-seat, hög volym, custom-filter, CSV/Sheets/CRM-export, prioriterad support |
| Engångslista | 1 490 kr | Test-/instegsköp utan abonnemang (uppsälj till abonnemang) |

- **Recurring** från dag ett (annars äter churn dig — se §7).
- **Blended ARPU-antagande: ~1 700 kr/mån.**
- Årsrabatt (10 mån-pris) för cashflow + lägre churn.

### Enhetsekonomi (per kund/månad)
- Rörlig kostnad att producera en lista: allabolag (gratis) + ev. SerpAPI Google-omdömen
  (~$0.01/lead) + PageSpeed (gratis) + AI-pennies. **~10–50 kr per leverans.**
- **Bruttomarginal ~95%.** I princip noll marginalkostnad → break-even nästan omedelbart.
- CAC fas 1: ~0 kr (kusinens nätverk + dogfooding + din egen räckvidd).

---

## 7. Churn-lösningen: från "lista" till "flöde" (kärnan i hela affären)

En lista används upp → engångsförsäljning. Lösningen är att leverera **NET-NYA bolag +
trigger-händelser** varje månad. Det förvandlar engångsköp till abonnemang:

- **Nyregistrerade bolag** i målgruppens SNI (Bolagsverket/allabolag nyregistreringar).
- **Platsannons-trigger:** bolag som just sökt säljare/expanderar (Platsbanken har **gratis API**).
- **Webb-/annons-trigger:** ny hemsida, byte av tech, *börjat köra Meta-annonser* (du detekterar redan ads + tech).
- **Tröskel-trigger:** passerat en omsättnings-/anställd-gräns.

Detta är din starkaste differentiator OCH din anti-churn-mekanism. Du har redan halva
byggstenarna; Platsbanken-triggern är billig och hög-signal att lägga till.

---

## 8. Konkurrens & positionering

| Segment | Exempel | Svaghet vi utnyttjar |
|--------|---------|----------------------|
| Gratis & manuellt | allabolag, hitta, eniro, Merinfo | Ingen berikning, ingen scoring, timmar av handjobb |
| Enterprise-data | Vainu, Bisnode/D&B, Cognism | 15–50k+/år, verktyg du måste lära dig — overkill för små team |
| Generiska listmäklare | diverse | Gammal data, ingen färskhet, ingen nisch-träffsäkerhet |

**Positionering:** *"Färdiga, färska ringlistor för ditt exakta segment — levererat, inte ett verktyg. Från 990 kr."*

**Vallgrav (ärligt: tunn på teknik, byggs på annat):**
1. **Färskhet/triggers** — svårare att kopiera än en skrapning.
2. **Nisch-djup** — äg 2–3 vertikaler bättre än någon annan.
3. **Service + brand** — bli "the leads-guy" i ett par branscher.
4. **Switching cost** — sparade filter, CRM-integration, inarbetat flöde.

---

## 9. Go-to-market (distribution = den riktiga flaskhalsen)

**Fas 0 — Validera (vecka 1–2):**
- Leverera en skarp lista till kusinen. **Ta betalt 1 000 kr på riktigt.** En betald faktura > tusen "skulle du betala".
- Intervjua honom: *vad gör en lead till guld vs skräp?* → din produktspec.
- Ladda 3–5 av hans peers för samma fråga. 3 av 5 ja = grönt ljus.

**Fas 1 — Done-for-you, 10 kunder (månad 1–3):**
- Kusinens nätverk (teamledare känner teamledare).
- **Dogfooding:** använd leadsgoogle för att hitta mötesboknings-/telemarketing-/säljbyråer
  och pitcha dem — din egen produkt som bevis.
- Din egen räckvidd (LinkedIn, nätverk). Manuell leverans, lär dig mönstren.

**Fas 2 — Produktifiera (månad 3–6):**
- Templatisera topp-filtren. Enkelt orderformulär + Stripe. Egen landningssida.
- **SEO-inbound (din superkraft):** ranka för "köpa leads [bransch]", "ringlista [bransch]",
  "prospektlista [stad]". Låg CAC över tid — det är därför *du* har en orättvis fördel här.

**Fas 3 — Self-serve SaaS (månad 6–12):**
- Auth + billing + kundportal (forka din befintliga Next.js-dashboard).
- "Välj nisch + region + storlek → få färska leads varje måndag."
- API/CRM-export. Innehållsmotor för inbound i full skala.

---

## 10. Roadmap (sammanfattad)

| Fas | Tid | Mål | Bevis på framgång |
|----|-----|-----|-------------------|
| 0. Validera | v.1–2 | 1 betalande (kusinen) + spec | Faktura betald |
| 1. Done-for-you | mån 1–3 | 10 kunder, manuell leverans | ~15–25k MRR, mönster lärda |
| 2. Produktifiera | mån 3–6 | Orderflöde + Stripe + SEO-sidor | 30–60 kunder, halv-automatiskt |
| 3. SaaS | mån 6–12 | Självbetjäning + inbound-motor | 100+ kunder, mestadels automatiskt |

---

## 11. Finansiell potential (scenarier)

> Antagande: ARPU ~1 700 kr/mån, bruttomarginal ~90–95%.

| Scenario | Kunder | MRR | ARR | Kommentar |
|---------|--------|-----|-----|-----------|
| Försiktig | 25 | ~42 000 kr | ~0,5 Mkr | Bra bisyssla, nästan passiv |
| **Bas** | **100** | **~170 000 kr** | **~2,0 Mkr** | Riktigt bolag, ~1,8 Mkr bruttovinst |
| Optimistisk | 300 | ~510 000 kr | ~6,1 Mkr | Kräver SaaS + säljmotor |
| Tak (SaaS moget) | 1 000 | ~1,7 Mkr | ~20 Mkr | Långsiktigt, nordisk expansion |

**Slutsats om potential:** Detta blir aldrig en defensiv-över-en-natt-SaaS. Men en
**fokuserad, hög-marginal nisch-tjänst på 2–6 Mkr ARR är fullt realistisk** — och eftersom
marginalkostnaden är nära noll är nedsidan låg och break-even nästan omedelbar. Kategorin är
bevisad (Vainu/Bisnode). Ett 5–6 Mkr ARR-bolag med 90% marginal är både en stark kassako och säljbart.

---

## 12. Risker & motåtgärder (helt ärligt)

| Risk | Allvar | Motåtgärd |
|------|--------|-----------|
| **Legal/ToS/GDPR** — sälja vidare allabolag-skrapad data | **Hög** | Byt till licensierbara källor för produkten (Bolagsverket, SCB Företagsregister, Roaring, Bizzdo). Håll B2B-personuppgifter på berättigat intresse, respektera marknadsföringsspärr + NIX, sälj aldrig personlig mobil utan grund. Villkor + DPA. **Lös detta INNAN du tar betalt av främlingar.** |
| **Churn** — listan tar slut | Hög | Färskhets-/trigger-flödet (§7). Sälj abonnemang, inte engångslistor. |
| **Distribution/CAC** | Hög | Kusin-nätverk + dogfooding + SEO-inbound (din styrka). |
| **Commoditisering / tunn teknik-vallgrav** | Medel | Nisch-djup, färskhet, service, switching cost (§8). |
| **Blockering** (allabolag rate-limit) | Medel | Redan backoff/UA-rotation; licensierad data tar bort risken helt i produkten. |
| **Key-man (allt är Joel)** | Medel | Dokumentera + automatisera; VA för leverans-ops i fas 1–2. |

---

## 13. Nästa steg (denna vecka)

1. **Ta betalt av kusinen** — 1 000 kr, skarp lista, riktig faktura. Validering #1.
2. **Spec-intervju** — vad är guld vs skräp? Skriv ner reglagen.
3. **Städa generatorn** — fixa `[object Object]` + CSV-citat-buggarna så leveransen är ren.
4. **Bestäm datakälla för produkten** — skrapa internt vs licensiera (legal-grind).
5. **Lägg till Platsbanken-trigger** — billig, hög-signal, gör abonnemanget verkligt.

---

## Bilaga A — Namnförslag (eget bolag)

Färska Leads · Säljlistan · Ringlistan · Leadflöde · Prospektor · Leadhive ·
Nystart Leads · Träffbart · Pipeline.se · Färskvara (leads)

## Bilaga B — Tech som redan finns vs ska byggas

| Finns ✅ | Ska byggas 🔨 |
|---------|---------------|
| allabolag-discovery (gratis) | Templatiserade filter (produkt) |
| 10+ berikningssteg | Generisk, köpar-styrd scoring |
| Scoring + AI-outreach | Trigger-/färskhetsflöde (Platsbanken m.m.) |
| Next.js-dashboard | Orderformulär + Stripe-billing |
| CSV/ZIP-export, Turso-sync | Kundportal / självbetjäning |
| Multi-tenant brand-system | Licensierad datakälla (legal) |
