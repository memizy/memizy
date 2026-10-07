# Memizy Plugin Protocol v1

> Status: **Release Candidate 3** (2026-10-06) · Final `1.0` after the acceptance test with AI-generated plugins (planned 2026-10-19/20).
>
> RC rules: the design does not change unless the implementation or the acceptance test proves that something does not work. Every change until `1.0` is recorded in the changelog at the end.

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
  "version": "0.2",
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
| `modes` | object | Yes | At least one of `solo`, `multiplayer`. |
| `modes.solo` | object | No | Present = the plugin supports single-player. Empty object for now. |
| `modes.multiplayer.players` | `{min, max, recommended?}` | Yes (in multiplayer) | Player count limits (players, not counting a presenter). `1 ≤ min ≤ max ≤ 200`; `recommended` is a hint for the lobby. |
| `modes.multiplayer.hostAs` | string[] | Yes (in multiplayer) | How the host may take part: `"presenter"` (host shows a shared board and does not play) and/or `"player"` (host plays like everyone else, no board). |
| `modes.multiplayer.lateJoin` | boolean | No | Players may join a running game. Default `true`. |
| `settings` | SettingDefinition[] | No | Settings of the game (see below). Default `[]`. They define types, defaults and limits; the host validates every value against them. Used in both modes (section 3.3). |
| `settingsScreen` | `{ size }` | No | Multiplayer lobby only. Present = the plugin renders its own settings screen (view `settings`) on the host's device; absent = the host generates a form from `settings`. `size: "compact"` – a panel next to the player list (the user may expand it to full screen); `size: "large"` – opened as a full-screen dialog from a "Game settings" button. |
| `display.orientation` | `"any"` \| `"portrait"` \| `"landscape"` | No | Preferred orientation of player screens. Default `"any"`. |

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
| **Session** | One run of a game, from start to end (e.g., one quiz in a lesson). |
| **Mode** | `solo` (one person plays alone) or `multiplayer` (several devices together). |
| **Host role** (`hostAs`) | In multiplayer, the role of the person who created the session: `presenter` (shows a shared board, e.g. a teacher at a projector, and does not play) or `player` (plays like everyone else, no board). A plugin may support both; the host chooses in the lobby. |
| **Instance** | One running plugin iframe on one device. 30 phones + 1 projector = 31 instances. |
| **View** | What one instance shows: `solo`, `board` (the presenter's shared screen), `controller` (one player's own screen – a phone, tablet or computer) or `settings` (the plugin's settings screen on the host's device in the multiplayer lobby). Views are derived from the manifest (section 3.2), not declared separately. |
| **Player** | A person who plays and can score. The presenter is not a player. |
| **Address** | The "envelope address" of an instance, used to route messages (section 6): the player ID for a player's instance (stable across reconnects), `"board"` for the presenter's board. The address `"server"` is **reserved** for a future server-side authority. Plugin authors never see addresses; the SDK exposes only player IDs. |
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

1. **Lobby** (host UI). The host chooses the plugin and the set; players join and may rename themselves. The settings are edited by the host: either in a form generated from `settings`, or – if the manifest declares `settingsScreen` – in the plugin itself running in view `settings` on the host's device (the plugin calls `updateSettings` and receives `playersChanged`). Start is enabled only while the settings are valid.
2. **Loading.** After Start, the host creates the game instances (board and/or controllers). Each instance connects, receives its `InitPayload` (without game state) and calls `ready()`.
3. **Countdown.** When all connected instances are ready (or after a host-defined timeout, e.g. 15 s), the host shows a countdown and then calls `start()` on the authority. The authority creates the initial state and the game runs. The barrier exists so that timed games do not start before slower devices have loaded.
4. **Running.** Late joiners (if `lateJoin`) and reconnecting players get a new instance, which synchronizes with the authority. A recreated authority receives the last `snapshot` and continues without `start()`. While the authority is unreachable, see section 6.1.
5. **End.** The authority calls `end(result)`; the host shows results and finally closes the instances with `sessionEnded`.

**Solo:** one instance in view `solo`. There is **no plugin settings screen and no countdown**. Before creating the instance, the host MAY show a form generated from the settings that apply to solo (`modes`); otherwise it uses the defaults or values it presets (e.g. a course step "practise this set with 10 questions"). It calls `start()` right after `ready()`. Choices that belong to the game itself (a level, a character) are made inside the game, typically as its first phase.

---

## 4. Handshake

The connection uses [Penpal](https://github.com/Aaronius/penpal) over `postMessage`. The iframe is sandboxed **without** `allow-same-origin` (opaque origin), therefore the plugin connects with `allowedOrigins: ['*']`; Penpal still verifies that messages come from the expected window.

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
  oqseVersion: string;                  // "0.2"
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
  clock: { offsetMs: number };          // add to Date.now() to get the session clock
  progress: Record<string, ProgressRecord>;  // learning progress of `self` (empty for board/settings)
  data: { plugin: unknown; set: unknown };   // plugin data of `self` (null when nothing saved; null for board/settings)
  snapshot: unknown | null;             // last saved snapshot, only for the authority (resume)
}

type Address = string;                  // player ID, "board"; "server" is reserved

interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}
```

**Assets:** every `MediaObject.value` in `set` is either an absolute `https:` URL, or a host-relative key that the SDK resolves with `getAsset` (section 5). The host never passes `blob:` URLs, because an opaque-origin iframe cannot load the host's blob URLs.

### 4.3 Version negotiation

* The MAJOR versions must match. Otherwise the host rejects with `ProtocolError { code: 'UNSUPPORTED_PROTOCOL' }` and shows the user a clear message ("this plugin needs a newer Memizy" or "this plugin is too old").
* The negotiated MINOR is the lower of both. Neither side uses a method, field or feature introduced in a higher minor than the negotiated one.
* `manifest.appSpecific.memizy.protocol` is checked **before** loading the iframe (the host does not offer plugins it cannot run).
* A host implementing `2.x` MUST keep supporting plugins speaking `1.x` (adapter in `@memizy/host-sdk`).

### 4.4 Display order and hidden answers

The host prepares the set once per session (`prepareDisplaySet` in `@memizy/protocol`; a future server authority does the same):

1. **Display order.** With a seed (normally the session id), the host shuffles `options` (mcq, unless `shuffle: false`), the options of `fill-in-select` blanks (unless `shuffle: false`), `items` of `sort-items` (never left in the correct order), `prompts` and `matches` of `match-pairs`, the sides of `match-complex`, `events` of `timeline` (unless `shuffle: false`; never left in chronological order), the entries of `categorize` and the `labels` of `diagram-label` (unless `requireTyping`). OQSE 0.3 answers refer to choice IDs, so shuffling never changes an answer. Every instance sees the same order.
2. **Public items.** In multiplayer, every instance except the authority gets the items without the fields that give the answer away and with `answerHidden: true`: `explanation`, `incorrectFeedback`, the `explanation` of every choice, `correctId`, `correctIds`, `correctAnswer(s)`, `alternativeAnswers`, `range`, `correctOrder`, `pairs`, `connections`, `correctCells`, `correctCategoryId`, zone `correctLabelId` (and the labels when `requireTyping`), the accepted texts of `fill-in-blanks`, the `correctId` of select blanks, event `date`s, `hotspots` of pin items, `back` of a flashcard, `hiddenContent` of a note, `sampleAnswer` and `rubric`. Custom `x-` types are passed unchanged. In relay multiplayer the bundle on the server holds only public items.
3. **Revealing.** The authority sends full items to the other instances in its own messages (the plugin SDK's `ctx.reveal`); the host does not take part.

Solo instances and the authority get the full items in display order.

---

## 5. Host API (plugin → host)

All methods return Promises and reject with a `ProtocolError` (section 8.2). Methods marked *authority* reject with `NOT_AUTHORITY` when called by another instance; methods limited to some views reject with `NOT_ALLOWED_IN_VIEW` elsewhere.

| Method | Description |
| :--- | :--- |
| `hello(handshake): InitPayload` | Handshake (section 4). Called exactly once. |
| `ready(): void` | The plugin is rendered and interactive. |
| `send(message: OutgoingMessage): void` | Sends a game message to other instances (section 6). |
| `saveSnapshot(snapshot: unknown): void` | *authority.* Stores the latest resumable game state (overwrites the previous one). Returned as `InitPayload.snapshot` when the authority instance is recreated (reload, crash, reconnect). |
| `recordAnswer(answer: AnswerRecord): void` | Records a learning result. The host applies its learning algorithm and stores the result in the learning progress of the given player (routing it to that player's device in multiplayer). |
| `saveProgress(records: Record<string, ProgressRecord>): void` | *views `solo`, `controller`.* Overwrites learning progress records of `self` directly (plugins with their own rating, e.g. "traffic light" self-rating). |
| `saveData(scope: 'plugin' \| 'set', value: unknown): void` | *views `solo`, `controller`.* Replaces the plugin data of `self` in the given scope (section 5.2). |
| `updateSettings(update: { values: Record<string, unknown>; valid: boolean; message?: string }): void` | *view `settings`.* Replaces the settings values. The host validates them against the manifest schema; `valid: false` disables Start and shows `message`. |
| `getAsset(key: string, itemId?: string): Blob` | Raw data of an asset (resolution: item assets, then set assets). |
| `end(result: SessionResult): void` | *authority.* The game is over. The host shows/stores the result; instances stay open until the host closes them. |
| `resize(request: { height: number \| 'auto' }): void` | Requests a different iframe height (embedded layouts). |
| `reportError(error: { code: string; message: string; context?: object }): void` | Non-fatal error for logs and the Lab test report. |
| `exit(): void` | The user wants to leave (e.g. a "Close" button inside the plugin). |

```ts
interface AnswerRecord {
  playerId?: string;          // default: self. The authority may record for any player.
  itemId: string;
  isCorrect: boolean;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
}

interface SessionResult {
  scores?: Record<string, number>;    // final score per player ID (in solo: the single player)
  summary?: string;                   // short plain-text summary shown by the host
}
```

### 5.1 Learning progress

Two ways to write it:

* **`recordAnswer`** – the plugin reports what happened ("player X answered item Y correctly"). The host decides the new bucket and review date with its own algorithm. This is what most plugins use, in solo and in multiplayer.
* **`saveProgress`** – the plugin writes records of its own player directly (e.g., self-rating sets bucket 3). Only for `self`, never for other players.

### 5.2 Plugin data

Game progress that only the plugin understands (unlocked levels, coins, best scores, a chosen avatar) MUST NOT be stored in the set (`customData`, `appSpecific`) – the set is shared content, not the state of a player. Plugins store it as **plugin data** instead:

* It belongs to **one user and one plugin** (identified by the manifest `id`). Two scopes:
  * `plugin` – across all sets (e.g., unlocked characters, total coins),
  * `set` – for this plugin and the current set (e.g., the level reached in this set).
* Each value is one JSON document, replaced as a whole by `saveData(scope, value)`. The current values are in `InitPayload.data`; `null` means nothing has been saved yet.
* Only the player's own instance (`solo`, `controller`) reads and writes it; the board and the settings view have none. In multiplayer every controller stores the data of its own player on its own device.
* The host stores it locally and MAY synchronize or back it up with the user's account. It does not interpret it. Users can in principle edit their own data; plugins must not treat it as tamper-proof.

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
* If the authority does not come back within a host-defined time, the host ends the session (`sessionEnded('host_left')`). Handing the game over to another player is a future feature (section 10).

---

## 7. Plugin API (host → plugin)

| Method | Description |
| :--- | :--- |
| `start(): void` | *authority only.* Begin the game (after the countdown in multiplayer, right after `ready()` in solo). Not called when resuming from a snapshot. |
| `deliver(message: IncomingMessage): void` | A game message from another instance. |
| `playersChanged(players: Player[]): void` | The roster changed (join, leave, rename, connection status). Always the full list. |
| `authorityChanged(status: { connected: boolean }): void` | The authority became unreachable / reachable again (section 6.1). Not called on the authority itself. |
| `setChanged(set: { meta, items }): void` | The set was edited in the host while the plugin runs (solo only). |
| `configChanged(config: { locale, theme }): void` | Locale or theme changed. |
| `clockChanged(clock: { offsetMs }): void` | Clock synchronization updated. |
| `sessionEnded(reason: 'finished' \| 'host_left' \| 'kicked' \| 'closed' \| 'error'): void` | The host is closing this instance. |

---

## 8. Limits, Errors, Features, Security

### 8.1 Limits

The values are **guaranteed minimums**: a host MUST accept at least this much and MAY allow more. Plugins and the SDK MUST stay within them. To respect the message rate, the SDK sends state updates in batches (at most ~20 per second), so that many simultaneous actions (e.g., 40 players answering in the same second) do not exceed it.

| Limit | Guaranteed minimum | When exceeded |
| :--- | :--- | :--- |
| `send` message size (serialized JSON) | 64 KB | `MESSAGE_TOO_LARGE` |
| `send` rate per instance | 30 messages/s (burst 60) | `RATE_LIMITED` |
| `saveSnapshot` size | 1 MB | `SNAPSHOT_TOO_LARGE` |
| `saveSnapshot` rate | 2 per second (the host keeps the latest) | coalesced, no error |
| `saveData` size per scope | 256 KB | `DATA_TOO_LARGE` |
| `saveData` rate | 1 per second per scope (the host keeps the latest) | coalesced, no error |
| `hello` deadline | 10 s after iframe load | the host shows an error |

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

New codes may be added in minor versions; plugins MUST treat unknown codes like `INTERNAL_ERROR`.

### 8.3 Features

`Handshake.features` and `InitPayload.features` list optional capabilities. A side may only use a feature both sides list. v1.0 defines none; future examples: `teams`, `edit-set`.

### 8.4 Security

* The iframe is sandboxed with `allow-scripts allow-forms allow-modals allow-pointer-lock` – **never** `allow-same-origin`. As a consequence, browser storage (`localStorage`, IndexedDB) is not available to plugins; they use plugin data (section 5.2).
* The host validates every incoming call against the schemas in `@memizy/protocol` and the limits above.
* The host never passes credentials, user e-mail or other private data. `Player.name` is the display name chosen for the session.
* Answers are known only to the authority (section 4.4). Everything else a plugin puts in the game state or in messages is visible to every instance: do not put secrets there.

---

## 9. Compatibility Rules (what is frozen)

From `1.0` on, the following MUST NOT change in a backward-incompatible way within MAJOR `1`:

* method names, parameters and return types in sections 5 and 7,
* the shapes of `Handshake`, `InitPayload`, `Player`, `AnswerRecord`, `SessionResult`, `ProtocolError`, messages,
* the manifest schema in section 2,
* the semantics of views, authority, routing, learning progress and plugin data,
* the limits in section 8.1 may only grow.

Allowed in `1.x`: new optional fields, new methods guarded by a feature, new setting types, new enum values only where the receiver is required to ignore unknown values (`sessionEnded` reasons, error codes, `Player` fields).

---

## 10. Open Questions and Future Ideas

1. **Teams** – postponed (`teams` feature).
2. ~~Answer redaction for controllers~~ – done in RC3 (section 4.4).
3. **Host migration** when the authority's device disappears for good – v1 only resumes the same authority from the snapshot.
4. **Editing the set from a plugin** – postponed (`edit-set` feature).
5. **Hot-seat** (several players sharing one device, e.g. taking turns at one computer) – an idea to consider; v1 assumes one player per instance.
6. **Server authority** (authoritative mode for whitelisted official games) – the address `"server"` is reserved for it.

---

## Changelog

* **RC1 (2026-10-04):** first release candidate.
* **RC2 (2026-10-06):** `SettingDefinition.modes`; the host may show solo settings before the start (section 3.3). Additive: RC1 plugins and hosts keep working.
* **RC3 (2026-10-06):** display order and public items (section 4.4). Not fully additive: a plugin that read answers on a player's device in multiplayer must now reveal them first (`ctx.reveal` in the SDK). Answers by index refer to the delivered lists; `checkAnswer` handles `correctOrder` / `correctMatches`, so plugins that shuffled locally and sent the indices of the delivered lists keep working.
