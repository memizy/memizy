# Memizy Plugin Protocol v1 (DRAFT)

> Status: **draft for review** · Target freeze: 2026-10-10

This document defines the contract between a **Memizy plugin** (an HTML page running in a sandboxed iframe) and a **Memizy host** (the Memizy app, the Plugin Lab, or any other application embedding plugins through `@memizy/host-sdk`).

It covers:

1. the **plugin manifest** (what the plugin declares statically),
2. the **handshake** and version negotiation,
3. the **RPC methods** in both directions,
4. **message routing** for multiplayer,
5. **limits, security and compatibility rules**.

It does **not** cover the high-level game API (`defineGame`) – that lives in `@memizy/plugin-sdk`, which every plugin bundles. The SDK can evolve freely as long as it speaks this protocol. It also does not cover the host ↔ multiplayer-server wire protocol, which is internal to `@memizy/host-sdk`.

Data formats (sets, items, progress) are defined by [OQSE](../oqse/oqse.md).

---

## 1. Design Principles

* **Small surface.** Everything a plugin needs is built in the SDK on top of a few generic primitives (messages, snapshot, progress). Only these primitives are frozen.
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
| `settings` | SettingDefinition[] | No | Settings of the game (see below). Default `[]`. They define types, defaults and limits; the host validates every value against them. |
| `settingsScreen` | boolean | No | `true` = the plugin renders its own settings screen (view `settings`) on the host's device in the lobby. `false` = the host generates a form from `settings`. Default `false`. |
| `display.orientation` | `"any"` \| `"portrait"` \| `"landscape"` | No | Preferred orientation of player screens. Default `"any"`. |

**SettingDefinition:** `{ id, type, label, default, description?, ...typeSpecific }`

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

| Term | Meaning |
| :--- | :--- |
| **Mode** | `solo` or `multiplayer`. |
| **Host role** | In multiplayer: `presenter` or `player` (from `hostAs`, chosen in the lobby). |
| **View** | What one plugin instance shows: `solo`, `board` (shared screen of the presenter), `controller` (a player's device) or `settings` (the plugin's settings screen on the host's device in the lobby). |
| **Address** | Identifies a plugin instance in a session: a player ID, or `"board"` for the presenter's screen. |
| **Authority** | The one instance that owns the game state. `presenter` → the board; host as `player` → the host player's controller; `solo` → the only instance. |

| Situation | Instances (views) | Authority |
| :--- | :--- | :--- |
| Solo | 1 × `solo` | itself |
| Multiplayer, host as presenter | 1 × `board` + N × `controller` | `board` |
| Multiplayer, host as player | N × `controller` (host is one of them) | host's controller |

### 3.1 Lifecycle (multiplayer)

1. **Lobby** (host UI). The host chooses the plugin and the set; players join and may rename themselves. If the manifest declares `settingsScreen: true`, the host's device runs the plugin in view `settings`: the plugin edits the settings with `updateSettings` and receives `playersChanged`. Start is enabled only while the settings are valid.
2. **Loading.** After Start, the host creates the game instances (board and/or controllers). Each instance connects, receives its `InitPayload` (without game state) and calls `ready()`.
3. **Countdown.** When all connected instances are ready (or after a host-defined timeout, e.g. 15 s), the host shows a countdown and then calls `start()` on the authority. The authority creates the initial state and the game runs.
4. **Running.** Late joiners (if `lateJoin`) and reconnecting players get a new instance, which synchronizes with the authority. A recreated authority receives the last `snapshot` and continues without `start()`.
5. **End.** The authority calls `end(result)`; the host shows results and finally closes the instances with `sessionEnded`.

In solo, steps 1 and 3 collapse: the host calls `start()` right after `ready()` (or the generated/custom settings are shown first, as in the lobby).

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
  features: string[];                   // optional capabilities of the SDK, see 8.2
}
```

### 4.2 `InitPayload` (host → plugin)

```ts
interface InitPayload {
  protocol: string;                     // negotiated version: same MAJOR, MIN of the MINORs
  host: { name: string; version: string };
  oqseVersion: string;                  // "0.2"
  features: string[];                   // host features, see 8.2

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
    items: OQSEAnyItem[];               // only types the plugin declared; loaded with loadOQSEFile
  };
  settings: Record<string, unknown>;    // current values for every declared setting (defaults applied)
  config: { locale: string; theme: 'light' | 'dark' };
  clock: { offsetMs: number };          // add to Date.now() to get the session clock
  progress: Record<string, ProgressRecord>;  // learning progress of `self` (empty for the board)
  snapshot: unknown | null;             // last saved snapshot, only for the authority (resume)
}

type Address = string;                  // player ID or "board"

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

---

## 5. Host API (plugin → host)

All methods return Promises. Methods marked *authority* reject with `ProtocolError { code: 'NOT_AUTHORITY' }` when called by another instance.

| Method | Description |
| :--- | :--- |
| `hello(handshake): InitPayload` | Handshake (section 4). Called exactly once. |
| `ready(): void` | The plugin is rendered and interactive. |
| `send(message: OutgoingMessage): void` | Sends a game message to other instances (section 6). |
| `saveSnapshot(snapshot: unknown): void` | *authority.* Stores the latest resumable game state (overwrites the previous one). Returned as `InitPayload.snapshot` when the authority instance is recreated (reload, crash, reconnect). |
| `recordAnswer(answer: AnswerRecord): void` | Records a learning result. The host applies its learning algorithm and stores the result in the progress of the given player (routing it to that player's device in multiplayer). |
| `saveProgress(records: Record<string, ProgressRecord>): void` | Overwrites progress records of `self` directly (advanced plugins with their own scheduling, e.g. "traffic light" self-rating). Not available to the board. |
| `updateSettings(update: { values: Record<string, unknown>; valid: boolean; message?: string }): void` | *view `settings` only.* Replaces the settings values. The host validates them against the manifest schema; `valid: false` disables Start and shows `message`. |
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

---

## 7. Plugin API (host → plugin)

| Method | Description |
| :--- | :--- |
| `start(): void` | *authority only.* Begin the game (after the countdown). Not called when resuming from a snapshot. |
| `deliver(message: IncomingMessage): void` | A game message from another instance. |
| `playersChanged(players: Player[]): void` | The roster changed (join, leave, rename, connection status). Always the full list. |
| `setChanged(set: { meta, items }): void` | The set was edited in the host while the plugin runs (solo only). |
| `configChanged(config: { locale, theme }): void` | Locale or theme changed. |
| `clockChanged(clock: { offsetMs }): void` | Clock synchronization updated. |
| `sessionEnded(reason: 'finished' \| 'host_left' \| 'kicked' \| 'closed' \| 'error'): void` | The host is closing this instance. |

---

## 8. Limits, Security, Features

### 8.1 Limits

| Limit | Value | When exceeded |
| :--- | :--- | :--- |
| `send` message size (serialized JSON) | 64 KB | rejected (`MESSAGE_TOO_LARGE`) |
| `send` rate per instance | 30 messages/s (burst 60) | rejected (`RATE_LIMITED`) |
| `saveSnapshot` size | 1 MB | rejected (`SNAPSHOT_TOO_LARGE`) |
| `saveSnapshot` rate | 2 per second (the host keeps the latest) | coalesced |
| `hello` deadline | 10 s after iframe load | the host shows an error |

### 8.2 Features

`Handshake.features` and `InitPayload.features` list optional capabilities. A side may only use a feature both sides list. v1.0 defines none; future examples: `teams`, `edit-set`.

### 8.3 Security

* The iframe is sandboxed with `allow-scripts allow-forms allow-modals allow-pointer-lock` – **never** `allow-same-origin`.
* The host validates every incoming call against the schemas in `@memizy/protocol` and the limits above.
* The host never passes credentials, user e-mail or other private data. `Player.name` is the display name chosen for the session.
* Plugins MUST NOT rely on hiding information from players: in relay multiplayer every controller receives the set. (Answer redaction for controllers may become a feature later.)

---

## 9. Compatibility Rules (what is frozen)

From `1.0` on, the following MUST NOT change in a backward-incompatible way within MAJOR `1`:

* method names, parameters and return types in sections 5 and 7,
* the shapes of `Handshake`, `InitPayload`, `Player`, `AnswerRecord`, `SessionResult`, messages,
* the manifest schema in section 2,
* the semantics of views, authority and routing.

Allowed in `1.x`: new optional fields, new methods guarded by a feature, new setting types, new enum values only where the receiver is required to ignore unknown values (`sessionEnded` reasons, `Player` fields).

---

## 10. Open Questions

1. **Teams** – postponed (`teams` feature).
2. **Answer redaction for controllers** (anti-cheating) – postponed.
3. **Host migration** when the authority's device disappears for good – v1 only resumes the same authority from the snapshot.
4. **Editing the set from a plugin** – postponed (`edit-set` feature).
