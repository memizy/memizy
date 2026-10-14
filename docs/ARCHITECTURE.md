# Memizy Engine – Architecture (1.0)

The open-source engine of Memizy: the **OQSE** study-set format, the **Memizy Plugin
Protocol**, the SDKs for games and hosts, the **relay** multiplayer server and **Memizy Play**
(the reference host with the Plugin Lab). This document explains how the parts fit
together and why. The normative texts are the specifications it links to; where this
document and a specification differ, the specification wins.

| Document | What it defines |
| :--- | :--- |
| [`packages/oqse/oqse.md`](../packages/oqse/oqse.md) (+ `oqse-manifest.md`, `oqse-progress.md`, `oqse-header.md`) | The OQSE 1.0 formats: study sets, application manifests (OQSEM), learning progress, headers |
| [`packages/protocol/SPEC.md`](../packages/protocol/SPEC.md) | The Memizy Plugin Protocol 1.0 between games and hosts, and the compatibility rules |
| [`docs/ai-plugin-guide.md`](./ai-plugin-guide.md) | The SDK as game authors (and their AI assistants) use it |
| [`docs/RELEASE-1.0.md`](./RELEASE-1.0.md) | What is left before and right after the 1.0.0 release |

---

## 1. The parts

```
                 @memizy/oqse  ◄── the format: types, validation, checkAnswer, rich text
                      ▲
             @memizy/protocol  ◄── the contract: types, schemas, limits, errors, display order
              ▲            ▲
 @memizy/plugin-sdk    @memizy/host-sdk  ◄── what hosts use: sessions, iframes, relay client
 (inside every game)        ▲
                            │
        apps/play (Memizy Play)        services/multiplayer-server (relay)
        platform (../platform)         uses @memizy/protocol only
```

| Part | Role |
| :--- | :--- |
| `@memizy/oqse` | OQSE 1.0: TypeScript types, Zod 4 schemas (tolerant `loadOQSEFile`, strict `safeValidateOQSEFile`), JSON Schemas, Markdown sets, compatibility of sets and applications, `checkAnswer` and the comparison of typed answers, rich-text helpers (`toPlainText`, feature detection). Independent of Memizy: any application can use it. |
| `@memizy/protocol` | The plugin protocol: `HostApi` / `PluginApi`, `InitPayload`, manifest schema (`appSpecific.memizy`), settings, limits, error codes, version negotiation, the relay wire types, `prepareDisplaySet` (display order and public items). `@memizy/protocol/internal` holds helpers shared by the Memizy packages (outside semver). |
| `@memizy/plugin-sdk` | What a game imports (`https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`, a self-contained bundle): `defineGame` (state, actions, phases, timers, sync between devices, snapshots, reveals), the morph renderer and `ui.html`, `ui.question` (ready-made answering controls), `checkAnswer`, `createScene3d`, the standalone preview. |
| `@memizy/host-sdk` | What a host uses: `loadPluginFromHtml`, `prepareSetForPlugin`, `LocalSession` (validates every call, routes messages, start barrier, authority, pauses, storage, learning), `mountPlugin` (the sandboxed iframe), `RelayHost` / `RelayPlayer` (multiplayer over the relay, places of a continued game). |
| `services/multiplayer-server` | The relay: rooms by PIN, a secret host token, the game bundle store, WebSocket routing, rate limits. It never runs game rules. |
| `apps/play` | Memizy Play: hosting (lobby, PIN / QR, saved games), joining, playing alone, and the Plugin Lab (write a game with AI, test it on simulated devices, generate question sets). The reference host for the platform. |

Each package has an explicit public API (`src/index.ts`, guarded by a test). Everything
else is internal and may change in any release.

---

## 2. How a game runs

### 2.1 A plugin

A game is **one HTML file**: a manifest in `<script type="application/oqse-manifest+json">`
(the OQSE application manifest with `appSpecific.memizy`: protocol version, modes, settings,
set requirement, permissions, services) and a module script that imports the SDK and calls
`defineGame` once. The host reads the manifest **without running the game**
(`readPluginManifestFromHtml`) to know its modes, views, settings and item types.

The game runs in an iframe sandboxed **without `allow-same-origin`** (no storage, no access
to the host page) and with a Content Security Policy built from its `permissions` (network
origins, devices; libraries only from the allowed CDNs). All communication goes through
`postMessage` (Penpal 8) to the host.

### 2.2 Views and the authority

A session has **views** derived from the manifest: `solo`; in multiplayer a `board` (the
projector, when the host presents) and a `controller` per player; `settings` (the game's
own lobby settings screen). One instance is the **authority** – it runs the rules: the solo
player, the board (`hostAs: 'presenter'`) or the host's own controller (`hostAs: 'player'`).
The address `"server"` is reserved for a future server authority.

The game author writes rules as if there was one shared state. The SDK runs actions on the
authority; every other instance sends them there (`data-act`, `ui.act`) and applies the
state the authority sends back. Followers accept state only from the authority's address.

### 2.3 State and synchronization (inside the SDK)

- **State** is plain JSON, changed only inside actions and phase hooks (mutative drafts).
  Rules are deterministic: `ctx.random`, `ctx.shuffle`, `ctx.now`, `ctx.after`.
- After a change the authority sends **patches** (mutative 2, batched every 16–40 ms;
  in a hidden tab the batching is measured without throttled timers) or the full state to
  devices that missed something. Patches carry their format (`f`); a device that does not
  know it asks for the full state. With `playerView` every device gets only its own view.
- **Phases** (`phases`, `ctx.goto`) give the life cycle: deadlines on the game clock,
  allowed actions per phase, and the SDK drops actions sent from the screen of an older
  phase (`phaseSeq`). `ctx.actedAt` is the tap time (at most 0.4 s before the arrival).
- **Reveals**: other devices get items without answers (below); `ctx.reveal` sends the full
  item to everyone or to one player, `ctx.hide` takes it back.
- **Snapshots**: the authority saves its state and timers (`saveSnapshot`, coalesced to 2
  per second) so it can be recreated after a reload, a crash or in a later lesson.
- The SDK's own messages travel inside the protocol's `send` / `deliver`. Within SDK 1.x
  they only change additively, because the devices of one game may run different 1.x
  versions (a cached copy).

### 2.4 The set: display order and hidden answers

The host prepares the set once per game (`prepareSetForPlugin`): it keeps the item types
the game declares, **shuffles** options, pairs, orders… with a seed (the same order on every
device) and makes **public items** without the fields that give answers away
(`answerHidden: true`; SPEC 4.4). The authority and solo get full items; other instances in
multiplayer get public items. Answers are checked only in actions (`checkAnswer`, which
refuses public items). Answers refer to **choice IDs**, so shuffling never changes them.

### 2.5 Canonical and authoring formats

The OQSE JSON file is the **canonical** form: it is what applications store, exchange and
validate, and item IDs, progress and statistics refer to it. People and AI assistants write
in **authoring formats** that a tool converts to it – OQSE Markdown for notes (lossless, the IDs
live in metadata comments), and in Memizy Play a JSON shorthand of AI-made question sets
(options as texts, the right answer by index; converted once, with new IDs). Every authoring
format keeps item IDs across edits, or is used only once. A documented shorthand for questions
in `@memizy/oqse` is planned after 1.0 (section 7).

### 2.6 Solo, local multiplayer and relay multiplayer

- **Solo and the Lab**: all instances run in one page. `LocalSession` + `mountPlugin`
  connect each iframe to the session.
- **Relay multiplayer**: the host's page runs the `LocalSession` (and so the authority).
  `RelayHost` creates a room (PIN + secret host token), uploads the **bundle** – the plugin
  HTML and `prepared.publicSet`, never the set with answers – and connects each player's
  instance as a remote endpoint. A player's `RelayPlayer` downloads the bundle once, runs
  the game in its own iframe and bridges its calls to the host. The server only forwards:
  players may send only `up` (to the host) and `rename`; the server stamps the sender.
- Two message layers travel over the relay, each with its own version: client ↔ server
  (`RELAY_PROTOCOL`) and host app ↔ player app (`RELAY_APP_VERSION`, sent in `hello` /
  `mount`, so a host can see an older cached player app). Both are additive within 1.x;
  unknown methods are answered with `UNKNOWN_METHOD`.

### 2.7 Lobby, start, pauses

The host shows the lobby (players join with **random nicknames**; the game's settings in a
generated form or in the game's own settings screen), waits until every instance has loaded
(the start barrier), counts down and calls `start` on the authority. Late joiners get the
current state from the authority. The host can **pause**: the session clock (`SessionClock`:
`offsetMs`, `pausedMs`, `pausedAt`) stands still on every device, timers and phases wait,
actions are ignored.

### 2.8 Saving and continuing a game

A host may save a game that has not ended – the last snapshot, the settings, the
display-order seed and the players – and continue it later (SPEC 3.3). The continued
session keeps the session ID and the **player IDs** (the game state refers to them), starts
from the snapshot and **paused**. In multiplayer it may be a new room with other devices:
each device takes the place of an earlier player (`RelayHost.attach(session, { seats: true })`;
the device picks the earlier nickname, the host can change it with `assignSeat`). A game that
ended with a result is not continued (its snapshot is deleted).

### 2.9 Learning progress, plugin data, services

- **Learning progress** belongs to the host: the game reports answers with
  `recordAnswer` (what was answered, in the OQSE Answer Formats; a flashcard self-rating is
  an answer), the host's `LearningAlgorithm` (Leitner by default) decides the new record and
  stores it through `HostStorage`.
- **Plugin data** (`ui.save` / `ui.saved`): small JSON per player across sets (`plugin`) or
  per set (`set`), for unlocked levels or best scores.
- **Services** (`ui.service`): things a set cannot contain (AI answers, fresh exercises),
  declared in the manifest and offered by the host; results are JSON (often OQSE items).

---

## 3. The contract 1.0

### 3.1 What is versioned

| Layer | Version | Where |
| :--- | :--- | :--- |
| OQSE formats | `"version": "1.0"` in every file | Applications read the MAJOR versions they support (0.x drafts are refused). |
| Plugin protocol | `protocol: "1.0"` in the manifest and the handshake | Hosts support a set of versions (one per MAJOR) and negotiate the lower MINOR. A plugin that uses a 1.x addition declares that version. |
| SDK API | `@memizy/plugin-sdk` semver | Games import `@1`: every 1.x release reaches them. |
| SDK messages | additive; patches carry `f` | Devices of one game may run different 1.x SDKs. |
| Relay | `RELAY_PROTOCOL` (client ↔ server), `RELAY_APP_VERSION` (host ↔ player app) | Additive; unknown parts are ignored. |
| Packages | semver; Zod 4 for the whole 1.x line | `@memizy/protocol/internal` is outside semver. |

### 3.2 What may change in 1.x

New optional fields, new methods guarded by a feature (`features` in the handshake), new
setting types, new enum values where receivers must ignore unknown ones (error codes,
`sessionEnded` reasons, `Player` fields), larger limits. Libraries inside the SDKs may be
updated. Everything else in SPEC 9 is frozen.

### 3.3 Reserved names

- **Stable names for later features** (SPEC 10): the address `"server"`, the host methods
  `exit`, `resize`, `saveProgress`, `uploadAsset`, the plugin method `setChanged`, the
  features `edit-set`, `teams`, `replay`, `Player.active`, hot-seat, host migration, item
  field `generated`.
- **SDK namespaces** (SPEC 9): action names and timer keys starting with `$`; HTML
  attributes `data-mz-…` (besides `data-act`, `data-local`, `data-payload`, `data-setting`,
  `data-keep`, `data-key`); CSS classes `mz-…`. State fields of the SDK exist only on request
  (`phase`, `phaseSeq`, `phaseEndsAt` with `phases`); later ones will be opt-in too.

### 3.4 Limits (SPEC 8.1)

A `send` message (and so the whole state or a view) at most 64 KB at 30 messages per second
(burst 60); snapshot 1 MB (2 per second stored); plugin data 256 KB per scope; a recorded
answer 4 KB, a generated item 32 KB; services 64 KB per request, 30 per minute; `hello`
within 10 s. The relay: frames up to 2 MB, bundles up to 8 MB, 100 players per room, rooms
close after 6 hours or 10 minutes without the host.

---

## 4. Security and privacy

- **Isolation**: the iframe has an opaque origin (no `allow-same-origin`), never
  `allow-top-navigation`; popups may escape the sandbox, so links open in a new tab. A CSP
  limits network access to the declared origins; devices need a declaration.
- **The host validates every call** (schemas, sizes, rates, views, authority) and reports
  rejections: only the authority may record answers for other players or save snapshots,
  and plugin data is always the instance's own player's.
- **Answers**: players' devices get public items; the relay bundle holds only public items;
  anyone with a PIN can download it, so it must never contain answers. A curious student can
  still read the state: secrets in the state need `playerView`. Teacher-only actions check
  `ctx.fromHost`. Graded tests are not plugins (SPEC 10): where cheating matters, the
  platform checks answers on its server.
- **Privacy**: players have random nicknames; games MUST NOT ask for real names or other
  personal data (SPEC 3.3). A signed-in student's identity can travel as `auth` when joining
  a room: the relay passes it to the host only, never to other players; the host app checks it.
- **The relay**: rooms are protected by a random PIN plus a secret host token; an `Origin`
  allowlist, frame and rate limits, a limit of rooms per IP. It runs without published ports
  behind a Cloudflare Tunnel.

---

## 5. Decisions and why

| Decision | Why |
| :--- | :--- |
| One SDK for solo and multiplayer; the game writes rules and screens, never networking | Students write games with AI: one simple model (state, actions, render) works everywhere. |
| The authority is a normal instance (board, host or solo), the relay only forwards | No game code on the server; any game works in multiplayer without deployment. A server authority stays possible (`"server"`). |
| Capabilities are static in the manifest | Lobbies, registries and the Lab need them before running the game. |
| Answers by choice ID, display order by the host | Sets can be edited without breaking statistics; every device sees the same order; public items hide answers. |
| The host owns learning (`recordAnswer`, algorithm, storage) | One learning model across games; games cannot corrupt progress. |
| Contract frozen at 1.0, additive afterwards; uncertain features removed and reserved | Games made by students must keep working; adding later is possible, removing never. |
| The SDK from the CDN at `@1` | Fixes reach every game without changing it. |
| OQSE does not depend on Memizy | An open format others can adopt. |
| Random nicknames, `auth` only to the host | Schools and GDPR: no personal data in games or on the relay. |
| MIT for everything open-source, including the relay | The advantage of Memizy is the platform, content and community, not the relay. |

---

## 6. Testing and deployment

- `bun run test` builds the packages and runs every workspace's tests: unit tests, real SDK
  games in `LocalSession` (jsdom), the relay end to end (a real server process), Play
  (saved games, links, built-in games), and the OQSE conversion script.
- `cd apps/play && bun run e2e:3d`: the 3D rules with real WebGL in Edge (SwiftShader).
- The Plugin Lab runs automated checks of a game, including a "naughty player".
- **Play**: Cloudflare Workers static assets (`apps/play/wrangler.jsonc`), built with
  `PLAY_BASE` and `VITE_RELAY_URL`; deploys from `main`.
- **Relay**: Docker compose (relay + cloudflared) on a Netcup server reachable over
  Tailscale; `services/multiplayer-server/deploy/deploy.sh`.
- **Packages**: npm (`next` for release candidates), jsDelivr serves the SDK bundle and the
  JSON Schemas at `@1`.

---

## 7. After 1.0

Reserved in the contract (section 3.3) and planned:

- **Platform integration**: the platform uses `@memizy/oqse`, `@memizy/protocol` and
  `@memizy/host-sdk` (persistent `HostStorage`, signed-in players through `auth`) instead of
  its own older SDKs; Play's flows are the reference.
- **Server authority** for official games (graded homework, larger games), running the
  same rules and `prepareDisplaySet` on the server.
- **Embedding** games in articles and courses (`resize`), leaving from inside a game (`exit`),
  live set editing (`setChanged`), placement tests (`saveProgress`), recording and replaying
  games (`replay`), teams, hot-seat, host migration.
- **SDK** (1.x, no contract change): actions on `pointerdown`, late-action protection for
  games without phases, more languages of the SDK's texts, keyboard shortcuts in
  `ui.question`, sounds.
- **Authoring formats**: a documented shorthand for questions in `@memizy/oqse`
  (`compileShorthand`: options as texts, the right answer by text or index, IDs generated and
  kept), starting from the conversion Play does for AI-made sets; later perhaps OQSE Markdown
  for the most common question types, and a sister specification once the shorthand settles.
- **Content**: converting the existing course sets to OQSE 1.0
  (`bun scripts/migrate-oqse/cli.ts <dir> [--apply]`), importing general Markdown as notes, a
  sister specification for courses, an Obsidian plugin.
- **Infrastructure**: standalone games (their own client and API keys), P2P transport,
  several relay processes (a shard in the PIN), Playwright checks for a plugin registry.
