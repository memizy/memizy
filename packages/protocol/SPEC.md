# Memizy Plugin Protocol v1

> Status: **1.0** (protocol version `1.0`, packages `1.0.0`). The contract is frozen: within MAJOR `1` it changes only additively (section 9). Every change is recorded in the changelog at the end.

This document defines the contract between a **Memizy plugin** (an HTML page running in a sandboxed iframe) and a **Memizy host** (the Memizy app, the Plugin Lab, or any other application embedding plugins through `@memizy/host-sdk`).

It covers:

1. the **plugin manifest** (what the plugin declares statically),
2. the **session model** and lifecycle,
3. the **handshake** and version negotiation,
4. the **RPC methods** in both directions,
5. **message routing** for multiplayer,
6. **limits, errors, security and compatibility rules**.

It does **not** cover the high-level game API (`defineGame`) – that lives in `@memizy/plugin-sdk`, which every plugin bundles (see [the AI plugin guide](../../docs/ai-plugin-guide.md)). It also does not cover the host ↔ multiplayer-server wire protocol, which is internal to `@memizy/host-sdk`.

Data formats (sets, items, progress) are defined by [OQSE](../oqse/oqse.md).

---

## 1. Design Principles

* **Small surface.** Everything a plugin needs is built in the SDK on top of a few generic primitives (messages, snapshot, learning progress, plugin data, assets, lifecycle). Only these primitives are frozen.
* **The plugin never talks to the network.** All communication goes through `postMessage` to the host (Penpal). Games that need more than JSON messages through the host must be standalone games.
* **The host owns the session.** Lobby, players, settings, starting and ending a session, persistence and learning algorithms (Leitner/FSRS) belong to the host.
* **Additive evolution.** Minor versions only add optional fields, methods and features; both sides ignore what they do not know.

---

## 2. Plugin Manifest

The manifest is an [OQSEM](../oqse/oqse-manifest.md) document embedded in the plugin HTML as a data island. The host reads it **without executing the plugin** (registry, upload in the Lab).

```html
<script type="application/oqse-manifest+json">
{
  "version": "1.0",
  "id": "https://example.com/plugins/quiz-race",
  "appName": "Quiz Race",
  "pluginVersion": "1.0.0",
  "capabilities": {
    "actions": ["render"],
    "types": ["mcq-single", "true-false"],
    "features": ["markdown", "latex"]
  },
  "appSpecific": {
    "memizy": {
      "protocol": "1.0",
      "modes": {
        "solo": {},
        "multiplayer": {
          "players": { "min": 2, "max": 40 },
          "hostAs": ["presenter", "player"],
          "lateJoin": true
        }
      },
      "settings": [
        { "id": "questionTime", "type": "number", "label": "Time per question (s)", "default": 20, "min": 5, "max": 120 }
      ]
    }
  }
}
</script>
```

The OQSEM part describes **content** (item types, assets, features) and is used for the [OQSE handshake](../oqse/oqse-manifest.md#the-handshake-matching-process) (`checkCompatibility`). The Memizy part (`appSpecific.memizy`) describes the **runtime**:

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `protocol` | string | Yes | Minimum protocol version the plugin needs, `MAJOR.MINOR` (e.g. `"1.0"`). |
| `set` | `"required"` \| `"optional"` \| `"none"` | No | Whether the plugin uses a study set. Default `"required"`: the host offers sets and checks compatibility. `"optional"`: the host also offers playing without a set. `"none"`: a game without questions – the host offers no set, checks nothing and reports no incompatibility. Without a set, the plugin gets an empty set (`items: []`, `meta` made by the host, e.g. with the plugin's name). `"required"` and `"optional"` need `capabilities.types`; `"none"` needs none. |
| `modes` | object | Yes | At least one of `solo`, `multiplayer`. |
| `modes.solo` | object | No | Present = the plugin supports single-player. Empty object for now. |
| `modes.multiplayer.players` | `{min, max, recommended?}` | Yes (in multiplayer) | Player count limits (players, not counting a presenter). `1 ≤ min ≤ max ≤ 200`; `recommended` is a hint for the lobby. |
| `modes.multiplayer.hostAs` | string[] | Yes (in multiplayer) | How the host may take part: `"presenter"` (host shows a shared board and does not play) and/or `"player"` (host plays like everyone else, no board). |
| `modes.multiplayer.lateJoin` | boolean | No | Players may join a running game. Default `true`. |
| `settings` | SettingDefinition[] | No | Settings of the game (see below). Default `[]`. They define types, defaults and limits; the host validates every value against them. Used in both modes (section 3.3). |
| `settingsScreen` | `{ size }` | No | Multiplayer lobby only. Present = the plugin renders its own settings screen (view `settings`) on the host's device; absent = the host generates a form from `settings`. `size: "compact"` – a panel next to the player list (the user may expand it to full screen); `size: "large"` – opened as a full-screen dialog from a "Game settings" button. |
| `display.orientation` | `"any"` \| `"portrait"` \| `"landscape"` | No | Preferred orientation of player screens. Default `"any"`. |
| `permissions.network` | string[] | No | Origins the plugin talks to with `fetch` / WebSocket, as `"https://host[:port]"` or `"wss://host[:port]"` (no path; max 20). Shown to users and enforced (section 8.4). |
| `permissions.devices` | (`"camera"` \| `"microphone"` \| `"geolocation"` \| `"serial"` \| `"bluetooth"`)[] | No | Devices the plugin uses; the host grants only these (section 8.4). |
| `services` | string[] | No | Memizy services the plugin calls (section 5.3), e.g. `"chess.puzzles"`: lowercase segments joined by dots. A host that does not offer one can still run the plugin; the call then fails with `SERVICE_UNAVAILABLE`. |

**SettingDefinition:** `{ id, type, label, default, description?, modes?, ...typeSpecific }`

`modes`: `["solo"]`, `["multiplayer"]` or both (default when absent). Hosts show a setting only in the modes it applies to; the plugin still receives a value (the default) for every declared setting.

| `type` | Extra keys | Value |
| :--- | :--- | :--- |
| `number` | `min?`, `max?`, `step?` | number |
| `boolean` | – | boolean |
| `select` | `options: [{ value, label }]` | one of the values |
| `text` | `maxLength?` | string |

`label`, `description` and option labels are either a string or a map of BCP 47 language → string (e.g. `{ "cs": "Čas", "en": "Time" }`).

Reserved for later minor versions: `teams`, editing permissions.

---

## 3. Session Model

### 3.1 Terms

| Term | Meaning |
| :--- | :--- |
| **Host** | The application that embeds the plugin on a device and connects it to the session (the Memizy app, the Plugin Lab, on a player's device the player's app). A plugin only ever talks to its host; how a host connects the devices of a session is the host's business. |
| **Session** | One run of a game, from start to end (e.g., one quiz in a lesson). |
| **Mode** | `solo` (one person plays alone) or `multiplayer` (several devices together). |
| **Host role** (`hostAs`) | In multiplayer, the role of the person who created the session: `presenter` (shows a shared board, e.g. a teacher at a projector, and does not play) or `player` (plays like everyone else, no board). A plugin may support both; the host chooses in the lobby. |
| **Instance** | One running plugin iframe on one device. 30 phones + 1 projector = 31 instances. |
| **View** | What one instance shows: `solo`, `board` (the presenter's shared screen), `controller` (one player's own screen – a phone, tablet or computer) or `settings` (the plugin's settings screen on the host's device in the multiplayer lobby). Views are derived from the manifest (section 3.2), not declared separately. |
| **Player** | A person who plays and can score. The presenter is not a player. |
| **Address** | The "envelope address" of an instance, used to route messages (section 6): the player ID for a player's instance (stable across reconnects), `"board"` for the presenter's board, `"settings"` (`SETTINGS_ADDRESS`) for the plugin's settings screen in the lobby. The address `"server"` is **reserved** for a future server-side authority. Plugin authors never see addresses; the SDK exposes only player IDs. |
| **Authority** | The one place that owns the game state and applies actions: the board (`presenter`), the host's controller (host as `player`) or the only instance (`solo`). Other instances send actions to it and receive the new state. In a future version the authority may be the server (address `"server"`); this is why game logic must be deterministic. |
| **State** | The whole state of the game: one JSON value owned by the authority; its content is defined by the plugin. |
| **Action** | An intent of a player or a timer (e.g., "answered B"). Only actions change the state. |
| **Snapshot** | A saved copy of the authority's state (including pending timers), used to resume the game when the authority instance is recreated (reload, crash). Late joiners and reconnecting players do not use it; they synchronize with the running authority. |
| **Learning progress** | Per-item learning records of a player in [OQSEP](../oqse/oqse-progress.md) (buckets, review dates). Understood and scheduled by the host. |
| **Plugin data** | Game progress of a player that only the plugin understands (unlocked levels, coins, best scores). Stored by the host, opaque to it (section 5.2). |

| Situation | Instances (views) | Authority |
| :--- | :--- | :--- |
| Solo | 1 × `solo` | itself |
| Multiplayer, host as presenter | 1 × `board` + N × `controller` | `board` |
| Multiplayer, host as player | N × `controller` (host is one of them) | host's controller |

### 3.2 Views Are Derived from the Manifest

A plugin does not declare views. They follow from what it declares, so the two can never contradict each other:

| The manifest declares | The plugin must render view |
| :--- | :--- |
| `modes.solo` | `solo` |
| `modes.multiplayer` with `hostAs` containing `presenter` | `board` and `controller` |
| `modes.multiplayer` with `hostAs` containing `player` | `controller` |
| `modes.multiplayer` and `settingsScreen` | `settings` |

`hostAs`, `players`, `lateJoin` and `settingsScreen` only apply when `modes.multiplayer` is declared. The `settings` schema applies to both modes.

### 3.3 Lifecycle

**Multiplayer:**

1. **Lobby** (host UI). The host chooses the plugin and the set; players join. Player names are display names chosen by the host app – Memizy Play gives every player a random nickname and does not ask for real names (privacy of students); a host may let players change it. Names may change during the game (`playersChanged`). Plugins MUST NOT ask players for their real names or other personal data; a game that needs a name uses `Player.name`. The settings are edited by the host: either in a form generated from `settings`, or – if the manifest declares `settingsScreen` – in the plugin itself running in view `settings` on the host's device (the plugin calls `updateSettings` and receives `playersChanged`). Start is enabled only while the settings are valid.
2. **Loading.** After Start, the host creates the game instances (board and/or controllers). Each instance connects, receives its `InitPayload` (without game state) and calls `ready()`.
3. **Countdown.** When all connected instances are ready (or after a host-defined timeout, e.g. 15 s), the host shows a countdown and then calls `start()` on the authority. The authority creates the initial state and the game runs. The barrier exists so that timed games do not start before slower devices have loaded.
4. **Running.** Late joiners (if `lateJoin`) and reconnecting players get a new instance, which synchronizes with the authority. A recreated authority receives the last `snapshot` and continues without `start()`. While the authority is unreachable, see section 6.1.
5. **End.** The authority calls `end(result)`; the host shows results and finally closes the instances with `sessionEnded`.

**Solo:** one instance in view `solo`. There is **no plugin settings screen and no countdown**. Before creating the instance, the host MAY show a form generated from the settings that apply to solo (`modes`); otherwise it uses the defaults or values it presets (e.g. a course step "practise this set with 10 questions"). It calls `start()` right after `ready()`. Choices that belong to the game itself (a level, a character) are made inside the game, typically as its first phase.

**Continuing a saved game** (a host feature; nothing changes for plugins). A host may save a game that has not ended – the authority's last snapshot, the settings, the display-order seed (4.4) and the players – and continue it later, in multiplayer also in a new room with other devices. The continued session keeps the same session ID and the same player IDs, so the game state stays valid: the authority is recreated from the snapshot (`InitPayload.snapshot`, no `start()`), the session starts paused (`SessionClock`, so the time between the lessons does not count), and each device takes the place of one earlier player (the host decides how; Memizy Play lets the player pick the earlier nickname and the teacher change it). A place without a device is a disconnected player (6). A game that ended with `end(result)` cannot be continued (its snapshot is discarded, 5).

---

## 4. Handshake

The connection uses [Penpal](https://github.com/Aaronius/penpal) over `postMessage`. The iframe is sandboxed **without** `allow-same-origin` (opaque origin), therefore the plugin connects with `allowedOrigins: ['*']`; Penpal still verifies that messages come from the expected window.

**Transport.** Within MAJOR version 1 the connection is Penpal 8 over `postMessage`, with the method names of sections 5 and 7. Implementations may update Penpal (including security fixes) only to versions that speak the same wire protocol: an older host must still connect to a newer plugin and the other way round. Penpal 8 needs `Promise.withResolvers` and `Object.hasOwn`; on older browsers the host and the SDK add them before connecting.

1. The host creates the iframe and starts listening.
2. The plugin (SDK) connects and calls `hello(handshake)` within **10 s**.
3. The host validates the handshake and returns an `InitPayload` or rejects with a `ProtocolError`.
4. The plugin renders and calls `ready()`. Until then the host shows a loading state.

### 4.1 `Handshake` (plugin → host)

```ts
interface Handshake {
  protocol: string;                     // version the SDK speaks, "1.0"
  sdk: { name: string; version: string };    // e.g. { name: "@memizy/plugin-sdk", version: "1.0.3" }
  plugin: { id: string; version: string };   // from the manifest
  features: string[];                   // optional capabilities of the SDK, see 8.3
}
```

### 4.2 `InitPayload` (host → plugin)

```ts
interface InitPayload {
  protocol: string;                     // negotiated version: same MAJOR, MIN of the MINORs
  host: { name: string; version: string };
  oqseVersion: string;                  // "1.0"
  features: string[];                   // host features, see 8.3

  session: {
    id: string;
    mode: 'solo' | 'multiplayer';
    hostAs: 'presenter' | 'player' | null;   // null in solo
    view: 'solo' | 'board' | 'controller' | 'settings';
    self: Address;                      // this instance
    authority: Address;                 // who owns the game state
    lateJoin: boolean;                  // this instance joined a running game
  };

  players: Player[];                    // current roster (presenter is not a player)
  set: {
    meta: OQSEMeta;
    items: OQSEAnyItem[];               // only types the plugin declared, in display order (4.4); public items for non-authority instances in multiplayer
  };
  settings: Record<string, unknown>;    // current values for every declared setting (defaults applied)
  config: { locale: string; theme: 'light' | 'dark' };
  clock: SessionClock;                  // session clock and pauses (below)
  services: string[];                   // services declared by the plugin AND offered by this host
  progress: Record<string, ProgressRecord>;  // learning progress of `self` (empty for board/settings)
  data: { plugin: unknown; set: unknown };   // plugin data of `self` (null when nothing saved; null for board/settings)
  snapshot: unknown | null;             // last saved snapshot, only for the authority (resume)
}

type Address = string;                  // player ID, "board", "settings"; "server" is reserved

interface SessionClock {
  offsetMs: number;                     // Date.now() + offsetMs = session time
  pausedMs: number;                     // total of finished pauses
  pausedAt: number | null;              // session time when the current pause began (null = running)
}
// Game time = (pausedAt ?? session time) - pausedMs. The SDK uses game time for ctx.now,
// timers and countdowns, so a pause stops them everywhere and nothing jumps afterwards.

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}
```

**Assets:** every `MediaObject.value` in `set` is either an absolute `https:` URL, or a host-relative key that the SDK resolves with `getAsset` (section 5). The host never passes `blob:` URLs, because an opaque-origin iframe cannot load the host's blob URLs.

### 4.3 Version negotiation

* A host supports a set of protocol versions, one per MAJOR version (e.g. `1.4` and `2.1`). The plugin's MAJOR version must be one of them. Otherwise the host rejects with `ProtocolError { code: 'UNSUPPORTED_PROTOCOL' }` and shows the user a clear message ("this plugin needs a newer Memizy" or "this plugin is too old").
* The negotiated version has the plugin's MAJOR and the lower of both MINOR versions. Neither side uses a method, field or feature introduced in a higher minor than the negotiated one.
* A plugin that uses a field, value, method or setting type introduced in protocol 1.*x* declares `protocol: "1.x"` in its manifest (the minimum version it needs). A host that supports only an older minor version then rejects it before loading, instead of misreading what it does not know.
* `manifest.appSpecific.memizy.protocol` is checked **before** loading the iframe (the host does not offer plugins it cannot run). The manifest itself (`version`, the OQSEM format) follows the [OQSE version rules](../oqse/oqse.md#versioning-and-compatibility): the host reads the OQSEM MAJOR versions it supports.
* A host SHOULD keep supporting older MAJOR versions as long as practical (e.g. an adapter in `@memizy/host-sdk`), so older plugins keep working.

### 4.4 Display order and hidden answers

The host prepares the set once per session (`prepareDisplaySet` in `@memizy/protocol`; a future server authority does the same):

1. **Display order.** With a seed (normally the session id), the host shuffles `options` (mcq, unless `shuffle: false`), the options of `fill-in-select` blanks (unless `shuffle: false`), `items` of `sort-items` (never left in the correct order), `prompts` and `matches` of `match-pairs` and `match-complex`, `events` of `timeline` (unless `shuffle: false`; never left in chronological order), the entries of `categorize` and the `labels` of `diagram-label` (unless `requireTyping`). OQSE answers refer to choice IDs, so shuffling never changes an answer. Every instance sees the same order.
2. **Public items.** In multiplayer, every instance except the authority gets the items without the fields that give the answer away and with `answerHidden: true`: `explanation`, `incorrectFeedback`, the `explanation` of every choice, `correctId`, `correctIds`, `correctAnswer(s)`, `correctOrder`, `pairs`, `connections`, `correctCells`, `correctCategoryId`, zone `correctLabelId` (and the labels when `requireTyping`), the accepted texts of `fill-in-blanks`, the `correctId` of select blanks, event `date`s, `hotspots` of pin items, `back` of a flashcard, `hiddenContent` of a note, `sampleAnswer`, `rubric` and the `quote` of every source (`sources[].quote`, which often states the answer). Custom `x-` types lose `solution` (OQSE puts everything that gives their answer away there), `explanation` and `incorrectFeedback`, and also get `answerHidden: true`. `hints` stay public: a game may show them on any device while the player answers. A host that sends the game to other devices sends only public items.
3. **Revealing.** The authority sends full items to the other instances in its own messages (the plugin SDK's `ctx.reveal`); the host does not take part.

Solo instances and the authority get the full items in display order.

---

## 5. Host API (plugin → host)

All methods return Promises and reject with a `ProtocolError` (section 8.2). Methods marked *authority* reject with `NOT_AUTHORITY` when called by another instance; methods limited to some views reject with `NOT_ALLOWED_IN_VIEW` elsewhere.

| Method | Description |
| :--- | :--- |
| `hello(handshake): InitPayload` | Handshake (section 4). Called exactly once per instance; a second call rejects with `INVALID_ARGUMENT`. |
| `ready(): void` | The plugin is rendered and interactive. |
| `send(message: OutgoingMessage): void` | Sends a game message to other instances (section 6). |
| `saveSnapshot(snapshot: unknown): void` | *authority.* Stores the latest resumable game state (overwrites the previous one). Returned as `InitPayload.snapshot` when the authority instance is recreated (reload, crash, reconnect). After `end(result)` the host discards the snapshot: a finished game is not resumed. |
| `recordAnswer(answer: AnswerRecord): void` | Records a learning result. The host applies its learning algorithm and stores the result in the learning progress of the given player (routing it to that player's device in multiplayer). |
| `saveData(scope: 'plugin' \| 'set', value: unknown): void` | *views `solo`, `controller`.* Replaces the plugin data of `self` in the given scope (section 5.2). |
| `updateSettings(update: { values: Record<string, unknown>; valid: boolean; message?: string }): void` | *view `settings`.* Replaces the settings values. The host validates them against the manifest schema; `valid: false` disables Start and shows `message`. |
| `getAsset(key: string, itemId?: string): Blob` | Raw data of an asset (resolution: item assets, then set assets). |
| `end(result: SessionResult): void` | *authority.* The game is over. The host shows/stores the result; instances stay open until the host closes them. Only the first call counts: later calls (also from a recreated authority) resolve and are ignored. |
| `reportError(error: { code: string; message: string; context?: object }): void` | Non-fatal error for logs and the Lab test report. Reports beyond the rate in section 8.1 are dropped without an error. |
| `service(name: string, payload: unknown): unknown` | Calls a Memizy service (section 5.3). Rejects with `SERVICE_UNAVAILABLE` unless the plugin declares it and `InitPayload.services` lists it. |

```ts
interface AnswerRecord {
  playerId?: string;          // default: self. The authority may record for any player.
  itemId: string;
  isCorrect: boolean;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
  answer?: unknown;           // what the player answered (checkAnswer format, choice IDs; max 4 KB)
  item?: { id: string; type: string; [key: string]: unknown };  // required for an item that is not in the set
}

interface SessionResult {
  scores?: Record<string, number>;    // final score per player ID (in solo: the single player)
  summary?: string;                   // short plain-text summary shown by the host
}
```

### 5.1 Learning progress

Plugins write it with **`recordAnswer`**: the plugin reports what happened ("player X answered item Y correctly"); the host decides the new bucket and review date with its own algorithm. A self-rating (a flashcard) is an answer too (OQSE Answer Formats). Writing progress records directly is reserved (`saveProgress`, section 10).

What `recordAnswer` carries besides the result:

* `answer` – what the player answered, in the format of the item type defined in [OQSE Answer Formats](../oqse/oqse.md#answer-formats) (the format `checkAnswer` takes: choice IDs, text, numbers; a flashcard's self-rating 1–4). Teachers see which wrong answers were chosen; because answers use IDs, the statistics survive edits of the set.
* **Generated items** (from a service or a generator in the plugin) are not in the set. The plugin attaches the item (`item`, at least `id` and `type`; answer fields may be left out; max 32 KB). The host counts such answers in statistics (per `skills` and `tags`) but not in the repetition schedule, because the item never comes back.
* Progress for teachers is aggregated per OQSE `skills` (and their parents, `chess.tactics` for `chess.tactics.fork`), which come from the content, never from the plugin. A game's own model of the player (rating, level, unlocked chapters) belongs to plugin data (section 5.2).

### 5.2 Plugin data

Game progress that only the plugin understands (unlocked levels, coins, best scores, a chosen avatar) MUST NOT be stored in the set (`customData`, `appSpecific`) – the set is shared content, not the state of a player. Plugins store it as **plugin data** instead:

* It belongs to **one user and one plugin** (identified by the manifest `id`). Two scopes:
  * `plugin` – across all sets (e.g., unlocked characters, total coins),
  * `set` – for this plugin and the current set (e.g., the level reached in this set).
* Each value is one JSON document, replaced as a whole by `saveData(scope, value)`. The current values are in `InitPayload.data`; `null` means nothing has been saved yet.
* Only the player's own instance (`solo`, `controller`) reads and writes it; the board and the settings view have none. In multiplayer every controller stores the data of its own player on its own device.
* The host stores it locally and MAY synchronize or back it up with the user's account. It does not interpret it. Users can in principle edit their own data; plugins must not treat it as tamper-proof.

### 5.3 Services

Services are what a set cannot contain: computations and data on Memizy's side, e.g. an AI chat, text-to-speech, a translation, a leaderboard across classes, or "a chess puzzle for my level" from a database. **Content stays in sets**; services are for everything that must be computed or fetched at play time.

* The plugin lists the services it uses in the manifest (`services`). The host offers some services; `InitPayload.services` lists those both sides have. The SDK exposes `ui.service(name, payload)`.
* Requests and results are JSON. Requests are at most 64 KB, results at most 256 KB; a host accepts at least 30 calls per minute and instance (`RATE_LIMITED` beyond).
* The host calls the service on behalf of the player (it knows the account, the class and the limits). The plugin never holds keys and the data does not leave Memizy, so no `permissions.network` is needed for services.
* Service names and their request/result schemas are not part of this protocol: they are listed in the Memizy service registry. A new service needs no protocol change.
* A service that returns study items returns OQSE items (e.g. `chess-puzzle`), so plugins render and check them like items of a set, and record answers to them as generated items (section 5.1).

---

## 6. Messages and Routing

Game data travels as **messages** through the host. In solo there is nobody else to talk to; the SDK runs the game locally.

```ts
interface OutgoingMessage {
  to: 'authority' | 'all' | Address[];  // 'all' = every other instance
  data: unknown;                        // JSON-serializable
}

interface IncomingMessage {
  from: Address;
  data: unknown;
  sentAt: number;                       // session clock (ms)
}
```

Guarantees:

* Messages from one sender to one recipient arrive **in order** and **at most once**.
* Messages to a disconnected instance are **dropped**. After reconnecting, the instance is a new iframe with a new `InitPayload` and must re-synchronize (the SDK asks the authority for the current state).
* The host does not interpret `data`. It validates the size and that the value is JSON.

### 6.1 Authority unavailable

If the authority instance loses its connection or is being recreated (e.g., the host who plays along loses Wi-Fi, the teacher reloads the board):

* The host calls `authorityChanged({ connected: false })` on all other instances and shows them a "Waiting for the host…" overlay. Messages sent `to: 'authority'` meanwhile are rejected with `AUTHORITY_UNAVAILABLE` (the SDK does not queue them).
* When the authority is back (resumed from its snapshot), the host calls `authorityChanged({ connected: true })`; the other instances re-synchronize with it.
* If the authority does not come back within a host-defined time, the host ends the session (`sessionEnded('host-left')`). Handing the game over to another player is a future feature (section 10).

---

## 7. Plugin API (host → plugin)

| Method | Description |
| :--- | :--- |
| `start(): void` | *authority only.* Begin the game (after the countdown in multiplayer, right after `ready()` in solo). Not called when resuming from a snapshot. |
| `deliver(message: IncomingMessage): void` | A game message from another instance. |
| `playersChanged(players: Player[]): void` | The roster changed (join, leave, rename, connection status). Always the full list. |
| `authorityChanged(status: { connected: boolean }): void` | The authority became unreachable / reachable again (section 6.1). Not called on the authority itself. |
| `configChanged(config: { locale, theme }): void` | Locale or theme changed. |
| `clockChanged(clock: SessionClock): void` | Clock synchronization updated, or the host paused / resumed the game. While `pausedAt` is set the SDK stops game time and timers, ignores actions and covers the game with a "paused" curtain. |
| `sessionEnded(reason: 'finished' \| 'host-left' \| 'kicked' \| 'closed' \| 'error'): void` | The host is closing this instance. |

---

## 8. Limits, Errors, Features, Security

### 8.1 Limits

The values are **guaranteed minimums**: a host MUST accept at least this much and MAY allow more. Plugins and the SDK MUST stay within them. To respect the message rate, the SDK sends state updates in batches (at most ~20 per second), so that many simultaneous actions (e.g., 40 players answering in the same second) do not exceed it.

| Limit | Guaranteed minimum | When exceeded |
| :--- | :--- | :--- |
| `send` message size (serialized JSON) | 64 KB | `MESSAGE_TOO_LARGE` |
| `send` rate per instance | 30 messages/s (burst 60); the authority: 30 messages/s **per other instance** (it sends each device its own view) | `RATE_LIMITED` |
| `saveSnapshot` size | 1 MB | `SNAPSHOT_TOO_LARGE` |
| `saveSnapshot` rate | 2 per second (the host keeps the latest) | coalesced, no error |
| `saveData` size per scope | 256 KB | `DATA_TOO_LARGE` |
| `saveData` rate | 1 per second per scope (the host keeps the latest) | coalesced, no error |
| `hello` deadline | 10 s after iframe load | the host shows an error |
| `recordAnswer` answer / generated item | 4 KB / 32 KB | `DATA_TOO_LARGE` |
| `recordAnswer` rate per instance | 10 per second (burst 20); the authority: 10 per second **per player** (it records for everyone) | `RATE_LIMITED` |
| `getAsset` size | 2 MB per asset | `DATA_TOO_LARGE` |
| `getAsset` rate per instance | 10 per second (burst 20) | `RATE_LIMITED` |
| `reportError` rate per instance | 5 per second (burst 10) | dropped, no error |
| `service` request / result | 64 KB / 256 KB | `MESSAGE_TOO_LARGE` |
| `service` rate per instance | 30 calls/min | `RATE_LIMITED` |

### 8.2 Errors

Rejected calls carry a `ProtocolError`:

```ts
interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;            // human-readable, for logs and the Lab report
}
```

| Code | Meaning |
| :--- | :--- |
| `UNSUPPORTED_PROTOCOL` | Incompatible MAJOR version (handshake). |
| `INVALID_ARGUMENT` | The call does not match the schema in `@memizy/protocol` (wrong type, unknown setting, non-JSON value…). |
| `NOT_AUTHORITY` | An *authority* method was called by another instance. |
| `NOT_ALLOWED_IN_VIEW` | The method is not available in this view (e.g. `saveData` on the board). |
| `AUTHORITY_UNAVAILABLE` | A message to the authority while it is unreachable (section 6.1). |
| `MESSAGE_TOO_LARGE`, `SNAPSHOT_TOO_LARGE`, `DATA_TOO_LARGE` | Size limits (section 8.1). |
| `RATE_LIMITED` | Message rate limit (section 8.1). |
| `ASSET_NOT_FOUND` | `getAsset` with an unknown key. |
| `SESSION_ENDED` | A call after `sessionEnded`. |
| `INTERNAL_ERROR` | A host-side failure; the plugin may retry. |
| `SERVICE_UNAVAILABLE` | The service is not declared by the plugin or not offered by this host. |
| `UNKNOWN_METHOD` | The other side does not have the method (an older or newer version). Methods added in 1.x are guarded by a feature (9), so a plugin sees this only by mistake. |

New codes may be added in minor versions; plugins MUST treat unknown codes like `INTERNAL_ERROR`.

### 8.3 Features

`Handshake.features` and `InitPayload.features` list optional capabilities. A side may only use a feature both sides list. v1.0 defines none; future examples: `teams`, `edit-set`.

### 8.4 Security

* The iframe is sandboxed with `allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox` – **never** `allow-same-origin` and never `allow-top-navigation`. Popups are allowed so that links open in a new tab (the plugin SDK opens every external link there; inside the iframe a link would replace the game). As a consequence, browser storage (`localStorage`, IndexedDB) is not available to plugins; they use plugin data (section 5.2).
* The host validates every incoming call against the schemas in `@memizy/protocol` and the limits above.
* The host never passes credentials, user e-mail or other private data. `Player.name` is the display name chosen for the session.
* Answers are known only to the authority (section 4.4). Everything else a plugin puts in the game state or in messages is visible to every instance: do not put secrets there.
* **Network.** The host puts a Content Security Policy into the plugin document (`pluginContentPolicy` in `@memizy/protocol`): scripts only inline, from the library CDNs (`cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`) and from the host; `fetch`, WebSocket and similar only to these and to the origins in `permissions.network`. Images and media may come from any `https:` URL (sets link them), so the policy blocks data channels but not every possible leak; hosts show the declared origins to users ("this game talks to lichess.org").
* **Devices.** The iframe `allow` attribute grants only `permissions.devices`; the browser still asks the user.

---

## 9. Compatibility Rules (what is frozen)

From `1.0` on, the following MUST NOT change in a backward-incompatible way within MAJOR `1`:

* method names, parameters and return types in sections 5 and 7,
* the shapes of `Handshake`, `InitPayload`, `Player`, `AnswerRecord`, `SessionResult`, `ProtocolError`, messages,
* the manifest schema in section 2,
* the semantics of views, authority, routing, learning progress and plugin data,
* the limits in section 8.1 may only grow.

Allowed in `1.x`: new optional fields, new methods guarded by a feature, new setting types, new enum values only where the receiver is required to ignore unknown values (`sessionEnded` reasons, error codes, `Player` fields).

* The plugin SDK sends its own game messages inside `send` / `deliver` (actions, state and state patches, reveals). Their format is part of the SDK's contract: within SDK 1.x it only changes additively, because the devices of one game may run different 1.x versions (a cached copy). Receivers ignore message types and fields they do not know. State patches carry the version of their format (`f`, today `1`: the patches of mutative 2); a receiver that does not know the format asks for the full state instead of applying them, so the patch format can change within 1.x.
* **Reserved names** (so that a game never collides with a later SDK): action names and timer keys starting with `$` (the SDK rejects them in a game); HTML attributes starting with `data-mz-` (new SDK attributes use this prefix; the existing `data-act`, `data-local`, `data-payload`, `data-setting`, `data-keep`, `data-key` stay); CSS classes starting with `mz-`. Fields the SDK keeps in the game state exist only on request: today `phase`, `phaseSeq` and `phaseEndsAt`, only in games with `phases`. Any later field of the SDK will also be opt-in (a new option of the game definition), never added to the state of an existing game.
* The public API of `@memizy/protocol` is what its entry point exports; `@memizy/protocol/internal` (helpers shared by the Memizy packages) is not covered by these rules. Exported Zod schemas are Zod 4 schemas: the 1.x packages stay on Zod 4.
* Libraries inside the SDK and the host SDK (sanitizer, Markdown parser…) may be updated in any 1.x release, including security fixes; only the wire formats above are fixed.
* Plugins load the SDK as `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1` (the self-contained bundle of the package): every 1.x release reaches them without a change of the plugin.

---

## 10. Decisions and Planned Extensions

What was decided and why, and what is **reserved** (name and intent fixed, not implemented yet, so that later work does not collide).

**Decided**

1. **Graded tests and assignments are not plugins.** Whoever runs the rules can change them, and in a homework a plugin runs on the student's device. Graded work lives in the platform, which checks answers on the server (the public items of section 4.4 make that possible). Plugins are for learning through play and for practice, where cheating only hurts the cheater.
2. **Content is sets, computation is services.** Sets hold what can be prepared in advance; services (section 5.3) compute or fetch at play time. Memizy services go through `service()`; third parties through `permissions.network`.
3. **Shared data of a class is a service**, not a new data scope: every write is a request the server can validate (a plugin on a student's device is not trusted).
4. **"Always new" exercises come from generators** that return ordinary OQSE items (in the plugin with `ctx.random()`, or as a service with a database or AI behind it). Everything else – rendering, `checkAnswer`, recording – works the same; answers are recorded as generated items.
5. **Progress for teachers** = `recordAnswer` + OQSE `skills` from the content (hierarchical IDs from a shared vocabulary); a game's own model of the player stays in plugin data.
6. **Choices have IDs** (OQSE): answers and statistics survive edits of a set; the host shuffles freely.
7. **`playerView`** (per-player views of the state) is an optional SDK feature, not a protocol requirement: games without secrets need nothing.

**Reserved**

| Name | Intent |
| :--- | :--- |
| Address `"server"` | Server authority: official games run their rules on a server (graded homework, larger games). The display order and public items of section 4.4 already work the same there. |
| Item field `generated: { by, seed }` | Where a generated item comes from (service or generator) and how to recreate it. |
| Host method `uploadAsset` | Files created by players (drawings, photos) stored by the host and referenced like set assets. |
| Feature `edit-set` | Tools that create or change a set from inside a plugin. |
| `Player.active` | Whether the player's app is in the foreground (for supervised tests in the platform). |
| Plugin data summary | A short, human-readable summary of a game's own progress (e.g. "Elo 1450") that hosts may show to teachers. |
| Feature `teams` | Teams managed by the host (today every game handles teams itself). |
| Hot-seat | Several players sharing one device; v1 assumes one player per instance. |
| Host migration | Moving the authority to another device when its device is gone for good; v1 resumes the same authority from the snapshot. |
| Host method `exit` | Leaving the game from inside it: a "back to the menu" button of a full-screen game; the host closes the game or returns to its menu. |
| Host method `resize` | Auto height for games embedded in articles and course pages: the game reports the height of its content, the host sizes the frame (switched on in the manifest; the SDK measures it). |
| Plugin method `setChanged` | Live set editing: the host updates the set of a running game, e.g. when the author edits it in the Lab. |
| Host method `saveProgress` | Writing learning progress directly, e.g. a placement test ("these items are known"); the host may refuse or limit it. |
| Feature `replay` | Recording a game and replaying it: the host keeps the session's inputs (the `InitPayload` with the seed and the display order, every action with its sender and game time, pauses) and replays the game by running the same plugin version on them. This works because the rules are deterministic (`ctx.random`, `ctx.now`, no `Math.random` / `Date.now` in actions); keep that rule. |

---

## Changelog

* **1.0 (unreleased):** the term *host* (3.1): the application that embeds the plugin on a device, also on a player's device; the host ends a player's instance with `sessionEnded` (also `kicked`, `host-left`) before removing it. Removed before 1.0 and reserved (10): `exit`, `resize`, `setChanged`, `saveProgress` (a self-rating is an answer). `InitPayload.services` and the pause fields of `SessionClock` are always present; `sessionEnded` reason `host-left` (was `host_left`); `SETTINGS_ADDRESS` is defined here; the relay type of a room player is `RoomPlayer`. State patches carry their format (`f`); reserved names `$…`, `data-mz-…`, `mz-…` and opt-in state fields; `@memizy/protocol/internal`; Zod 4 (9). Renamed before 1.0: `ui.renderNote` → `ui.note` (SDK), the type `Theme` → `HostConfig`. Player names and personal data: plugins MUST NOT ask for real names or other personal data (3.3); `setChanged` is optional for hosts (7); `replay` reserved (10). The sandbox allows popups that escape it, links open in a new tab (8.4). Error code `UNKNOWN_METHOD` (8.2). Continuing a saved game is described (3.3; host feature, no protocol change). After `end(result)` the host discards the snapshot (5). The transport (Penpal 8), the SDK message format and the protocol declaration of plugins using 1.x additions are fixed rules (4, 4.3, 9); plugins load the SDK from `…/plugin-sdk@1`. `appSpecific.memizy.set` (`required` / `optional` / `none`): games without questions; OQSEM `capabilities` and `actions` may be omitted. Public items (4.4) also lose `sources[].quote`; custom `x-` items lose `solution`, `explanation` and `incorrectFeedback` and get `answerHidden: true` (they were passed unchanged); `hints` stay public. `recordAnswer.answer` follows OQSE Answer Formats (a flashcard answer is a self-rating 1–4; `ui.question` offers four ratings). OQSE 1.0 sets and OQSEM 1.0 manifests (`"version": "1.0"`; other MAJOR versions are not read as 1.x). A host may support several protocol MAJOR versions at once (4.3); supporting older ones is a SHOULD instead of a MUST. Final rules: a second `hello` of an instance rejects with `INVALID_ARGUMENT`, only the first `end(result)` counts (5); guaranteed rates of `recordAnswer` (per player for the authority), `getAsset` and `reportError` (dropped beyond it) and an asset size of 2 MB (8.1); the address `"settings"` (3.1).
* **RC1 (2026-10-04):** first release candidate.
* **RC2 (2026-10-06):** `SettingDefinition.modes`; the host may show solo settings before the start (section 3.3). Additive: RC1 plugins and hosts keep working.
* **RC4 (2026-10-07):** OQSE 0.3 sets (choices with IDs; the RC3 `correctOrder` / `correctMatches` display fields are gone because answers refer to IDs); `recordAnswer.answer` and generated items (5.1); services (5.3, `service`, `InitPayload.services`, `SERVICE_UNAVAILABLE`); pauses (`SessionClock`); `permissions` with a Content Security Policy and device grants (8.4); decisions and reservations (section 10). Additive for the protocol except the OQSE version: plugins must read choices (`option.text`, `option.id`).
* **RC3 (2026-10-06):** display order and public items (section 4.4). Not fully additive: a plugin that read answers on a player's device in multiplayer must now reveal them first (`ctx.reveal` in the SDK). Answers by index refer to the delivered lists; `checkAnswer` handles `correctOrder` / `correctMatches`, so plugins that shuffled locally and sent the indices of the delivered lists keep working.
