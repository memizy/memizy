# Memizy Engine – architektura a plán (v1)

> Stav: návrh k revizi · Sepsáno: 2026-10-04 · Cíl: prezentace pro středoškoláky (~2026-10-22)

Tento dokument shrnuje rozhodnutí o nové architektuře pluginů, multiplayeru a OQSE. Je to podklad pro implementaci. Detailní specifikace (protokol, manifest, OQSE 0.2) budou mít vlastní dokumenty v příslušných balíčcích.

---

## 0. Cíl a priority

Na prezentaci budou studenti s pomocí AI tvořit pluginy a společně je hrát. Do té doby musí platit:

1. **Kontrakt aplikace ↔ plugin (v1) je zmražený.** Další změny budou jen zpětně kompatibilní. Pluginy vytvořené studenty musí fungovat i v budoucích verzích.
2. **Laboratoř (Plugin Lab) funguje spolehlivě.** Nahrání HTML pluginu, singleplayer i multiplayer, obrazovky všech hráčů vedle sebe, automatické testy.
3. **Relay multiplayer server běží na Netcupu.** Pluginy se dají reálně hrát na více zařízeních (telefony studentů).

Mimo rozsah prezentace (ale s architekturou se pro ně počítá): standalone hry, authoritative režim, P2P, API klíče, kurzy v OQSE, Obsidian plugin.

---

## 1. Přehled rozhodnutí

| # | Rozhodnutí |
|---|---|
| D1 | **Jedno `@memizy/plugin-sdk`** pro singleplayer i multiplayer. Staré `multiplayer-sdk` se ruší. |
| D2 | **Plugin nikdy nekomunikuje se serverem.** Veškerá komunikace jde přes `postMessage` (Penpal) do hostitelské aplikace. Hra, které nestačí JSON přes hostitele, musí být **standalone**. |
| D3 | **Schopnosti pluginu se deklarují staticky v manifestu.** Lobby a registry je potřebují znát ještě před načtením iframu. SDK je za běhu jen čte. |
| D4 | **Pohled (view) a autorita jsou oddělené pojmy.** Plugin nepíše síťovou logiku: definuje `initialState`, `actions` a `render`. Kde akce běží, rozhoduje SDK a platforma. |
| D5 | **Transport volí platforma, ne plugin:** relay (výchozí), P2P (později), authoritative (jen whitelist). |
| D6 | **Authoritative režim je pouze pro oficiální pluginy a hry** (whitelist zakompilovaný v serveru, žádné dynamické načítání kódu). |
| D7 | **Host jako hráč (`hostAs: player`) nemá tabuli.** Host má stejnou obrazovku jako ostatní hráči (plus práva v lobby). |
| D8 | **Kontrakt nese verze** (protokol, SDK, host, plugin, data). Vyjednávají se v handshaku. |
| D9 | **Iframe sandbox bez `allow-same-origin`** (opaque origin), stejně jako v současném `multiplayer/`. `allowedOrigins: ['*']` je v tomto případě nutné a v pořádku, protože Penpal ověřuje `remoteWindow`. |
| D10 | **Server zatím jako jeden Bun proces.** Formát PINu/roomId si nechává místo pro identifikátor shardu. |
| D11 | **Server bez API klíčů.** Ochranu zajišťuje allowlist `Origin` (aplikace a lab) a limity. Klíče přijdou se standalone hrami. |
| D12 | **Markdown je bezztrátová serializace celé sady poznámek** (jeden soubor = jedna sada, nadpisy = poznámky), ne náhrada JSONu. |
| D13 | **OQSE: `math` → `latex`** bez aliasu; vlastní sady převede skript, data v aplikaci migrace v aplikaci. |
| D14 | **Kurzy nejsou součást jádra OQSE**, ale sesterská specifikace (později). |
| D15 | **Open-source monorepo `engine`.** Registry a komunitní pluginy jsou v samostatných repech. Nasazení a secrets patří do closed `platform`. |
| D16 | **Licence: MIT** pro všechno open-source včetně serveru (viz kap. 11). |
| D17 | **Lab se vyvíjí v `engine/apps/plugin-lab`** nad open-source balíčky (`host-sdk`, `plugin-testkit`). Po integraci do hlavní aplikace se rozhodne, zda zůstane (veřejný nástroj pro autory pluginů), zredukuje se na minimální dev harness pro vývoj SDK, nebo se odstraní běžným commitem (bez přepisování historie). Viz kap. 9.1. |
| D18 | **Lobby UX (PIN, QR, kopírování odkazu, generované jméno s možností přegenerovat) se přebírá ze současného `multiplayer/`.** Datová vrstva (Supabase, stores aplikace) se nahradí relay transportem z `host-sdk`. |
| D19 | **Kontrakt plugin ↔ host je Memizy Plugin Protocol v1** (`packages/protocol/SPEC.md`); rozhodnutí a důvody v kap. 3. |

---

## 2. Vrstvy

```
┌───────────────────────────────────────────────┐
│  Hostitelská aplikace (memizy-app / Lab)      │
│  ├─ host-sdk  (iframe lifecycle, Penpal,      │
│  │             transport: local | relay | p2p)│
│  │                                            │
│  │   postMessage (Penpal, JSON-like objekty)  │
│  │        ▲                                   │
│  ┌────────┴────────────────────────────────┐  │
│  │ iframe sandbox="allow-scripts …"        │  │
│  │  plugin (1 HTML soubor)                 │  │
│  │   └─ plugin-sdk (zabudované v pluginu)  │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────┬────────────────────────┘
                       │ WebSocket ?encoding=json
                       ▼
┌───────────────────────────────────────────────┐
│ multiplayer-server (Bun)                      │
│  relay · authoritative (whitelist) · P2P sig. │
│  ring buffer, reconnect, limity, Origin check │
└──────────────────────▲────────────────────────┘
                       │ WebSocket ?encoding=msgpack
┌──────────────────────┴────────────────────────┐
│ Standalone hra (oficiální) + game-client      │  (později)
└───────────────────────────────────────────────┘
```

Sdílený balíček **`@memizy/protocol`** (typy + Zod schémata) obsahuje manifest, RPC kontrakt plugin↔host a wire protokol gateway. Používají ho všechny ostatní balíčky, takže se nemohou rozjet.

---

## 3. Kontrakt plugin ↔ host: rozhodnutí a důvody

Normativní popis je v **`packages/protocol/SPEC.md`** (pojmy, manifest, průběh hry, metody, routování, limity, odložené věci) a API pro autory pluginů v **`docs/ai-plugin-guide.md`**. Obojí je anglicky a pojmy jsou definované jen tam (SPEC kap. 3). Tady je jen proč jsme se tak rozhodli.

| Rozhodnutí | Proč |
|---|---|
| **Dvě zmražené vrstvy:** protokol (host musí navždy umět pluginy 1.x) a veřejné API `@memizy/plugin-sdk@1` (pluginy ho načítají z CDN jako `@1`, takže opravy v 1.x dostanou automaticky). | Studentské pluginy z prezentace musí fungovat i v budoucích verzích. |
| **Protokol je malý a obecný** (zprávy, snapshot, pokrok, assety, lifecycle); `defineGame` je jen v SDK nad ním. | Čím menší zmražený povrch, tím menší riziko, že ho budeme muset rozbít. |
| **AI guide popisuje jen SDK API**, protokol AI nevidí. | Méně věcí k pochopení = méně chyb slabších modelů. |
| **Režimy `solo` / `multiplayer`**, název `solo` (stejně jako pohled `solo`). | Krátké, jednoznačné, v kódu jeden název pro jednu věc. V UI může být „Hrát sám“. |
| **`hostAs: presenter` / `player`**, plugin může podporovat obojí. | Učitel u projektoru vs. kamarádi, kde host hraje s nimi. |
| **Pohledy se odvozují z manifestu**, nedeklarují se (SPEC 3.2). | Deklarace by si mohla odporovat s režimy. |
| **`controller` = obrazovka jednoho hráče** na libovolném zařízení (telefon, tablet, PC). | Host jako hráč často sedí u PC. |
| **Adresa `"server"` je rezervovaná**, akce musí být deterministické (`ctx.random`, `ctx.now`). | Později může authority běžet na serveru (authoritative režim) bez změny pluginů. |
| **Lobby zůstává jako dřív:** host mění plugin a sadu, hráči se připojují a mění jména; plugin se hráčům stáhne až po Startu. Volitelně vlastní obrazovka nastavení (`settingsScreen: { size: compact \| large }`). | Osvědčilo se to; compact = panel v lobby, large = modál přes celou obrazovku. Schéma `settings` zůstává povinné, aby host mohl hodnoty validovat. |
| **Načítání + odpočet + `start()`**: authority začne hru, až se plugin načte všem (nebo vyprší limit). | Časované hry by jinak začaly dřív, než se načtou pomalejší telefony. |
| **`initialState` místo `setup`.** | „Setup“ sváděl k představě čekací fáze; je to jen funkce, která na startu vyrobí počáteční stav. |
| **Výběry hráčů před hrou (tým, postava) = první fáze hry** v `defineGame`. | Hráči v lobby plugin ještě nemají; uvnitř hry to nepotřebuje nic v protokolu. Formální týmy v lobby = pozdější feature. |
| **Pokrok i v multiplayeru:** `recordAnswer` (plugin nahlásí výsledek, bucket spočítá aplikace svým algoritmem a uloží do pokroku daného hráče na jeho zařízení) a `saveProgress` / v SDK `ui.setProgress` (přímý zápis bucketu pro vlastní pokrok, např. sebehodnocení). | Učení ve třídě je stejně cenné jako doma; algoritmus (Leitner/FSRS) patří aplikaci, ne pluginu. |
| **Snapshot jen pro obnovu authority**; late join a reconnect hráčů jdou synchronizací s běžící authority. | Po F5 učitele by jinak zmizela celá hra; hráči stav dostanou od authority. |
| **Assety předává host jako `Blob` přes `getAsset`**, nikdy jako `blob:` URL. | Iframe bez `allow-same-origin` nemůže načíst `blob:` URL hostitele. |
| **Manifest = OQSEM (obsah) + `appSpecific.memizy` (runtime).** | Jeden data island; OQSE zůstává obecné, herní režimy jsou věc Memizy. |
| **Solo bez obrazovky nastavení a bez odpočtu:** jedna instance, host předá hodnoty nastavení (výchozí nebo předvolené) a hned zavolá `start()`. Volby hráče (obtížnost, level) si hra řeší sama jako první fázi. Schéma `settings` platí v obou režimech, `settingsScreen` jen v lobby multiplayeru. | Solo hry mívají vlastní úvodní menu; formulář hostitele by byl dvojí. Schéma umožní předvolby z aplikace/kurzu („10 otázek, těžká“) a testy různých nastavení v Labu. |
| **Data pluginu** (`saveData`, v SDK `ui.saved` / `ui.save`): JSON dokument na uživatele a plugin ve dvou rozsazích – `plugin` (napříč sadami) a `set` (pro tuto sadu); 256 KB na rozsah; jen vlastní hráč, tabule nemá. | Hry potřebují ukládat levely, mince, nejlepší skóre. `localStorage` v sandboxu nefunguje a ukládat to do sady by byl hack (sada je sdílený obsah). Pokrok učení (OQSEP) zůstává oddělený. |
| **Limity jako minimální záruka** (host smí povolit víc, mohou jen růst): zpráva 64 KB, 30 zpráv/s, snapshot 1 MB, data 256 KB; SDK slučuje změny stavu do dávek (≤ ~20/s). Uvedené i v AI guidu. | Ochrana sítě ve třídě a serveru; dávkování zvládne i 40 hráčů odpovídajících ve stejné vteřině. |
| **Výpadek authority:** host ostatním ukáže „Čekáme na hostitele…“ (`authorityChanged`), akce mezitím odmítne (`AUTHORITY_UNAVAILABLE`), po návratu authority (ze snapshotu) se všichni znovu synchronizují; když se nevrátí, host session ukončí. | Host, který hraje s ostatními, může ztratit Wi-Fi; hra se nesmí rozbít ani tiše ztrácet akce. |
| **Úplný seznam chybových kódů** (`ProtocolError`), neznámé kódy = `INTERNAL_ERROR`. | Plugin, SDK i Lab potřebují poznat, co se stalo; nové kódy lze přidávat. |
| **Zmrazení ve dvou krocích:** teď Release Candidate 1, finální 1.0 po akceptačním testu s AI (dny 15–16). | Některé mezery odhalí až implementace; studenti tvoří pluginy až na prezentaci. |

**Převod starého manifestu** (`appSpecific.memizy.multiplayerSdk`):

| Starý klíč | Nový |
|---|---|
| `apiVersion`, `minimumHostApiVersion` | `protocol` |
| `players.min/max/recommended` | `modes.multiplayer.players` |
| `supportsLateJoin` | `lateJoin` |
| `supportsReconnect` | odpadá – funguje vždy (SDK) |
| `supportsTeams` | později (feature `teams`) |
| `requiresHostScreen: true` | `hostAs: ["presenter"]` |
| `clientOrientation` | `display.orientation` |
| `customSyncScreen` | odpadá – synchronizace je v SDK; vlastní čekací obrazovka `renderWaiting` |
| `hasSettingsScreen` | `settingsScreen: { size }` |
| `registry.isStandaloneFile` | věc záznamu v registry, ne protokolu |

**Odložené věci a nápady** jsou v SPEC kap. 10 (týmy, skrývání odpovědí, předání hry jinému hráči, editace sady, hot-seat, authority na serveru).

---

## 4. Co zbývá udělat (kontrakt v1)

*(Kapitoly 5 a 6 byly sloučeny do kap. 3 a 4; číslování dalších kapitol zůstává kvůli odkazům.)*

1. ~~**Revize** `SPEC.md` + AI guide~~ → **Release Candidate 1** (2026-10-04). Finální 1.0 po akceptačním testu (bod 6); změny do té doby jen když implementace ukáže problém, zapisují se do changelogu ve `SPEC.md`.
2. **`@memizy/protocol`:** TypeScript typy a Zod schémata pro manifest, handshake, `InitPayload`, zprávy, `ProtocolError` a limity; validace manifestu z HTML data islandu (bez spuštění pluginu).
3. **`@memizy/plugin-sdk` 1.0** (přepis):
   - `defineGame`: `initialState`, `actions` s mutací draftu (mutative → patche), `playerJoined/Left`, časovače `ctx.after/cancel` uložené ve stavu, `ctx.recordAnswer`, `ctx.end`, deterministické `ctx.random/shuffle/now`;
   - vykreslování: `render` vrací HTML, SDK ho morfuje do DOM (zachová focus a text v inputech), `data-act`, `data-payload`, formuláře, `data-setting`, `ui.local`, `ui.timeLeft` se synchronizovaným časem, `tickMs`;
   - `renderWaiting`, `renderSettings`, `validateSettings`;
   - text: `ui.text`, `ui.renderNote` (relativní nadpisy, `titleLevel`), `ui.escape`; **oprava chyby** v současném `TextManager.parseTokens` (klíč `"map "` s mezerou) – použít `OQSE_TAG_PATTERN` / `findAssetKeys` z `@memizy/oqse`;
   - `checkAnswer` pro typy z guidu (kap. 7), `ui.progress`, `ui.setProgress`, `ui.saved` / `ui.save` (sloučení zápisů);
   - dávkování změn stavu (≤ ~20/s), resync po `authorityChanged`;
   - assety: `getAsset` → `Blob` → vlastní object URL;
   - standalone režim (bez hostitele): solo s ukázkovými daty.
4. **`@memizy/host-sdk`:** Penpal most, handshake a vyjednání verzí, validace všech volání a limity, chybové kódy, lokální transport (solo, lab), relay transport, úložiště snapshotu a dat pluginu, lobby + bariéra načtení + odpočet (solo bez nich), overlay „Čekáme na hostitele…“ při výpadku authority, načítání sady přes `loadOQSEFile` a filtrování typů přes `checkCompatibility`.
5. **Referenční pluginy:** quiz-conquest (solo + oba `hostAs`) a jeden solo plugin.
6. **Akceptační test:** pluginy vygenerované 3–5 AI modely jen podle guidu.

---

## 7. host-sdk

- Lifecycle iframu, Penpal most, handshake a vyjednání verzí.
- Transporty za jedním rozhraním: `local` (in-memory, pro lab a solo), `relay` (WebSocket na server), později `p2p`.
- **Throttling odchozích zpráv**, aby plugin, který posílá stav v každém snímku, nezahltil server.
- Validace zpráv přes schémata z `@memizy/protocol`.
- Stejné `host-sdk` používá lab i hlavní aplikace, takže se lab a produkce nemohou rozejít.

---

## 8. Multiplayer server

- **Relay je výchozí a pro prezentaci jediný potřebný režim.** Server nepočítá herní logiku, přeposílá zprávy, drží poslední stav pro late join a ring buffer pro reconnect.
- **Authoritative:** whitelist oficiálních her, reducery zakompilované v serveru, 60 Hz tick (později).
- **P2P:** existující implementace s TURN fallbackem zůstává. Relay má ale oproti TURN výhodu, že rozumí místnosti (late join, reconnect se stavem), proto je výchozí.
- **Content negotiation:** `?encoding=json` (pluginy přes hostitele) / `msgpack` (standalone).
- **Ochrana (bez API klíčů):**
  - allowlist `Origin` (aplikace, lab),
  - limit velikosti zprávy,
  - rate limit na spojení (token bucket),
  - max. spojení a místností na IP,
  - TTL místnosti a heartbeat.
- **Provoz:** jeden Bun proces na Netcupu, Caddy (TLS) jako reverse proxy, systemd, logy. Nasazovací konfigurace a secrets jsou v closed `platform`.

---

## 9. Plugin Lab a automatické testy

Samostatná aplikace `engine/apps/plugin-lab` postavená na `host-sdk`. Později modul hlavní aplikace.

**Funkce:**
- Nahrání pluginu (jeden HTML soubor), URL nebo vložení kódu.
- **Singleplayer** i **multiplayer**: tabule + N ovladačů vedle sebe, všechny ovladatelné.
- Přepínač transportu: lokální (in-memory) / živý server.
- Připojení reálných zařízení přes PIN/QR, aby se dalo hrát na telefonech.
- Inspektor zpráv, simulace latence a výpadku („odpojit / reconnect“).

**Automatické testy** (balíček `@memizy/plugin-testkit`, běží v prohlížeči):
- validace manifestu,
- handshake proběhne do časového limitu a verze jsou kompatibilní,
- matice režimů vygenerovaná z manifestu (solo, presenter + N hráčů, party, late join, reconnect, odchod hosta),
- žádné chyby v konzoli, všechny zprávy projdou schématem,
- **fuzz reduceru:** náhodné akce od N fiktivních hráčů, kontrola, že nespadne a je deterministický,
- kontrola frekvence zpráv (detekce spamu),
- výsledek jako zelená/červená tabulka se srozumitelnou chybou (aby ji šlo vložit zpátky do AI).

Playwright v CI (pro registry) lze doplnit později nad stejným testkitem.

### 9.1 Vztah labu a hlavní aplikace

Lab a hlavní aplikace stojí na stejných knihovnách, takže integrace znamená použít balíčky, ne přesouvat kód labu. Po integraci jsou tři možnosti:

1. **Ponechat** lab jako veřejný nástroj pro autory pluginů (podobně jako Storybook nebo Expo Snack).
2. **Zredukovat** ho na minimální dev harness pro vývoj a testování SDK v monorepu (bez lobby a vyladěného UI).
3. **Odstranit** ho běžným commitem. Historii nepřepisovat: v lab není nic tajného a přepis veřejné historie rozbije klony a forky (které by kód stejně uchovaly).

Monorepo bude nějaký harness potřebovat tak jako tak, aby šlo změny v SDK ověřovat proti oficiálním pluginům. Proto je varianta 2 pravděpodobná minimální podoba.

- **Logika je v balíčcích:** `host-sdk` (spojení a transporty), `plugin-testkit` (testy). Lab je jen tenká Vue aplikace nad nimi.
- **Hlavní aplikace** importuje stejné balíčky a postaví si vlastní obrazovky ve svém designu (napojené na sady, účty, pokrok).
- Pokud bude chtít aplikace převzít i hotové komponenty labu (mřížka obrazovek hráčů, inspektor zpráv, výsledky testů), vyčlení se do balíčku `@memizy/lab-ui`. To ale až při integraci, ne předem.
- Lab dál slouží autorům pluginů: veřejně na webu (např. `lab.memizy.com`) a později i lokálně (`bunx @memizy/plugin-lab ./dist/index.html`).

### 9.2 Lobby a připojení hráčů

UX se přebírá ze současného `multiplayer/` (`HostPage.vue`, `JoinPage.vue`):
- PIN, QR kód, tlačítko pro zkopírování odkazu,
- automaticky generované jméno hráče s možností přegenerovat,
- seznam připojených hráčů, start hry.

Komponenty jsou dnes navázané na Supabase a stores aplikace (`useStudySetsStore`, `usePluginsStore`, `useSettingsStore`…). V labu se převezme vzhled a chování a datová vrstva se nahradí `host-sdk` (relay transport). Join stránka pro telefony bude součástí labu.

---

## 10. OQSE 0.2

### 10.1 Změny před prezentací (ovlivňují data pro pluginy)
- `math` → **`latex`** ve `features`. **Knihovna je striktní, bez aliasů a migračního kódu.** Vlastní sady v `code/courses` převede jednorázový skript. Sady uložené v IndexedDB aplikace převede jednorázová migrace přímo v aplikaci (`platform`) při přechodu na `@memizy/oqse` 0.2.
- URL schémat míří na verzovaný npm balíček (`https://cdn.jsdelivr.net/npm/@memizy/oqse@0.2/schemas/…`), takže nezávisí na umístění repozitáře.
- Item typ `math-input` zůstává (popisuje interakci, ne rendering).
- Kontrola a zmražení tvaru položek, které dostávají pluginy. Stabilní `id` sad (budou na ně odkazovat kurzy).

### 10.2 OQSE Markdown: jeden soubor = jedna sada poznámek (hotovo)
Poznámky se píšou jako jeden Markdown dokument (`.oqse.md`), bez escapování Mermaidu a LaTeXu. Bezztrátově ekvivalentní s JSON sadou, která obsahuje jen `note` položky. Specifikace: kapitola „OQSE Markdown (Note Sets)“ v `oqse.md`; implementace `parseMarkdownSet` / `serializeMarkdownSet`.

```markdown
---
oqse: "0.2"
language: cs
---
# Termodynamika                 ← název sady (meta.title)
Úvod = popis sady.

## Základní zákony              ← kapitola (topic)

### První zákon                 ← poznámka (title)
<!-- oqse: {id: …, tags: [fyzika]} -->
Obsah…
#### Odvození                   ← nadpis uvnitř poznámky (v JSONu ##)

> [!hidden]-
> Skrytý obsah.
```

- **Výchozí úroveň poznámek je 3** (konvence: jeden `#` = název dokumentu). Úrovně 2 a 1 jsou pro dokumenty bez názvu nebo s hlubokými nadpisy; serializace volí automaticky 3 → 2 → 1.
- **Nadpisy v poznámce jsou relativní k poznámce:** v JSONu titulek = úroveň 1, obsah začíná `##`; v Markdownu se posunou o úroveň poznámky. Renderer má volbu `headingOffset` (`shiftHeadings`), aby si plugin nadpisy přizpůsobil layoutu.
- **Chybějící `id`, `createdAt`, `updatedAt` parser vygeneruje** a nahlásí v `generated` → AI ani lidé nemusí vymýšlet UUID; aplikace je zapíše zpět.
- **Pokrok (buckety) se do souboru neukládá** (OQSEP / data Obsidian pluginu).
- Ověřeno na vlastních sadách: 16 z 20 sad s poznámkami projde převodem tam a zpět beze změny na úrovni 3 (kromě koncových mezer, které formát ořezává). 4 sady (`ndbi046`, `nswi166`, každá 2×) mají v obsahu poznámky nadpis H1 → validace dává varování `NOTE_HEADING_LEVEL`, převod do Markdownu jde až po snížení nadpisů.

### 10.3 Lint obsahu
Volitelná kontrola při importu: `mermaid.parse`, KaTeX s `throwOnError`. Ukáže, která poznámka je rozbitá, dřív než ji uživatel otevře.

### 10.4 Kurzy (později, mimo jádro OQSE)
Sesterská specifikace (pracovně `course-manifest`): obálka, která řadí kroky typu `set` (odkaz na sadu), `page` (Markdown, stejný parser jako poznámky), `media` (podcast/video) a `link`. Doporučený plugin pro spuštění sady patří do `appSpecific`, protože je specifický pro Memizy. Inspirace: IMS Common Cartridge, cmi5.

### 10.5 Validace: import vs. uložení (hotovo)
- `loadOQSEFile` – tolerantní import (Best Effort): neplatné položky přeskočí, zachová neznámá pole i vlastní `x-` typy, opraví obnovitelné problémy (neplatné reference, malá/velká písmena v klíčích assetů) a vrátí strukturovaný log chyb a varování podle specifikace.
- `validateOQSEFile` / `safeValidateOQSEFile` – striktní kontrola pro uložení a export (navíc duplicitní `id`, HTML bez deklarace `html`, chybějící `targetAsset`…).
- `checkCompatibility` – handshake sady a manifestu (typy, assety, features, verze) pro výběr pluginů v lobby.
- `resolveAsset` – vyhledání assetu (položka, pak sada).

### 10.6 Na později (OQSE)
- **Assety v Markdown sadách:** `<asset:key />` Obsidian ani GitHub nezobrazí. Vyřešit s Obsidian pluginem (např. post-processor, nebo mapování na `![[soubor]]`).
- **Varování na neznámé klíče** ve striktní validaci (pomůže odhalit překlepy z AI, např. staré `shuffleOptions`). Dnes se neznámé klíče podle specifikace jen zachovávají.
- **Lint Mermaid/KaTeX** (kap. 10.3).
- **Import obecného Markdownu** (viz kap. 13).

---

## 11. Repozitáře, struktura a licence

### 11.1 Rozdělení
- `code/engine` = **open-source monorepo** (`memizy/memizy`, Bun workspaces, npm balíčky publikované samostatně).
- `code/platform` = closed source (hlavní aplikace, nasazení, secrets, napojení na Zitadel/billing).
- `code/courses/*` = data kurzů, každý kurz má vlastní repo.
- `code/registries/*` = **přesunout sem z `engine/registries`** (vlastní repa: `plugin-registry`, `open-library`). `multiplayer-plugin-registry` se sloučí do `plugin-registry`, protože SDK je teď jedno.
- Komunitní pluginy žijí v repech autorů, registry na ně odkazují.

### 11.2 Struktura `engine`

```
engine/
├─ packages/                 publikované npm balíčky
│  ├─ oqse/                  @memizy/oqse
│  ├─ protocol/              @memizy/protocol
│  ├─ plugin-sdk/            @memizy/plugin-sdk
│  ├─ host-sdk/              @memizy/host-sdk
│  ├─ plugin-testkit/        @memizy/plugin-testkit
│  └─ game-client/           @memizy/game-client (později)
├─ services/
│  └─ multiplayer-server/
├─ apps/
│  └─ plugin-lab/
├─ plugins/                  oficiální pluginy (zároveň testovací fixtures)
├─ games/                    oficiální standalone hry
├─ docs/                     veřejná dokumentace + AI guide
└─ archive/                  PoC a staré SDK – v gitu ignorováno
```

Plochá složka `packages/` je běžná konvence (nástroje, AI i přispěvatelé ji znají a workspace glob je jednoduchý).

### 11.3 Git
- `oqse-specification` a `plugin-sdk` převzít přes `git subtree add` (zachová historii). Stará GitHub repa archivovat s odkazem na monorepo. Názvy npm balíčků se nemění.
- Oficiální pluginy v `plugins/` (dnes vnořená repa) převzít stejně, postupně.
- OQSE půjde kdykoli v budoucnu vyčlenit zpět (`git subtree split` / `git filter-repo`). Dlouhodobě je bolestivý jen případný přejmenovaný npm balíček.
- `plugin-lab` se verzuje od začátku. Neverzovaná práce by po 18 dnech neměla historii ani zálohu.

### 11.4 Licence
**MIT pro všechno**, včetně serveru. AGPL není potřeba:
- Kdo server použije, používá i tvůj protokol, formáty a SDK. Posiluje to ekosystém, nekonkuruje mu.
- Tvoje konkurenční výhoda je aplikace, obsah a komunita, ne relay server.
- AGPL odrazuje firmy a přispěvatele a komplikuje kombinaci s ostatními MIT balíčky.

---

## 12. Plán (18 dní)

| Dny | Datum | Krok | Výstup |
|---|---|---|---|
| 1 | 5. 10. | Struktura monorepa, Bun workspaces, subtree převzetí, `archive/`, přesun registrů | čistý repozitář |
| 2–3 | 6.–7. 10. | OQSE 0.2: `latex`, zmražení tvaru položek, md ⇄ json poznámek, lint | `@memizy/oqse` 0.2 |
| 4–6 | 8.–10. 10. | `@memizy/protocol` v1 + **AI guide jako první**, společná revize | **zmražený kontrakt v1** |
| 7–10 | 11.–14. 10. | plugin-sdk (`defineGame` + low-level), host-sdk, in-memory transport, standalone mock, 2 oficiální pluginy (solo + quiz-conquest) | SDK 1.0 RC |
| 9–12 | 13.–16. 10. | Relay server: limity, reconnect, Origin allowlist, nasazení na Netcup | běžící server |
| 11–14 | 15.–18. 10. | Plugin Lab: solo + multiplayer, reálná zařízení, testkit | lab |
| 15–16 | 19.–20. 10. | Generalka: pluginy od různých AI modelů, zátěžový test (~40 klientů) | opravy, SDK 1.0 |
| 17–18 | 21.–22. 10. | Rezerva, příprava prezentace | – |

Bez čeho se prezentace neobejde: kontrakt v1, lab s testy, relay server na Netcupu, AI guide. Markdown serializaci poznámek lze v případě skluzu posunout, protože kontrakt neovlivňuje.

---

## 13. Po prezentaci

- Integrace `host-sdk` + labu do hlavní aplikace (`platform`), včetně jednorázové migrace sad v IndexedDB na OQSE 0.2 (stejná pravidla jako níže).
- **Migrace vlastních sad na OQSE 0.2** (`code/courses`, 24 sad). Dělá se najednou, až bude hotová celá nová vrstva. Skript: `archive/scripts/migrate-oqse-0.2.ts` (spuštění bez `--apply` jen vypíše změny a výsledek validace; při posledním běhu bylo všech 24 sad po migraci validních). Pravidla:
  - `$schema` → `https://cdn.jsdelivr.net/npm/@memizy/oqse@0.2/schemas/oqse-v0.2.json`
  - `version` → `0.2` (včetně tří sad omylem ve verzi `1.0`: `nswi166-…` 2× a `set-anatomie-3d`)
  - `meta.requirements.features`: `math` → `latex`
  - `true-false.answer` → `correctAnswer`, `numeric-input.value` → `correctAnswer`, `short-answer.answers` → `correctAnswers`, `chess-puzzle.answers` → `correctAnswers`
  - `shuffleOptions` (MCQ) a `randomize` (timeline) → `shuffle`
  - `math-input`: odstranit `$` kolem `correctAnswer` a `alternativeAnswers`
  - Upravit `course-mff-informatika/bakalarske-statnice/Instrukce.md`: `math` → `latex`; dlouhodobě instrukce přepsat na Markdown poznámky (odpadne zdvojování zpětných lomítek).
  - Pozor: repo `course-standalone-sets/sets-mff-informatika` mělo při kontrole necommitnutou změnu.
  - `ndbi046` a `nswi166` (v obou kurzech): nadpisy H1 uvnitř poznámek snížit na `##` a níž (nadpisy v poznámce jsou relativní, titulek = úroveň 1).
  - `set-ceska-historie-zabavne`: 3 poznámky obsahují `<h2>` bez deklarace `html` → přepsat na Markdown `##` (nebo deklarovat `html`). Nová validace je jinak přeskočí.
- **Import obecného Markdownu do poznámek** (`@memizy/oqse`): samostatná, ztrátová funkce (např. `importMarkdownAsNotes(md, { headingLevel })`), která rozdělí běžný Markdown podle nadpisů zvolené úrovně na note položky (nadpis → `title`, vygenerované `id`, případný callout `[!hidden]` → `hiddenContent`). Oddělená od striktní bezztrátové serializace.
- Standalone hry: `game-client` (MessagePack), authoritative režim, API klíče a kvóty.
- P2P přes nový transport v `host-sdk`.
- Obsidian plugin (bucketový systém nad Markdown poznámkami).
- Specifikace kurzů.
- Škálování na více Bun procesů (routing podle shardu v PINu).
- Playwright testy v CI pro přijímání pluginů do registry.
