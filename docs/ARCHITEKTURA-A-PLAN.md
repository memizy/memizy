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
| D4 | **Pohled (view) a autorita jsou oddělené pojmy.** Plugin nepíše síťovou logiku: definuje `reducer` a `render`. Kde reducer běží, rozhoduje SDK a platforma. |
| D5 | **Transport volí platforma, ne plugin:** relay (výchozí), P2P (později), authoritative (jen whitelist). |
| D6 | **Authoritative režim je pouze pro oficiální pluginy a hry** (whitelist zakompilovaný v serveru, žádné dynamické načítání kódu). |
| D7 | **Party režim nemá tabuli.** Host je hráč se stejnou obrazovkou jako ostatní (plus práva v lobby). |
| D8 | **Kontrakt nese verze** (protokol, SDK, host, plugin, data). Vyjednávají se v handshaku. |
| D9 | **Iframe sandbox bez `allow-same-origin`** (opaque origin), stejně jako v současném `multiplayer/`. `allowedOrigins: ['*']` je v tomto případě nutné a v pořádku, protože Penpal ověřuje `remoteWindow`. |
| D10 | **Server zatím jako jeden Bun proces.** Formát PINu/roomId si nechává místo pro identifikátor shardu. |
| D11 | **Server bez API klíčů.** Ochranu zajišťuje allowlist `Origin` (aplikace a lab) a limity. Klíče přijdou se standalone hrami. |
| D12 | **Markdown je bezztrátová serializace celé sady poznámek** (jeden soubor = jedna sada, nadpisy = poznámky), ne náhrada JSONu. |
| D13 | **OQSE: `math` → `latex`** s přechodným aliasem ve validátoru. |
| D14 | **Kurzy nejsou součást jádra OQSE**, ale sesterská specifikace (později). |
| D15 | **Open-source monorepo `engine`.** Registry a komunitní pluginy jsou v samostatných repech. Nasazení a secrets patří do closed `platform`. |
| D16 | **Licence: MIT** pro všechno open-source včetně serveru (viz kap. 11). |
| D17 | **Lab se vyvíjí v `engine/apps/plugin-lab`** nad open-source balíčky (`host-sdk`, `plugin-testkit`). Po integraci do hlavní aplikace se rozhodne, zda zůstane (veřejný nástroj pro autory pluginů), zredukuje se na minimální dev harness pro vývoj SDK, nebo se odstraní běžným commitem (bez přepisování historie). Viz kap. 9.1. |
| D18 | **Lobby UX (PIN, QR, kopírování odkazu, generované jméno s možností přegenerovat) se přebírá ze současného `multiplayer/`.** Datová vrstva (Supabase, stores aplikace) se nahradí relay transportem z `host-sdk`. |

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

## 3. Herní režimy, pohledy a autorita

### 3.1 Osy

| Osa | Hodnoty | Kdo rozhoduje |
|---|---|---|
| Režim | `solo` · `multiplayer` | plugin deklaruje, uživatel volí |
| Účast hosta (multiplayer) | `presenter` (učitel u tabule, nehraje) · `party` (host hraje, tabule není) | plugin deklaruje, lobby nabídne |
| Autorita (kde běží reducer) | `host` · `server` | plugin deklaruje (`server` jen pro whitelist) |
| Transport | `relay` · `p2p` · `authoritative` | platforma |

### 3.2 Pohled × autorita

| Situace | Pohledy (views) | Kde běží reducer |
|---|---|---|
| Solo | `solo` | lokálně v pluginu |
| Multiplayer – presenter | host: `board`, hráči: `controller` | v instanci `board` |
| Multiplayer – party | všichni: `controller` | v instanci hosta (vypadá jako ostatní) |
| Authoritative (whitelist) | podle hry | na serveru (stejný izomorfní reducer) |

Autor pluginu řeší jen pohledy. Autoritu řídí SDK.

---

## 4. Manifest (statická deklarace)

Manifest je uložený v HTML jako data island `<script type="application/memizy-manifest+json">` a zrcadlí se do registry. Ilustrační tvar (finální podobu určí `@memizy/protocol`):

```jsonc
{
  "manifestVersion": "1.0",
  "id": "quiz-conquest",
  "name": "Quiz Conquest",
  "version": "1.2.0",
  "protocol": { "min": "1.0" },          // minimální verze protokolu hostitele
  "modes": {
    "solo": { "bots": true },
    "multiplayer": {
      "players": { "min": 2, "max": 40 },
      "hostParticipation": ["presenter", "party"],
      "teams": false,
      "lateJoin": true,
      "reconnect": true,
      "authority": "host"
    }
  },
  "data": {
    "itemTypes": ["mcq-single", "true-false"],  // může být i prázdné: plugin nemusí používat otázky
    "requiresItems": true
  },
  "settings": [ /* schéma nastavení pro lobby */ ]
}
```

Plugin může deklarovat jen `solo`, jen `multiplayer` nebo obojí. V multiplayeru může podporovat jen `presenter`, jen `party` nebo obojí.

---

## 5. Kontrakt plugin ↔ host a verzování

### 5.1 Co musí zůstat kompatibilní

Plugin si SDK nese **zabudované v sobě**, takže starý plugin = staré SDK. Změny API uvnitř SDK proto staré pluginy nerozbijí. Navždy kompatibilní musí zůstat:

1. **Protokol plugin-sdk ↔ host-sdk** (zprávy, jejich tvar, sémantika).
2. **Schéma manifestu.**
3. **Tvar dat předávaných pluginu** (kontext, hráči, OQSE položky).

### 5.2 Verze v handshaku

Plugin při `sysReady` pošle:

```jsonc
{
  "protocolVersion": "1.0",       // verze kontraktu, kterou SDK mluví
  "sdkVersion": "1.0.3",          // informativní (debug, telemetrie)
  "plugin": { "id": "quiz-conquest", "version": "1.2.0" },
  "manifestVersion": "1.0",
  "features": ["defineGame", "patches"]   // volitelné schopnosti SDK
}
```

Host odpoví:

```jsonc
{
  "protocolVersion": "1.0",       // dohodnutá verze (stejný major, nižší z minor verzí)
  "host": { "name": "memizy-app", "version": "3.4.0" },
  "oqseVersion": "0.2",
  "features": ["patches", "assetsUpload"],
  "context": { /* režim, view, self, hráči, items, assets, settings … */ }
}
```

Pravidla:
- **Stejný major je podmínka.** Při neshodě host zobrazí srozumitelnou chybu („plugin vyžaduje novější Memizy“), nic tiše nespadne.
- **Minor verze přidávají jen aditivní změny.** Nové volitelné zprávy a pole, neznámá pole se ignorují.
- Novou schopnost smí strana použít jen tehdy, když ji druhá strana uvedla ve `features`.
- `host-sdk` musí umět mluvit se **všemi verzemi 1.x**. Vznikne-li 2.0, host-sdk ponese adaptér pro 1.x.

### 5.3 Zásady návrhu v1

- **Malé API.** Každá metoda je závazek na roky. Do v1 jde jen to, co studenti potřebují.
- Pokud se SDK načítá z CDN, URL se zamyká na major verzi (`…/plugin-sdk@1`).
- **Akceptační test kontraktu:** pluginy vygenerované 3–5 různými AI modely (včetně slabších) pouze podle AI guidu.

---

## 6. Plugin SDK

### 6.1 Vysokoúrovňové API (doporučené, hlavně pro AI)

```js
import { defineGame } from '@memizy/plugin-sdk';

defineGame({
  manifest,                                        // nebo načtení z data islandu
  setup: (ctx) => initialState,                    // ctx: items, players, settings, random
  reducer: (state, action, { playerId, now, random }) => newState,  // čistá funkce
  render: (state, { view, self, dispatch }) => { /* vykreslení */ },
});
```

- Reducer je **čistý a deterministický**. Náhoda jde jen přes `random` (seedovaný) a čas jen přes `now`. Díky tomu funguje fuzz test, replay i budoucí authoritative běh na serveru.
- `dispatch(action)` pošle akci k autoritě. Výsledný stav pak dostanou všichni.
- Stejné komponenty UI lze použít ve více pohledech (např. karta otázky v `solo` i `controller`).

### 6.2 Nízkoúrovňové API (únikový východ)

Přímé `broadcastState` / `onPlayerAction` / `onState` / lifecycle eventy pro pluginy, kterým `defineGame` nevyhovuje.

### 6.3 Standalone běh

Když plugin běží mimo iframe (nebo handshake nedoběhne včas), SDK spustí mock hostitele s **validními OQSE daty** a umožní vyzkoušet deklarované režimy lokálně.

### 6.4 K rozhodnutí při návrhu protokolu (dny 4–6)

- **Časovače:** jak řešit limit 15 s na otázku, když je reducer čistý (např. `phase` s `deadline` + akce `tick` od autority).
- **Soukromý stav hráče:** volitelná projekce `view(state, playerId)`. V relay režimu jde o „soft“ ochranu, což je pro výuku dostačující.
- **Data pro ovladače:** dostávají všechny items, nebo jen to, co pošle autorita?
- **Assety v multiplayeru:** URL vs. přenos.
- **Týmy, late join a reconnect:** přesná sémantika.
- **Nastavení (settings):** schéma v manifestu a jeho vykreslení v lobby.
- **Manifest pluginu = OQSEM + runtime část Memizy.** Doporučení: jeden data island; OQSEM popisuje obsah (`types`, `features`, `assets`), runtime část Memizy (režimy, pohledy, hráči) je pod `appSpecific.memizy` a její schéma je v `@memizy/protocol`.
- **Data předávaná pluginu:** host načítá sadu přes `loadOQSEFile` (tolerantně, neplatné položky přeskočí, neznámá pole zachová) a pluginu předává jen položky typů, které plugin deklaruje (výběr pluginů v lobby přes `checkCompatibility`).
- **Pokrok v multiplayeru:** kdo a komu zapisuje OQSEP záznamy (každý hráč sám za sebe u sebe, nebo host za všechny). Formát OQSEP stačí, jde o pravidla protokolu.
- **Chyba v současném SDK (opravit při přepisu, dny 7–10):** `TextManager.parseTokens` čte z `<asset:map />` klíč `"map "` (s mezerou) a nesjednocuje malá/velká písmena, takže asset nenajde. Použít `OQSE_TAG_PATTERN` / `findAssetKeys` z `@memizy/oqse`. (`renderHtml` už používá opravenou funkci z OQSE.)
- **Assety:** host pluginu vždy předá načitatelné URL (relativní cesty z `.oqse` balíčku převede na `blob:`/`https:`); plugin hledá assety přes `resolveAsset` (položka, pak sada).

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
