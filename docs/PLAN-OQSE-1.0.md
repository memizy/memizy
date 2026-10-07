# Plán: OQSE 1.0 a zbytek cesty k 1.0 (workshop 22. 10. 2026)

Sepsáno 2026-10-07 po průchodu formátu OQSE. Navazuje na „Cestu k 1.0“ v
[`PLAN-RC4.md`](./PLAN-RC4.md) (kroky 1 a 2 jsou hotové). Práce na větvi `oqse-1.0`.
Hotové body se odškrtávají.

**Termíny:** zkouška s hrami od AI 19.–20. 10. (SPEC), vydání 1.0.0 pár dní před
workshopem po ručním testu na telefonech.

## Rozhodnutí vlastníka (2026-10-07)

| Bod | Rozhodnutí |
| :--- | :--- |
| Porovnávání textu | `ignoreDiacritics` výchozí **`true`**; i ve `fill-in-blanks` a `diagram-label` (psaní); pravidla porovnání přesně ve specifikaci |
| `trimWhitespace` | **zrušit** – ořez a sloučení mezer platí vždy |
| `numeric-input.range` | **zrušit** – jen `correctAnswer` (povinné) + `tolerance` |
| Formáty odpovědí | normativní oddíl ve specifikaci OQSE |
| Vlastní typy `x-` | rezervované pole `solution`, veřejná kopie ho odstraní |
| Verze | všechny formáty `1.0`; 1.0 načte i 0.3 |
| Roky př. n. l. v `timeline` | **podporovat** |
| HTML bez funkce `html` | `sub`, `sup`, `br` povoleny vždy; Markdown v Rich Content platí vždy |
| UUID | **SHOULD v7, MUST platné UUID** (libovolná verze) |
| Přísná pravidla | chybějící `altText` při načtení jen varování; `checksums` a pořadí klíčů jen doporučení |
| `chess-puzzle` | upřesnit, čí tahy sekvence obsahuje |
| Veřejné položky | odstranit `sources[].quote`; `hints` výslovně veřejné |
| Opravy textu (B) | všechny |
| Beze změny (C) | `numeric-input.correctAnswer` a `slider.step` povinné, `lang` / `language`, `bucket` 0–4, `confidence` 1–4, všech 22 typů |

---

## 1. Formát OQSE 1.0 (`packages/oqse`)

U každého bodu: specifikace (`oqse.md`), typy (`oqse.ts`), validace (`oqseValidation.ts`,
`fileValidation.ts`), testy, JSON schéma (generuje se), changelog specifikace.

### 1.1 Porovnávání textu

- [ ] Normativní algoritmus ve specifikaci (nový pododdíl „Text comparison“), stejný pro
      `short-answer`, `fill-in-blanks` a `diagram-label` s `requireTyping`:
      1. Unicode NFC;
      2. vždy: ořez mezer na začátku a konci, mezery uvnitř sloučit do jedné;
      3. bez `caseSensitive: true`: malá písmena (nezávisle na jazyce);
      4. s `ignoreDiacritics` (výchozí `true`): NFD, odstranit znaky kategorie `M`, NFC;
      5. `acceptPartial`: Levenshteinova vzdálenost od očekávané odpovědi (po normalizaci)
         nejvýš 0 do 3 znaků, 1 do 7 znaků, jinak 2.
- [ ] `ignoreDiacritics` výchozí `true` (`short-answer`); nově pole `ignoreDiacritics`
      a `acceptPartial` i u `fill-in-blanks` a `diagram-label`.
- [ ] Zrušit `trimWhitespace` (`short-answer`, `fill-in-blanks`) z typů, validace a textu.
      Starý klíč v datech je neznámý klíč (ignoruje se).
- [ ] Rada pro autory: pravopisná cvičení (háčky, čárky) nastaví `ignoreDiacritics: false`.

### 1.2 `numeric-input` bez `range`

- [ ] Odebrat `range` (typy, validace, spec včetně oddílu „For `range` in `numeric-input`“,
      typ `NumericRange`, pokud ho nic jiného nepoužívá).
- [ ] Text: správně je `|hodnota − correctAnswer| ≤ tolerance`; interval 100–120 se zapíše
      jako `correctAnswer: 110, tolerance: 10`.
- [ ] Tolerantní načtení 0.3 převede `range` v paměti (viz 1.11).

### 1.3 Formáty odpovědí (normativně)

- [ ] Nový oddíl „Answer formats“ v `oqse.md`: tabulka podle typu (dnes komentář v
      `packages/plugin-sdk/src/checkAnswer.ts`), kanonický tvar a co musí čtečka tolerovat
      (číslo jako text s desetinnou čárkou, `"true"` / `"false"`, `pin-on-image` jeden bod
      nebo pole bodů podle `multipleCorrect`, totéž u `pin-on-model`).
- [ ] Které typy nejdou vyhodnotit automaticky (`note`, `flashcard`, `open-ended`, `x-`).
- [ ] Odkaz z SPEC (`recordAnswer.answer`) a z komentáře `checkAnswer` na tento oddíl.

### 1.4 Vlastní typy `x-`: pole `solution`

- [ ] Spec („Adding Custom Item Types“): vše, co prozrazuje odpověď, patří do `solution`
      (libovolná hodnota JSON). Validátor ho nekontroluje, jen zachová.
- [ ] Veřejná kopie (`publicItem`) u `x-` odstraní `solution`, `explanation` a
      `incorrectFeedback` a nastaví `answerHidden: true` (dnes posílá položku beze změny).

### 1.5 `timeline`: roky před naším letopočtem

- [ ] Regex data: volitelné znaménko `-` před čtyřmístným rokem (`-0480-08-01`); rok 0 = 1 př. n. l.
- [ ] Sdílená funkce v `@memizy/oqse`, např. `compareTimelineDates(a, b)`: rok jako celé
      číslo se znaménkem, pak zbytek; přesnost (`year` / `month` / `day` / `datetime`) podle
      hrubší z obou událostí. **Nepoužívat `new Date`** (záporné roky v tomto tvaru neumí).
- [ ] Použít ji v `checkAnswer` (`timeline`) i v `displayItem` (kontrola „není seřazeno“).
- [ ] Testy: `-0480` < `-0031` < `0001`, `-0001` < `0001`, rok vs. den se stejným rokem = souběžné.

### 1.6 HTML a Markdown

- [ ] Rich Content je vždy GFM; funkce `markdown` je jen údaj pro manifest (aplikace umí
      Markdown). Vyjasnit v „Text Formatting“, registru funkcí a tabulce úrovní (Tier 1/2).
- [ ] Bez funkce `html` povolit `<sub>`, `<sup>`, `<br>` (bez atributů). Upravit hledání
      syrového HTML (`findRawHtml`) a text v „Security“. Ověřit, že `richText.ts` v SDK
      (DOMPurify) je propustí (výchozí nastavení ano).

### 1.7 UUID a zbytečně přísná pravidla

- [ ] Globální pravidla a oddíl „UUID Validation Rules“: ID MUST být platné UUID (kontroluje
      se tvar), nová ID SHOULD být UUIDv7. Zachování ID při re-exportu zůstává MUST.
- [ ] Komentář `generateUUID` v `utils.ts` („required“ → „recommended“).
- [ ] Play: `apps/play/src/lib/aiSets.ts` místo `crypto.randomUUID()` → `generateUUID`
      z `@memizy/oqse`. Projít i další místa, kde Play vytváří ID.
- [ ] Obrázek bez `altText`: tolerantní načtení = varování (položka zůstane), přísné
      uložení = chyba (dnes načtení zahodí celou položku, spec v „Fallback“ říká opak).
- [ ] Chybějící `checksums`: aplikace MAY varovat (dnes SHOULD).
- [ ] Pořadí klíčů v kořeni (`$schema`, `version`, `meta`, `items`): SHOULD (dnes MUST).

### 1.8 `chess-puzzle`

- [ ] Každá sekvence střídá tahy obou stran, začíná strana na tahu podle `fen`. Hráč hraje
      tahy na sudých pozicích (0, 2, …), aplikace odehraje odpovědi soupeře ze sekvence.
      Sekvence SHOULD končit tahem hráče (lichá délka; jinak varování).
- [ ] Odpověď (`checkAnswer`) = všechny odehrané tahy včetně odpovědí soupeře, v SAN;
      znaky `+ # ! ?` na konci se ignorují.
- [ ] Poznámka pro službu s úlohami z Lichess: tam je první tah soupeřův; služba ho použije
      na FEN a sekvenci zkrátí.

### 1.9 Veřejné položky (SPEC 4.4, `packages/protocol/src/items.ts`)

- [ ] Odstraňovat `sources[].quote` (citace často obsahuje odpověď).
- [ ] `hints` zůstávají veřejné – zapsat výslovně (hra je smí ukázat i na telefonu).
- [ ] Z `HIDDEN['numeric-input']` odebrat `range`; `x-` podle 1.4.
- [ ] Testy (`displayItems.test.ts`, `session.test.ts`).

### 1.10 Verze 1.0

- [ ] Sady `"version": "1.0"`, `$schema` `https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-v1.0.json`.
- [ ] OQSEM (manifest), OQSEP (pokrok) a OQSEH (hlavička) také `1.0`; nadpisy a příklady
      ve všech čtyřech dokumentech, názvy schémat (`generate-schemas.ts`), README.
- [ ] Konstanta `OQSE_VERSION` a texty chyb.
- [ ] Markdown sady: frontmatter `oqse: "1.0"`, parser přijme i `"0.3"`.
- [ ] `@memizy/oqse` verze `1.0.0`; v `package.json` opravit `files` (`SPECIFICATION.md`
      neexistuje, specifikace `*.md` se do balíčku nedostanou).

### 1.11 Načítání starších verzí

- [ ] Sady 1.x: normálně; vyšší MAJOR: varování a „best effort“ (jako dnes).
- [ ] Sady 0.3: načíst s varováním a převést v paměti (`range` → `correctAnswer` +
      `tolerance`, verze `1.0`). Uložení zapíše 1.0.
- [ ] Sady 0.2 a starší: chyba `UNSUPPORTED_VERSION` s odkazem na převodní skript.
- [ ] Manifesty: struktura se nemění, host přijme `0.2` i `1.x` (hry z RC i studentské hry
      píšou `"version": "0.2"`). Nové hry a návod píšou `1.0`.
- [ ] Pokrok (OQSEP) `0.2` i `1.0` se načte stejně.

### 1.12 Opravy textu specifikace

- [ ] Kompletní příklad: `match-complex.connections` obsahuje `[1, 1], [2, 2]` → ID.
- [ ] Příklad `math-input`: `"$2*x + 2$"` v `alternativeAnswers` → bez `$`.
- [ ] Tabulka limitů: `prompts` / `matches` „must have equal length“ → `matches` mohou mít
      navíc rušivé možnosti.
- [ ] `HotspotObject`: výčet `type` doplnit o `mesh`.
- [ ] „Optimization for AI Generation“: příklad `options: ["A…"]` je zápis 0.2.
- [ ] Zbytky starých verzí: „OQSE v0.2 uses …“ (manifest), „standard for OQSE v0.3“ (UUID),
      „(in section 4)“ u `difficulty`, verze v příkladech manifestu (`minOqseVersion`).
- [ ] Škrtnout pravidlo „`ageMin == ageMax == 0` = neuvedeno“.
- [ ] Oddíl „Validation Rules for Choices“, `minCorrect` apod. zkontrolovat proti validátoru.
- [ ] README balíčku: odkaz na webový validátor (`memizy.github.io/oqse-specification`,
      staré repo), adresy schémat `@1`; webový validátor `packages/oqse/docs/index.html`.
- [ ] Odkaz na `github.com/memizy/set-test-suite`: aktualizovat sady na 1.0, nebo odkaz odebrat.

### 1.13 Vědomě beze změny (proč)

- `numeric-input.correctAnswer` povinné: hra po odpovědi ukazuje „správně bylo …“.
- `slider.step` povinné: výchozí 1 by bylo špatně u posuvníku 0–1.
- `lang` / `language`: přejmenování by se dotklo sad, Markdownu i platformy a nic nepřineslo.
- `bucket` 0–4 a `confidence` 1–4: dobře navržené, sedí na `AnswerRecord`.
- Všech 22 typů stabilních: tvary prošly kontrolou, odebrat typ později by bylo rozbíjející.

---

## 2. Převod sad

- [ ] Skript `scripts/migrate-oqse-1.0.ts` (z `migrate-oqse-0.3.ts`): vstup 0.2 i 0.3,
      výstup 1.0. Kroky: verze a `$schema`, z 0.2 vše jako dnes (ID možností),
      `range` → `correctAnswer = (min + max) / 2`, `tolerance = (max − min) / 2`,
      zahodit `trimWhitespace`.
- [ ] Skript **vypíše k ruční kontrole** (nic sám nemění): položky bez výslovného
      `ignoreDiacritics`, kde se přijímané odpovědi liší jen diakritikou (např. „byt“ a
      „být“) – nové výchozí chování je spojí.
- [ ] Sady v enginu: `apps/play/src/data/sets/*.oqse.json` (4) a `web-app-notes.oqse.md`,
      `packages/plugin-sdk/src/standalone/sampleSet.ts`, sady v testech všech balíčků a Play.
- [ ] Lab: prompt AI sad v `aiSets.ts` (verze, vzory bez `range` / `trimWhitespace`),
      `upgradeItem` převede i `range` z odpovědi chatu.
- [ ] Po převodu: `safeValidateOQSEFile` na všech sadách bez chyb.
- [ ] **Mimo engine** (24 souborů, dnes ještě 0.2 – rovnou na 1.0, každý repozitář na větvi):
      `../courses/course-mff-informatika/**`, `../courses/course-standalone-sets/**`,
      `../registries/open-library` (sady + odkazy v `official.json` / `community.json`).
      Doplnit `skills`, kde dávají smysl.

## 3. Protokol, SDK a hry kvůli OQSE 1.0

- [ ] `packages/protocol/src/items.ts`: body 1.4, 1.5 (pořadí timeline), 1.9.
- [ ] `packages/plugin-sdk/src/checkAnswer.ts`: porovnávání podle 1.1 (diakritika,
      `fill-in-blanks` / `diagram-label` s novými poli), bez `range` a `trimWhitespace`,
      timeline podle 1.5, `chess-puzzle` podle 1.8; testy.
- [ ] `ui.question` (`render/question.ts`): `numeric-input` a odkrytá odpověď bez `range`;
      projít, že nic dalšího nečte zrušená pole.
- [ ] Hry: Piráti (`pirates-of-memizy.html`, zobrazení `item.range`), Babiš, příklad
      v návodu, šablony Labu, `chaosPlayer.ts` – projít pole OQSE.
- [ ] Manifesty her a šablon: `"version": "1.0"` (dnes 5× `0.2`).
- [ ] SPEC 4.4 (seznam skrytých polí), 5.1 (`answer` → odkaz na formáty odpovědí),
      zmínky „OQSE 0.3“ → 1.0.

## 4. Průchod API host-sdk (z PLAN-RC4, krok 3)

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

## 5. E – test 3D se skutečným WebGL (z PLAN-RC4)

- [ ] Skript v repu (Playwright, Edge, SwiftShader): vykreslení, přepnutí 2D ↔ 3D, ztráta
      kontextu → 2D s hláškou, pomalá scéna → 2D jen jednou a po návratu hráče zůstane 3D,
      bez WebGL → 2D bez tlačítka 3D, výstřel ve 2D i 3D (Piráti).
- [ ] Spouštění popsat v `CLAUDE.md` (není součást `bun run test`, pokud je pomalý).

## 6. F – Návod pro AI (`docs/ai-plugin-guide.md`)

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

## 7. G – Dokumentace

- [ ] SPEC: stav „1.0“, changelog 1.0 (všechno od RC4 včetně kroku 1: `phaseSeq` a
      `actedAt` ve zprávách, pravidlo kompatibility mezi verzemi SDK), oddíl 10.
- [ ] `oqse.md` changelog „Version 1.0“, changelogy manifestu, pokroku a hlavičky.
- [ ] Changelog balíčků (`CHANGELOG.md` v každém balíčku zatím chybí – založit od 1.0.0).
- [ ] README balíčků: verze, adresy CDN `@1`, schémata.
- [ ] `CLAUDE.md` (engine): RC4 → 1.0, řádek o OQSE (verze, starší soubory), publikovaná
      verze (dnes `1.0.0-rc.3`), tabulka Layout (OQSE typy), odkaz na aktuální plán.
- [ ] `ARCHITEKTURA-A-PLAN.md` a `docs/presentation/` – zmínky o verzích a formátu.
- [ ] `PLAN-RC4.md` a tento plán odškrtat.

## 8. Vydání

- [ ] `bun run test`, `cd apps/play && bun run typecheck`, `bun run build:packages`,
      vygenerovaná schémata v commitu.
- [ ] Ruční test vlastníka na telefonech (iPhone: zoom, 3D; slabé zařízení).
- [ ] Verze **1.0.0** všech čtyř balíčků (`oqse`, `protocol`, `plugin-sdk`, `host-sdk`)
      a závislostí mezi nimi; publikace na npm v pořadí oqse → protocol → plugin-sdk →
      host-sdk; ověřit, že CDN `@1` vrací bundle SDK a schémata.
- [ ] Merge do `main` → nasazení Play (Workers); relay nasadit (`deploy.sh`), pokud se
      změnily jeho zprávy. Tag `v1.0.0`.
- [ ] Platforma: závislosti na 1.0.0, ukládání odpovědí podle formátů odpovědí.

## 9. Po workshopu (1.x, kontrakt nemění)

Odeslání akce na `pointerdown` (`data-act`), ochrana pozdních akcí i pro hry bez fází,
výjimka pro akce, které mají projít přes změnu fáze, pomocná funkce na kontrolu formátu
odpovědi, další jazyky textů SDK, klávesové zkratky v `ui.question`, výchozí `ui.local`,
zvuky, upozornění Labu na `render` bez `ui.html`; rezervované věci ze SPEC 10.

## Pořadí práce

1. OQSE 1.0 (oddíl 1) s testy → 2. převod sad v enginu → 3. protokol, SDK, hry →
4. host-sdk → 5. E → 6. F → 7. G → 8. vydání. Sady mimo engine (oddíl 2) kdykoli po
dokončení skriptu, nejpozději před vydáním (registr je načítá).
