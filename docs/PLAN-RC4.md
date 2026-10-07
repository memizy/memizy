# Plán RC4 a vylepšení SDK (do workshopu 22. 10. 2026)

Sepsáno 2026-10-07 po diskuzi o kontraktu, podvádění a druzích pluginů. Pořadí práce je na
konci. Hotové body se odškrtávají; rozhodnutí se zároveň přepisují do `packages/protocol/SPEC.md`
(oddíl „Decisions and planned extensions“) a do návodu pro AI.

## 1. Kontrakt RC4 (pak zmrazit)

### OQSE 0.3: ID možností a dovednosti

- [x] **ID možností.** Seznamy, na jejichž pořadí nebo výběru záleží, mají položky s `id`:
      možnosti mcq (`options: [{ id, text }]`), možnosti výběru v `fill-in-select`, `items` u
      `sort-items`, `prompts` / `matches` u `match-pairs`, strany `match-complex`, `labels` u
      `diagram-label`, kategorie u `categorize`, řádky a sloupce `matrix` (události `timeline` a
      položky `categorize` ID už mají). Odpovědi se odkazují na ID: `correctId`, `correctIds`,
      pořadí jako seznam ID, dvojice jako `{ promptId: matchId }` atd.
      Důvod: učitel sadu upravuje (přehodí nebo přidá možnost) a uložené odpovědi i statistiky
      musí zůstat správné; míchání pak nepotřebuje přemapování (`correctOrder` /
      `correctMatches` z RC3 odpadnou).
- [x] **Bez automatického převodu 0.2 → 0.3.** `loadOQSEFile` umí jen 0.3. Sady se převedou
      jednorázovým skriptem (viz „Sady mimo engine“). Starý soubor dostane jasnou chybu
      „sada je ve formátu 0.2“.
- [x] **`skills`** – volitelné pole položky: ID dovedností ze společného slovníku, hierarchická
      s tečkami (`chess.tactics.fork`, `math.fractions.addition`). Odděleně od `tags` (volné
      štítky na hledání). Dovednosti pocházejí z **obsahu** (sada, služba, generátor), nikdy je
      neurčuje plugin, takže se dají sledovat napříč pluginy.
- [x] Markdown formát sad (`.oqse.md`) – ID možností: automaticky podle pořadí (`a`, `b`, …)
      s možností je napsat ručně; `skills` jako řádek položky.
- [x] Převést sady **v enginu**: `apps/play/src/data/sets/*.oqse.json` a `web-app-notes.oqse.md`,
      sady v testech, ukázková sada SDK (`standalone/sampleSet.ts`), prompt pro AI sady v Labu
      (`apps/play/src/lib/aiSets.ts`) a JSON schema `oqse-v0.3.json`.
- [x] `checkAnswer`, `prepareDisplaySet`, `publicItem`, typy a validace na 0.3.

### Protokol

- [x] **`recordAnswer`**:
  - volitelná `answer` (odpověď hráče, v ID možností), aby Classroom ukázal např. „70 % třídy
    zvolilo Brno“;
  - otázky **mimo sadu** (vygenerované): hra přiloží položku (bez odpovědi stačí typ, otázka,
    `tags`, `skills`, `elo`…). Hostitel je uloží jako vygenerované – do statistik podle
    `skills`, ne do opakování. Dnes je hostitel odmítne („Unknown item“).
  - hostitel ukládá `skills` položky k záznamu a sčítá i rodičovské úrovně.
- [x] **Pauza učitelem**: nová zpráva hostitele (např. `paused(boolean)`, za feature).
      SDK zastaví časovače, `ctx.now` i `ui.timeLeft`; hra nemusí dělat nic. Tlačítko v Play.
- [x] **Oprávnění v manifestu** `permissions`: `network` (seznam adres), `camera`,
      `microphone`, `geolocation`, `serial`, `bluetooth`. Hostitel je vynutí (CSP v iframu
      pro síť – povolena jen deklarovaná místa a běžná CDN s knihovnami; atribut `allow`
      pro zařízení) a ukáže je („hra komunikuje s lichess.org“). Opravit návod, který tvrdí,
      že síť je zablokovaná (není).
- [x] **Služby Memizy**: obecná metoda `service(name, payload)` + pole `services` v
      manifestu; hostitel při handshake řekne, které služby nabízí. Kontrakt nezná žádnou
      konkrétní službu (AI, předčítání, žebříček, šachové úlohy… jsou v registru služeb).
- [x] **SPEC: oddíl „Rozhodnutí a plánované rozšíření“** se vším z oddílů 4 a 5 tohoto plánu.
- [x] Verze balíčků `1.0.0-rc.4`, changelog, AI guide.

## 2. SDK (přidává, nic nerozbíjí)

- [x] **Fáze hry** (volitelné): `phases: { name: { seconds, actions, onEnter, onTimeout } }`,
      `ctx.goto(name)`. SDK zahodí akce, které do fáze nepatří, drží odpočet (`ui.timeLeft()`
      bez parametru) a nahradí ruční `timerKey`. Modely jsou na jasný životní cyklus zvyklé.
- [x] **`ui.html`** – šablona, která sama escapuje (výstup `ui.text` / `ui.question` se
      neescapuje). Návod i příklad celé přepsat na ni (dva způsoby vedle sebe by AI mátly).
- [x] **`ui.question(item, { action, … })`** – nabídka, ne povinnost: hotové ovládání všech
      běžných typů (mcq, multi, pravda/nepravda, krátká odpověď, číslo, řazení, dvojice,
      doplňování, kartička se sebehodnocením). Řazení a dvojice klepáním (mobil), vzhled přes
      CSS proměnné, správný formát odpovědi vždy.
- [x] **`ui.setLocal`** – místní stav zařízení, jehož změna překreslí obrazovku (odpadne
      globální `G` v Pirátech).
- [x] **`playerView(state, playerId)`** – **volitelné**. Autorita posílá každému hráči jen jeho
      výřez stavu (tabuli `playerId = null`). Návod: „když stav obsahuje něco, co ostatní nemají
      vidět, použij playerView“; příklad (kvíz) ho použije.
- [x] **`ctx.hide(itemIds)`** – vrátí odkrytí (otázka, která se ve hře zopakuje).
- [x] **3D doplněk** `@memizy/plugin-sdk/three` (samostatný, Three.js mu hra předá:
      `createScene3d(THREE, root, …)`): kontrola WebGL, ztráta kontextu a černá obrazovka,
      FPS a přepnutí na 2D, velikost plátna na iOS, kvalita na mobilech, klepání podle
      nejbližšího popisku. Jako poslední – kdyby nestačil čas, může až po workshopu.

## 3. Lab, hry, návod

- [x] Lab test **„zlobivý hráč“**: skrytý hráč posílá odpovědi dvakrát, pozdě, s nesmyslnými
      daty a v jiném kole; test ohlásí změnu stavu nebo pád (a jde zkopírovat pro AI).
- [x] Lab ukáže **oprávnění a služby** hry.
- [x] Převést **Piráty** (ID možností, `ui.question`, `ui.setLocal`, 3D doplněk, `ctx.hide`,
      omezení času klepnutí při míření na rozumný rozsah), **Babiše** (ID možností, fáze,
      `ui.html`, `ui.question`, `playerView` – odpovědi spolužáků skryté) a **příklad v návodu**.
- [x] Nový návod pro AI podle RC4; doplnit `CLAUDE.md`.

### Poznámky k provedení (2026-10-07)

- 3D doplněk je funkce `createScene3d` přímo v SDK (Three.js předává hra), ne samostatný balíček –
  jeden import pro studenty, jádro na Three.js nezávisí.
- Piráti: `ui.question`, `ctx.hide`, omezení času klepnutí – hotovo. Jejich vlastní 3D scéna zůstala
  (už má stejné kontroly jako `createScene3d`); převod na pomocníka a na `ui.setLocal` místo
  globálního `G` je možný úklid na později.
- Babiš: fáze a `playerView` – hotovo. Vlastní dlaždice odpovědí (barvy po možnostech) a šablony
  zůstaly; `ui.question` by mu vzal vzhled. Jména escapuje `ui.escape`.
- Zlobivý hráč je v `apps/play/src/lib/chaosPlayer.ts` (testuje SDK hry; akce hledá v HTML).

## 4. Podvádění – stav po RC4

| Díra | Řešení |
| :--- | :--- |
| Vydávání se za hostitele, falešný odesílatel, falešný stav | hotovo (host token, server razítkuje odesílatele, stav jen od autority) |
| Odpovědi na telefonech a v balíčku na serveru | hotovo v RC3 (veřejná sada, `ctx.reveal`) |
| Opisování odpovědí spolužáků ze stavu | `playerView` |
| Odkrytá otázka se zopakuje | `ctx.hide` |
| Chybějící kontroly v akcích studentských her | fáze + Lab „zlobivý hráč“ |
| Hodnoty od telefonu (čas klepnutí) | autorita je omezí (Piráti) |
| Boti s PINem | zamčení místnosti a vyhazování; limit připojení z IP je nápad na později |

## 5. Rozhodnutí

**Zarezervovat ve SPEC** (název a záměr, bez implementace):
- `generated` u položky (odkud vygenerovaná úloha je, `{ by, seed }`);
- autorita `server` (oficiální hry, známkované úkoly);
- `uploadAsset` (obrázky od žáků) a `edit-set` (nástroje, které upravují sadu);
- pole hráče `active` (aplikace na pozadí – pro testy v platformě);
- shrnutí pokroku od hry pro učitele (např. „Elo 1450“);
- jedno zařízení pro více hráčů.

**Vědomě neděláme:**
- rozsah dat `class` – společná data třídy jsou **služba Classroomu** (zápis ověřuje server);
- známkované testy a úkoly v pluginech – jsou **v platformě**, vyhodnocuje server (kdo má
  pravidla u sebe, může podvádět). Pluginy jsou na učení hrou a procvičování;
- povinný `playerView` (zbytečná práce a chyby u her bez tajností).

**Zásady:**
- Obsah jsou **sady**; výpočty a data na serveru jsou **služby** (Memizy přes `service()`,
  třetí strany přes oprávnění `network`).
- **Generátory** (v pluginu přes `ctx.random()`, nebo služba – např. šachové úlohy z Lichess
  v D1) vracejí obyčejné položky OQSE; vše ostatní (zobrazení, `checkAnswer`, pokrok) funguje
  stejně.
- Pokrok pro učitele = `recordAnswer` + `skills` z obsahu; vlastní model hry (Elo, úroveň,
  odemčené kapitoly) = `ui.save`.
- Do kontraktu přidávat hned jen to, co má skutečného uživatele; ostatní zarezervovat.

## 6. Mimo engine (až přijde řada)

- **Sady mimo engine na OQSE 0.3** (24 souborů): `../courses/course-mff-informatika/**`,
  `../courses/course-standalone-sets/**` a sady v `../registries/open-library` (odkazy v
  `official.json` / `community.json`). Postup: spustit převodní skript z enginu (vznikne
  s bodem 1), zkontrolovat `safeValidateOQSEFile`, doplnit `skills` tam, kde dávají smysl,
  aktualizovat registry. Do té doby je engine RC4 nenačte.
- **Registr služeb** (nové repo vedle `plugin-registry`): název, verze, schéma vstupu a výstupu,
  popis; generuje se z něj část návodu pro AI.
- **Slovník dovedností** (registr): hierarchická ID, později napojení na RVP.
- **Služby v platformě** (Workers + D1): AI, šachové úlohy z Lichess (položky `chess-puzzle`
  s `tags` / `skills` podle témat a `elo`), žebříčky, služba Classroomu.
- **Classroom**: třídy, zadání (živá hodina, procvičování jako solo plugin, test), přehledy
  podle `skills` a odpovědí, testy hodnocené na serveru.

## Pořadí

1. Kontrakt RC4 včetně OQSE 0.3 a převodu sad v enginu → zmrazit
2. SDK: fáze, `ui.html`, `ui.question`, `ui.setLocal`, `playerView`, `ctx.hide`
3. Lab: „zlobivý hráč“, oprávnění a služby
4. Převod her a nový návod pro AI
5. 3D doplněk

---

# Cesta k 1.0 (na workshop 22. 10. 2026)

Sepsáno 2026-10-07. **Rozhodnutí:** na workshop vydáme **1.0.0 bez RC** (OQSE, protokol,
plugin-sdk, host-sdk). Pluginy importují `@memizy/plugin-sdk@1` a rozsah `@1` RC verze
nebere; hry studentů pak musí fungovat dál. Po 1.0 v rámci 1.x jen přidávat (1.1…),
rozbíjející změna = 2.0. Opravy chyb, CSS, zoom na iPhonu nebo pravidla 3D kontrakt
nemění (1.0.x). Vydat až po ručním testu na telefonech, pár dní před workshopem.

Kontrakt má tři vrstvy, všechny po 1.0 zpětně kompatibilní: **protokol** (host ↔ hra,
SPEC), **API SDK** (`defineGame`, `ctx`, `ui`, `ui.question` včetně stabilních tříd pro
styl) a **zprávy mezi instancemi SDK** (tabule a telefony můžou mít různé 1.x).

## Hotovo na větvi `sdk-polish`

- [x] **A. SDK:** `ui.question({ counts })`, fáze se překreslují samy (bez `tickMs`),
      `data-local` + `local: {}`, pravidla 3D (černá / pomalá scéna → 2D jen jednou za
      stránku, návrat hráče do 3D se respektuje, bez `onFallback` zůstane 3D),
      žádný zoom na telefonu (viewport, gesta, políčka ≥ 16 px), `ui.escape` odebráno.
- [x] **B. Play:** viewport, blokování gest, iframe bez zoomu, políčka ≥ 16 px.
- [x] **C. Babiš:** `ui.html`, `ui.question` s počty, `ctx.reveal` / `ctx.hide`, bez `tickMs`.
- [x] **D. Piráti:** `createScene3d`, bez globálního `G` (`ui.local`, most `view`, `seen`),
      `data-local` přes SDK, výstřel na `pointerdown` (`data-fire`), `ui.html`, kvíz 16 px.

## 1. SDK – poslední změny API před 1.0

- [x] **Pozdní akce:** každá akce nese číslo fáze (`phaseSeq`), kterou hráč viděl. Ve hrách
      s fázemi autorita zahodí **každou** akci z obrazovky jiné fáze (i dvojklik učitele na
      „Přeskočit“); akce z časovačů a háčků ne. Zahozená akce se potvrdí (`ui.pending` se
      vyčistí). Hry pak nepotřebují ruční `round` / `seq`.
- [x] **`ctx.actedAt`:** čas klepnutí (společné hodiny), SDK ho omezí na nejvýš 400 ms před
      příchodem a ne do budoucnosti. Body za rychlost bez znevýhodnění pomalé sítě.
- [x] **`ui.question` – odeslaná odpověď:** dokud čeká její akce, ukáže ji jako zvolenou a
      zamkne ovládání (dvojí odeslání nejde). `chosen` zůstává pro potvrzené odpovědi.
- [x] **`ui.question` – `itemId`** v payloadu akce (ne v uložené odpovědi `recordAnswer.answer`).
- [x] **`ui.question` – stabilní háčky pro styl:** `data-option="<id>"` a `--mz-q-index` na
      možnostech, `data-type` na kořeni; seznam stabilních tříd a proměnných v návodu,
      ostatní jsou vnitřní.
- [x] **Varování:** `ui.question({ reveal: true })` u otázky bez odpovědi → „zavolej ctx.reveal“
      (konzole, tedy i Lab).
- [x] **`ctx.hide`** u neodhalené otázky nic neposílá (hra ho může volat na začátku každé otázky).
- [x] **`localActions`** místo `local: {}` (paralela k `actions`, nesplete se s `ui.local`);
      signatura `(local, payload, ui)`.
- [x] **`createScene3d`:** volby `near` / `far` kamery.
- [x] **`ui.now` jako vlastnost** (getter, vždy aktuální čas i mimo render) jako `ctx.now`;
      všude (hra, nastavení, solo).
- [x] **`ctx.goto` platí hned:** `state.phase`, `phaseSeq`, `phaseEndsAt` se nastaví v tu chvíli
      a `onEnter` proběhne na místě (jako systém, ne jako hráč).
- [x] **`ui.html` a objekty:** objekt v atributu (`data-payload=${{ item: s.id }}`) se převede
      na bezpečný JSON v uvozovkách (dnes `[object Object]`); starý zápis funguje dál.
- [x] **Kompatibilita mezi verzemi SDK:** nové části zpráv jen jako volitelná pole (starší
      autorita je ignoruje, novější bez nich použije dnešní chování); zapsat jako pravidlo.
- [x] **Rezervovaná pole stavu** `phase`, `phaseSeq`, `phaseEndsAt` zapsat do návodu.

Vědomě **ne**: `game.state` / `game.ui` na objektu z `defineGame` (AI by měnila stav mimo
akce); `onTimeout(state, payload, ctx)` (platí pravidlo „ctx poslední“); `recordAnswer`
s automatickým vyhodnocením (nejednoznačné u pravda/nepravda, hra správnost potřebuje sama).
Až v 1.x (kontrakt nemění): další jazyky textů SDK, klávesové zkratky v `ui.question`,
výchozí `ui.local`, zvuky, upozornění Labu na `render` bez `ui.html`.

## 2. Hry na finální API (hned po kroku 1, jinak padají)

- [x] **Babiš:** bez `round` (pozdní akce řeší SDK), `ctx.actedAt` pro rychlost, `ctx.hide` bez
      vlastní evidence, barvy přes `data-option` / `--mz-q-index` místo `:nth-child`,
      `ui.now`. Hlášky upravuje vlastník – před úpravou je commitnout zvlášť.
- [x] **Piráti:** `localActions`, `ui.now`, `near` / `far` místo výměny kamery, `ctx.actedAt`
      místo vlastního času klepnutí (pokud sedí na míření), bez vlastního `seq`.
- [x] Příklad v návodu a jeho test (`guideExample`).
- Odchylky: Babiš barví dlaždice dál přes `:nth-child` (paletu podle `--mz-q-index` CSS
  neumí vybrat; pořadí možností v `.mz-q-options` je proto součást kontraktu). Piráti si
  nechali vlastní `seq` otázky (stejná otázka se hráči může opakovat a hry bez fází
  pozdní akce SDK nehlídá).

## 3. OQSE 1.0 a host-sdk

- [ ] **Průchod formátu OQSE** před zmrazením: typy otázek, výchozí hodnoty (např.
      `ignoreDiacritics` – „Plzen“ vs. „Plzeň“ u dětí na telefonu), verze manifestu (dnes 0.2
      vs. sady 0.3). Sporné věci rozhodne vlastník.
- [ ] Formát sad i manifestu `"version": "1.0"`, převod sad v enginu, jasná chyba pro starší
      verze; balíček `@memizy/oqse` 1.0.
- [ ] **Průchod API host-sdk** (`LocalSession`, `mountPlugin`, `RelayHost`, `RelayPlayer`,
      `HostStorage`) – používá ho Play a platforma, i tam 1.0 slibuje stabilitu.

## 4. E–G

- [ ] **E. Test 3D se skutečným WebGL** jako skript v repu (Playwright, Edge, SwiftShader):
      vykreslení, 2D ↔ 3D, ztráta kontextu → 2D s hláškou, pomalost → 2D jen jednou a po
      návratu zůstane 3D, bez WebGL 2D bez tlačítka 3D, výstřel ve 2D i 3D.
- [ ] **F. Návod pro AI** podle finálního API: jedna cesta pro každou věc (`ui.html`,
      `localActions`, fáze bez `tickMs`, `ui.question` s `counts`), pravidla 3D a toast
      v `onFallback`, „políčka nezmenšuj pod 16 px“, rezervovaná pole, stabilní třídy.
- [ ] **G. Dokumentace:** changelog SDK, SPEC (pokud se dotkne), `CLAUDE.md`, tento plán.

## 5. Vydání

- [ ] Ruční test vlastníka na telefonech (iPhone: zoom, 3D; slabé zařízení).
- [ ] Verze **1.0.0** všech balíčků, publikace na npm (CDN `@1`), nasazení Play.
