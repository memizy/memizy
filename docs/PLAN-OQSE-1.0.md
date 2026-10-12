# Plán: OQSE 1.0 a zbytek cesty k 1.0 (workshop 22. 10. 2026)

Sepsáno 2026-10-07 po průchodu formátu OQSE, přepracováno 2026-10-12. Navazuje na „Cestu
k 1.0“ v [`PLAN-RC4.md`](./PLAN-RC4.md) (kroky 1 a 2 jsou hotové). Práce na větvi `oqse-1.0`.

**Termíny:** zkouška s hrami od AI 19.–20. 10. (SPEC), vydání 1.0.0 pár dní před
workshopem po ručním testu na telefonech.

## Jak pracujeme (dohoda s vlastníkem 2026-10-12)

- **Svisle po částech.** Pro každou část: nejdřív navrhnout změny **textu specifikace** a
  probrat je s vlastníkem → pak upravit specifikaci, kód a testy (včetně míst v protokolu,
  SDK a hrách, která na změnu přímo navazují, aby build prošel) → všechny testy → jeden
  commit → zaškrtnout → navrhnout další část.
- **Specifikace je zdroj pravdy** a nezávisí na jazyce: algoritmy (porovnání textu, data)
  popisuje slovy a kroky, referenční implementace `@memizy/oqse` je jen odkaz.
- Bod se zaškrtne, až je hotový text specifikace i kód s testy.
- Kód napsaný před specifikací leží na větvi `oqse-1.0-draft` (jen jako zdroj, nemergovat).

## Rozhodnutí vlastníka

| Bod | Rozhodnutí |
| :--- | :--- |
| Porovnávání textu | `ignoreDiacritics` výchozí **`true`**; i ve `fill-in-blanks` a `diagram-label` (psaní); pravidla porovnání přesně ve specifikaci |
| `trimWhitespace` | **zrušit** – ořez a sloučení mezer platí vždy |
| `numeric-input.range` | **zrušit** – jen `correctAnswer` (povinné) + `tolerance` |
| Formáty odpovědí | normativní oddíl ve specifikaci OQSE |
| Vlastní typy `x-` | rezervované pole `solution`, veřejná kopie ho odstraní |
| Verze | všechny formáty `1.0`, **čistý start**: knihovna čte jen 1.x, starší verze = chyba, žádné převody ani převodní skripty (0.3 nikdo mimo engine nepoužil) |
| Roky př. n. l. v `timeline` | **podporovat** |
| HTML bez funkce `html` | `sub`, `sup`, `br` povoleny vždy; Markdown v Rich Content platí vždy |
| UUID | **SHOULD v7, MUST platné UUID** (libovolná verze) |
| Přísná pravidla | chybějící `altText` při načtení jen varování; `checksums` a pořadí klíčů jen doporučení |
| `chess-puzzle` | upřesnit, čí tahy sekvence obsahuje |
| Veřejné položky | odstranit `sources[].quote`; `hints` výslovně veřejné |
| Opravy textu | všechny nalezené chyby (část 9) |
| Beze změny | viz „Vědomě beze změny“ |
| Sady mimo engine | teď ne (na workshop nejsou potřeba); převod jen skriptem v repu (část 10), knihovna nic nepřevádí |
| Sady uložené v Play (IndexedDB) | nic nedělat – nejsou tam důležité sady, znovu se naimportují |

## Hotovo mimo části

- [x] Relay: `ROOMS_PER_IP_PER_HOUR` (výchozí 1000, celá škola má jednu IP) – `958a0d4`.

---

## 1. OQSE 1.0 po částech

Dotčené soubory obvykle: `packages/oqse/oqse*.md` (spec), `src/oqse.ts` (typy),
`src/oqseValidation.ts` a `src/fileValidation.ts` (validace), testy, JSON schémata
(generují se buildem) a navazující `packages/protocol`, `packages/plugin-sdk`, `apps/play`.

### Část 0 – Úklid

- [x] Rozpracovaný kód odložen na větev `oqse-1.0-draft`, `oqse-1.0` čistá.
- [x] Plán přepsán na části se zaškrtáváním.

### Část 1 – Verze 1.0

- [x] Spec: sady `"version": "1.0"`, `$schema` `https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-v1.0.json`;
      OQSEM, OQSEP a OQSEH také `1.0` (nadpisy, příklady, URL schémat).
- [x] Spec: obecné pravidlo pro verze všech čtyř formátů – aplikace čte MAJOR verze, které
      podporuje (neznámé klíče novější MINOR ignoruje); nepodporovanou MAJOR (0.x i 2.x)
      MUST NOT potichu vykládat jako známou verzi, SHOULD odmítnout s jasnou zprávou, MAY
      „best effort“ po varování nebo převod. Knihovna: 0.x odmítne, 2.x načte s varováním.
      Markdown frontmatter `oqse: "1.0"`.
- [x] Kód: `OQSE_VERSION`, kontrola verze v loaderu a v Markdownu, názvy schémat
      (`generate-schemas.ts`), `package.json` (`files` se specifikacemi).
- [x] Manifest: verze `1.0`; host načte hru, když podporuje MAJOR verzi formátu manifestu
      (`version`) i protokolu (`appSpecific.memizy.protocol`); Play a knihovna 1.x podporují
      OQSEM 1 a protokol 1, manifest 0.x dostane jasnou zprávu.
- [x] SPEC 4.3: host podporuje **sadu verzí** (jednu na MAJOR, např. 1.4 a 2.1), ne právě
      jednu; `negotiateProtocolVersion` přijme i seznam verzí hosta (aby host mohl později
      podporovat hry s protokolem 1 i 2 zároveň); testy.
- [x] Sady v enginu na 1.0: `apps/play/src/data/sets/*`, `sampleSet.ts`, sady v testech,
      prompt AI sad (`aiSets.ts`); manifesty her (Babiš, Piráti, Civhrad) a příkladu v návodu.
- [x] Changelog specifikace „Version 1.0“ založit; každá další část do něj přidá svůj řádek.

### Část 2 – Porovnání textu

- [x] Spec: nový oddíl „Text comparison“ (slovy): NFC; ořez a sloučení bílých znaků;
      malá písmena podle výchozího převodu Unicode (nezávisle na jazyce); diakritika =
      rozklad NFD, odebrat znaky kategorie M, zpět NFC (`ł`, `ø`, `đ` zůstávají);
      `acceptPartial` = Damerau–Levenshtein (OSA, prohození sousedních = 1 úprava) po znacích Unicode z normalizovaných
      textů, nejvýš 0 do 3 znaků očekávané odpovědi, 1 do 7, jinak 2.
- [x] Spec: `ignoreDiacritics` výchozí `true`; pole `ignoreDiacritics` a `acceptPartial`
      i u `fill-in-blanks` a `diagram-label` (psaní); `trimWhitespace` zrušeno; rada pro
      pravopisná cvičení (`ignoreDiacritics: false`).
- [x] Kód: sdílené funkce v `@memizy/oqse`, typy, validace, `checkAnswer`; testy.

### Část 3 – `numeric-input` bez `range`

- [x] Spec: typ a validační pravidla (interval 100–120 = `correctAnswer: 110, tolerance: 10`).
- [x] Kód: typy (bez `NumericRange`), validace, `checkAnswer`, veřejné položky
      (`items.ts`), `ui.question`, Piráti (`item.range`); testy.
      Bez `ui.question` (s `range` nepočítal). Navíc: rezerva na zaokrouhlení (SHOULD, 1e-9),
      ukázat jen `correctAnswer` (SHOULD).

### Část 4 – Časová osa

- [x] Spec: roky př. n. l. historicky (`-0480-08-01` = 480 př. n. l., rok 0000 neexistuje; jen v datech událostí); pravidla porovnání:
      hrubší z obou přesností, bez `precision` = `datetime` s časem, jinak `day`;
      `datetime` jako okamžik včetně časového pásma (bez pásma = UTC); správné pořadí = všechny dvojice.
- [x] Kód: schéma data události, sdílené porovnání, `checkAnswer`, míchání (`displayItem`
      nikdy neukáže seřazené); testy.

### Část 5 – Formáty odpovědí a šachy

- [x] Spec: normativní oddíl „Answer formats“ (tabulka po typech, kanonický tvar, co čtečka
      toleruje, které typy nejdou vyhodnotit automaticky).
- [x] Spec: `chess-puzzle` – sekvence střídá obě strany od strany na tahu ve FEN, hráč
      hraje sudé pozice, aplikace odpovědi soupeře; SHOULD končit tahem hráče; odpověď =
      všechny odehrané tahy v SAN, `+ # ! ?` na konci se ignorují; poznámka k Lichess.
- [x] Kód: varování u sudé délky sekvence, komentář `checkAnswer`, odkaz ze SPEC 5.1; testy.
- [x] Navíc: sloupec „Correct when“; kartička = sebehodnocení 1–4 (OQSEP, správně 3–4),
      `ui.question` 4 tlačítka (`.mz-q-four`); šachy tolerují `0-0` a `e8Q`.

### Část 6 – Veřejné položky

- [x] Spec OQSE: `solution` u vlastních typů `x-`; SPEC 4.4: skrývá se `solution`,
      `sources[].quote`, `hints` jsou veřejné.
- [x] Kód: `publicItem` (`items.ts`); testy (`displayItems.test.ts`, `session.test.ts`).
      Navíc: `x-` dostanou `answerHidden: true`; ze SPEC 4.4 zmizel zapomenutý `range`.

### Část 7a – Rich Content a funkce

- [x] Spec: bez úrovní (tier); Rich Content vždy Markdown; `<sub>`, `<sup>`, `<br>` bez atributů
      vždy povolené; registr funkcí (formátování, bloky, zařízení) a záložní zobrazení pro
      každou funkci; neznámé funkce a vlastnosti = varování (dopředná kompatibilita);
      výstup se čistí vždy.
- [x] Handshake: tři úrovně `full` / `simplified` / `incompatible` (chybějící funkce jen
      zjednodušují, typy / média / verze jsou nekompatibilní).
- [x] Kód: `findRawHtml`, `assertNoRawHtml` (dřív `validateTier1Markdown`),
      `prepareRichTextForDisplay` vyžaduje a vždy spouští `htmlSanitizer`, tolerantní klíče
      funkcí, varování `UNKNOWN_FEATURE`, `checkCompatibility().level`, `toPlainText`
      (i v SDK); testy.
- [x] Návod a hry: `features: ["markdown", "latex", "html", "mermaid"]` pro texty přes SDK,
      jinak `[]` a `toPlainText`. Civhrad (texty kreslí sám) nechán na vlastníkovi.

### Část 7b – Detekce funkcí z obsahu

- [x] Spec: pravidla detekce slovy (bloky kódu s jazykem → `mermaid` / `smiles` /
      `abc-notation` / `syntax-highlighting`; HTML → `html`; Markdown konstrukce →
      `markdown`; `latex` se nedetekuje, jen odhad „vypadá jako vzorec“).
- [x] `detectFeatures(set)`; `checkCompatibility` používá deklarované ∪ zjištěné;
      varování při chybějící deklaraci; editory (Lab) doplní seznam při uložení; testy.
- [x] Navíc: `rtl` z jazyka; Civhrad `features: []`; ukázková sada poznámek deklaruje
      `syntax-highlighting` (detekce našla blok ` ```bash `).

### Část 7.5 – Hry bez otázek

- [x] OQSEM: `capabilities` (výchozí `{}`) a `actions` (výchozí `["render"]`) nepovinné;
      bez `types` aplikace nezpracovává položky (kompatibilní jen s prázdnou sadou).
      Pravidlo: co se v čase mění (`version`, `protocol`), zůstává povinné.
- [x] Memizy: `appSpecific.memizy.set` = `required` / `optional` / `none`; bez sady hra dostane
      prázdnou sadu (`createEmptySet`); `required` / `optional` bez `types` = chyba.
- [x] Play: hostitel i Lab přeskočí výběr sady (`none`) nebo nabídnou „Bez otázek“
      (`optional`); Civhrad `set: "none"`; návod; testy.

### Část 8 – Přísnost pravidel

- [x] Spec: UUID MUST platné, SHOULD v7; `altText` – při načtení varování a doplnění,
      při uložení chyba; `checksums` MAY varovat; pořadí klíčů SHOULD.
- [x] Kód: validace `altText` mimo schéma, komentář `generateUUID`, Play `aiSets.ts`
      → `generateUUID`; testy.

### Část 8.5 – Obrázky v Markdownu a místo pro mezery

- [x] Spec: `![alt](https://…)` výslovně povolené pro obrázky z webu (absolutní URL, `http`
      jen s varováním, jinak `<asset:… />`); `<blank:… />` jen v `text` u `fill-in-blanks` a
      `fill-in-select`, jinde varování a zobrazení jako prázdná čára.
- [x] Kód: `INVALID_IMAGE_URL` (relativní adresa = chyba při uložení), `BLANK_OUTSIDE_TEXT`;
      SDK už mezeru mimo doplňovačku kreslí jako čáru; testy.

### Část 9 – Opravy textu a changelog

- [x] Kompletní příklad: `match-complex.connections` `[1, 1], [2, 2]` → ID.
- [x] Příklad `math-input`: `"$2*x + 2$"` v `alternativeAnswers` → bez `$`.
- [x] Tabulka limitů: `prompts` / `matches` „must have equal length“ → rušivé možnosti.
- [x] `HotspotObject`: výčet `type` doplnit o `mesh`.
- [x] „Optimization for AI Generation“: příklad `options: ["A…"]` je zápis 0.2.
- [x] Zbytky starých verzí („OQSE v0.2 uses …“, „standard for OQSE v0.3“, „(in section 4)“).
- [x] Škrtnout „`ageMin == ageMax == 0` = neuvedeno“.
- [x] Oddíl „Validation Rules for Choices“, `minCorrect` apod. proti validátoru.
- [x] README balíčku (webový validátor, adresy `@1`), `docs/index.html`, odkaz na
      `memizy/set-test-suite` (aktualizovat nebo odebrat).
- [x] Changelog specifikace „Version 1.0“ dokončit (historie 0.x zkrátit).
- [x] Projít [`old-plan-oqse.md`](./old-plan-oqse.md) (původní plán) a ověřit, že nic nechybí.
- [x] Navíc: kompletní příklad má `features: ["markdown"]` a test (`specExamples.test.ts`)
      hlídá, že je přísně platný a deklaruje přesně zjištěné funkce; validátor na `@1`,
      escapuje hlášky, vzorová sada = `test-suite.oqse.json` z enginu; workflow
      `.github/workflows/oqse-pages.yml` → https://memizy.github.io/memizy/ (vlastník zapne
      Pages „Source: GitHub Actions“; stránka funguje až po vydání `@memizy/oqse@1`).

### Část 10 – Převodní skript (jen v repu, ne v balíčku)

- [x] `scripts/migrate-oqse.ts` nahradí `migrate-oqse-0.3.ts`: převod po krocích
      (0.2 → 0.3 = dnešní ID možností, 0.3 → 1.0), každý krok malá funkce; JSON i `.oqse.md`.
- [x] Krok 0.3 → 1.0 podle changelogu „Version 1.0“ (verze a `$schema`, bez `trimWhitespace`,
      `range` → `correctAnswer` + `tolerance`, … co přinesou části 2–8).
- [x] Výsledek ověří `safeValidateOQSEFile`; skript vypíše změny a co zkontrolovat ručně
      (např. přijímané odpovědi lišící se jen diakritikou → `ignoreDiacritics: false`).
- [x] Bez `--write` jen vypíše, co by udělal; test na ukázkových souborech 0.2 a 0.3.
- [x] Navíc: krok 0.1 → 0.2 (v kurzech jsou sady 0.1: `math` → `latex`, `answer` → …),
      manifesty her v `.html`, test v `bun run test` (`bun test scripts`).
      Zkouška nanečisto na `../courses`: 58 souborů, 34× `otazky_*.json` bez `meta.id`
      (nejsou to úplné sady), 1× HTML nadpisy v `set-ceska-historie-zabavne` – ručně.

### Vědomě beze změny (proč)

- `numeric-input.correctAnswer` povinné: hra po odpovědi ukazuje „správně bylo …“.
- `slider.step` povinné: výchozí 1 by bylo špatně u posuvníku 0–1.
- `lang` / `language`: přejmenování by se dotklo sad, Markdownu i platformy a nic nepřineslo.
- `bucket` 0–4 a `confidence` 1–4: dobře navržené, sedí na `AnswerRecord`.
- Všech 22 typů stabilních: tvary prošly kontrolou, odebrat typ později by bylo rozbíjející.
- Markdownový zápis sad (jen poznámky): beze změny kromě verze; otázky v Markdownu
  případně v 1.x jako rozšíření.

## 2. Průchod API host-sdk (z PLAN-RC4, krok 3)

Používá ho Play i platforma; po 1.0 jen přidávat. U každé části: názvy, volitelná pole,
typy událostí, chyby, co je veřejné a co vnitřní (`src/index.ts` dnes exportuje `*` ze
všech modulů – vnitřní věci neexportovat nebo označit `@internal`).

- [ ] `loadPluginFromHtml`, `prepareSetForPlugin` (návratové tvary, `seed`).
- [ ] `LocalSession`: volby konstruktoru (`shuffleSeed`, úložiště, služby, hodiny), metody
      (start, pauza, konec, hráči), událost `answer` (`record`, `generated`, `skills`,
      `tags`), chybové kódy.
- [ ] `mountPlugin`: volby, vrácený objekt, atributy iframu (oprávnění, CSP), úklid.
- [ ] `RelayHost` / `RelayPlayer` / socket: životní cyklus, opětovné připojení, události,
      zamčení místnosti a vyhození hráče, nahrání balíčku (`publicSet` + stejný seed).
- [ ] Zprávy relay (`relay/messages.ts`, `protocol/src/relay.ts`): neznámé typy zpráv a
      pole se ignorují (server i klienti 1.x se smí lišit), případně pole s verzí.
- [ ] `HostStorage`: metody, klíče, asynchronnost; `MemoryStorage` / IndexedDB jako vzor.
- [ ] Porovnat s tím, co importuje platforma (`../platform`), a s pokyny v `CLAUDE.md`
      („Using the engine from the platform“).
- [ ] README host-sdk s přehledem API.

## 3. E – test 3D se skutečným WebGL (z PLAN-RC4)

- [ ] Skript v repu (Playwright, Edge, SwiftShader): vykreslení, přepnutí 2D ↔ 3D, ztráta
      kontextu → 2D s hláškou, pomalá scéna → 2D jen jednou a po návratu hráče zůstane 3D,
      bez WebGL → 2D bez tlačítka 3D, výstřel ve 2D i 3D (Piráti).
- [ ] Spouštění popsat v `CLAUDE.md` (není součást `bun run test`, pokud je pomalý).

## 4. F – Návod pro AI (`docs/ai-plugin-guide.md`)

Musí pokrýt **vše od RC4**, ne jen poslední změny: kroky A–D, krok 1 (API SDK) a OQSE 1.0.
Pro každou věc jen jedna cesta.

- [ ] SDK: `ui.html` (i objekty v atributech `data-payload=${{ … }}`), `localActions`
      (signatura `(local, payload, ui)`), fáze bez `tickMs` a `ctx.goto` platí hned,
      pozdní akce řeší SDK (bez ručního `round` / `seq`), `ctx.actedAt` pro rychlost,
      `ui.now` jako vlastnost, `ui.pending`, `ui.setLocal` / `ui.local`, `data-local`,
      `playerView`, `ctx.reveal` / `ctx.hide` (i na začátku každé otázky), `ui.question`
      s `counts` a odeslanou odpovědí, `ui.escape` neexistuje.
- [ ] Rezervovaná pole stavu: `phase`, `phaseSeq`, `phaseEndsAt`.
- [ ] Stabilní háčky pro styl: třídy a proměnné `ui.question`, `data-option`,
      `--mz-q-index`, `data-type`; ostatní třídy jsou vnitřní.
- [ ] Výslovně součást kontraktu (z převodu her):
      1. pořadí potomků `.mz-q-options` = pořadí možností (pravda, nepravda);
      2. akce z `ui.question` má tvar `{ itemId, ...payload, answer }`;
      3. ve hrách s fázemi se zahazují všechny pozdní akce.
- [ ] 3D: `createScene3d` (`fov`, `near`, `far`), pravidla přepnutí do 2D, toast v `onFallback`.
- [ ] Mobil: políčka nezmenšovat pod 16 px, bez zoomu.
- [ ] Protokol RC4: `permissions`, `service()`, `recordAnswer.answer`, vygenerované položky.
- [ ] OQSE 1.0: tabulka položek a formátů odpovědí, bez `range` / `trimWhitespace`,
      diakritika, `solution` u `x-`, `chess-puzzle`, roky př. n. l., `sub` / `sup`.
- [ ] Manifest `"version": "1.0"`, import `@memizy/plugin-sdk@1`.
- [ ] Test `guideExample` odpovídá návodu; Lab kopíruje aktuální návod do promptů.
- [ ] Zkouška s hrami od AI (19.–20. 10.): několik her podle návodu, Lab + zlobivý hráč.

## 5. G – Dokumentace

- [ ] SPEC: stav „1.0“, changelog 1.0 (všechno od RC4 včetně kroku 1: `phaseSeq` a
      `actedAt` ve zprávách, pravidlo kompatibility mezi verzemi SDK), oddíl 10.
- [ ] `oqse.md` changelog „Version 1.0“, changelogy manifestu, pokroku a hlavičky.
- [ ] Changelog balíčků (`CHANGELOG.md` v každém balíčku zatím chybí – založit od 1.0.0).
- [ ] README balíčků: verze, adresy CDN `@1`, schémata.
- [ ] `CLAUDE.md` (engine): RC4 → 1.0, řádek o OQSE (verze, starší soubory), publikovaná
      verze (dnes `1.0.0-rc.3`), tabulka Layout (OQSE typy), odkaz na aktuální plán.
- [ ] `ARCHITEKTURA-A-PLAN.md` a `docs/presentation/` – zmínky o verzích a formátu.
- [ ] `PLAN-RC4.md` a tento plán odškrtat.

## 6. Vydání

- [ ] `bun run test`, `cd apps/play && bun run typecheck`, `bun run build:packages`,
      vygenerovaná schémata v commitu.
- [ ] Ruční test vlastníka na telefonech (iPhone: zoom, 3D; slabé zařízení).
- [ ] Verze **1.0.0** všech čtyř balíčků (`oqse`, `protocol`, `plugin-sdk`, `host-sdk`)
      a závislostí mezi nimi; publikace na npm v pořadí oqse → protocol → plugin-sdk →
      host-sdk; ověřit, že CDN `@1` vrací bundle SDK a schémata.
- [ ] Merge do `main` → nasazení Play (Workers); relay nasadit (`deploy.sh`), pokud se
      změnily jeho zprávy. Tag `v1.0.0`.
- [ ] Publikovat na npm **nejpozději 1–2 dny před workshopem** (návod importuje
      `@memizy/plugin-sdk@1` z CDN) a nasadit relay s novým limitem místností.
- [ ] Den před workshopem už nic nenasazovat; během workshopu otevřené logy relay
      (`ssh memizy-vps`), natištěný QR kód a adresa.
- [ ] Platforma: závislosti na 1.0.0, ukládání odpovědí podle formátů odpovědí.

## 7. Po workshopu (1.x, kontrakt nemění)

Odeslání akce na `pointerdown` (`data-act`), ochrana pozdních akcí i pro hry bez fází,
výjimka pro akce, které mají projít přes změnu fáze, pomocná funkce na kontrolu formátu
odpovědi, další jazyky textů SDK, klávesové zkratky v `ui.question`, výchozí `ui.local`,
zvuky, upozornění Labu na `render` bez `ui.html`; rezervované věci ze SPEC 10.

## Pořadí práce

1. OQSE 1.0 po částech 0–10 → 2. host-sdk → 3. E → 4. F (návod) → 5. G (dokumentace) →
6. vydání. Souběžně (vlastník): Astro landing na `memizy.com`, Play na `/play/`, prezentace.
