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

- [ ] **Fáze hry** (volitelné): `phases: { name: { seconds, actions, onEnter, onTimeout } }`,
      `ctx.goto(name)`. SDK zahodí akce, které do fáze nepatří, drží odpočet (`ui.timeLeft()`
      bez parametru) a nahradí ruční `timerKey`. Modely jsou na jasný životní cyklus zvyklé.
- [ ] **`ui.html`** – šablona, která sama escapuje (výstup `ui.text` / `ui.question` se
      neescapuje). Návod i příklad celé přepsat na ni (dva způsoby vedle sebe by AI mátly).
- [ ] **`ui.question(item, { action, … })`** – nabídka, ne povinnost: hotové ovládání všech
      běžných typů (mcq, multi, pravda/nepravda, krátká odpověď, číslo, řazení, dvojice,
      doplňování, kartička se sebehodnocením). Řazení a dvojice klepáním (mobil), vzhled přes
      CSS proměnné, správný formát odpovědi vždy.
- [ ] **`ui.setLocal`** – místní stav zařízení, jehož změna překreslí obrazovku (odpadne
      globální `G` v Pirátech).
- [ ] **`playerView(state, playerId)`** – **volitelné**. Autorita posílá každému hráči jen jeho
      výřez stavu (tabuli `playerId = null`). Návod: „když stav obsahuje něco, co ostatní nemají
      vidět, použij playerView“; příklad (kvíz) ho použije.
- [ ] **`ctx.hide(itemIds)`** – vrátí odkrytí (otázka, která se ve hře zopakuje).
- [ ] **3D doplněk** `@memizy/plugin-sdk/three` (samostatný, Three.js mu hra předá:
      `createScene3d(THREE, root, …)`): kontrola WebGL, ztráta kontextu a černá obrazovka,
      FPS a přepnutí na 2D, velikost plátna na iOS, kvalita na mobilech, klepání podle
      nejbližšího popisku. Jako poslední – kdyby nestačil čas, může až po workshopu.

## 3. Lab, hry, návod

- [ ] Lab test **„zlobivý hráč“**: skrytý hráč posílá odpovědi dvakrát, pozdě, s nesmyslnými
      daty a v jiném kole; test ohlásí změnu stavu nebo pád (a jde zkopírovat pro AI).
- [ ] Lab ukáže **oprávnění a služby** hry.
- [ ] Převést **Piráty** (ID možností, `ui.question`, `ui.setLocal`, 3D doplněk, `ctx.hide`,
      omezení času klepnutí při míření na rozumný rozsah), **Babiše** (ID možností, fáze,
      `ui.html`, `ui.question`, `playerView` – odpovědi spolužáků skryté) a **příklad v návodu**.
- [ ] Nový návod pro AI podle RC4; doplnit `CLAUDE.md`.

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
