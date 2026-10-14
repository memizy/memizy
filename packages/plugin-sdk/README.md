# @memizy/plugin-sdk

Build **Memizy learning games** – solo and multiplayer – in a single HTML file.

```html
<script type="module">
  import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1';

  defineGame({
    root: document.getElementById('app'),
    initialState: (ctx) => ({ round: 0, scores: {} }),
    actions: {
      answer(state, payload, ctx) { /* change the state */ },
    },
    render: (state, ui) => `<button data-act="answer" data-payload='{"answer":1}'>B</button>`,
  });
</script>
```

* **Guide** (also meant to be pasted into an AI assistant): [docs/ai-plugin-guide.md](../../docs/ai-plugin-guide.md)
* **Protocol** between plugins and hosts: [@memizy/protocol](../protocol/SPEC.md)

The SDK handles the connection to Memizy, synchronization between devices (board and players), late joining and reconnecting, timers, safe rendering of Markdown/LaTeX/Mermaid, answer checking (`checkAnswer`), learning progress and saved game data.

Opened directly in a browser (without Memizy), a plugin runs in **standalone preview** mode: solo with sample questions. Multiplayer is tested in the Memizy Plugin Lab.

Version 1.0 is a release candidate; the API follows the guide and stays backward compatible within `1.x`.

## Changelog

* **1.0.0 (after 1.0.0-rc.5):**
  * Renamed `ui.renderNote` → `ui.note` (no alias; nothing used it).
  * State patches carry their format (`f: 1`); a device that does not know the format asks for the full state.
  * Names starting with `$` (actions, timer keys) are reserved for the SDK; `defineGame` and `ctx.after` / `ctx.cancel` reject them.
  * Links open in a new tab; the SDK can be imported without a DOM (Node).
* **Unreleased (after 1.0.0-rc.4):**
  * `ui.question(item, { counts })` – how many players chose each option, as a badge on the option (choice types).
  * Timed phases re-render on their own (the `ui.timeLeft()` countdown runs without `tickMs`; `tickMs` stays for own animations).
  * `data-local="name"` + `defineGame({ local: { name(local, payload, ui) { … } } })` – device-only clicks (tabs, a 2D/3D switch) that change `ui.local` and re-render.
  * `createScene3d`: a black or slow scene switches to 2D at most once per page (the player's return to 3D is respected); `onFallback(reason, { kind })`; a game without `onFallback` stays 3D and shows a message only when 3D cannot run at all.
  * No zoom on phones: the SDK locks the viewport, stops pinch gestures and double-tap zoom and keeps text fields at least 16 px on touch screens (iOS zooms into smaller fields).
  * Removed `ui.escape` – `ui.html` escapes.
  * Late actions: an action carries the `phaseSeq` the player saw; in games with phases the authority ignores actions from the screen of an older phase (late answers, double clicks), and still confirms them.
  * `ctx.actedAt`: the time of the tap (limited to 400 ms before the arrival) for points by speed.
  * `ctx.goto` takes effect immediately (the rest of the action sees the new phase; `onEnter` runs at once as the system). `playerView` gets `phase`, `phaseSeq`, `phaseEndsAt` copied (reserved fields).
  * `ctx.hide` does nothing for items that were not revealed.
  * `ui.question`: `itemId` in every answer payload; a sent answer is shown as chosen (and locked) until the authority confirms it; stable styling hooks `data-type`, `data-option`, `--mz-q-index`; a warning (`REVEAL_WITHOUT_ANSWER`) for `reveal: true` without `ctx.reveal`.
  * `ui.now` is a number (a getter, always the current game time), like `ctx.now`.
  * `local` handlers renamed to `localActions`.
  * `ui.html`: an unquoted attribute value is quoted and escaped; `data-payload=${{ … }}` is JSON (no `JSON.stringify` needed); objects in text are JSON instead of `[object Object]`.
  * `createScene3d`: `near` / `far` of the camera.

## Compatibility within 1.x

The contract has three layers, all backward compatible within `1.x`: the protocol between hosts and plugins ([SPEC](../protocol/SPEC.md)), this API (`defineGame`, `ctx`, `ui`, the documented classes and attributes of `ui.question`) and the messages between SDK instances. The devices of one game may run different `1.x` versions of the SDK, so an SDK ignores message types and fields it does not know, and new parts of messages are optional fields (an older SDK ignores them, a newer one keeps the old behaviour without them). State patches carry the version of their format, so even the patch format can change within 1.x (older devices then ask for the full state).

Reserved for the SDK (SPEC 9): action names and timer keys starting with `$`, attributes `data-mz-…`, CSS classes `mz-…`. Fields of the SDK in the game state exist only on request (`phase`, `phaseSeq`, `phaseEndsAt` with `phases`); later ones will be opt-in too.

## Loading and compatibility

* Plugins import `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`: the package's self-contained
  ES module (`dist/bundle/memizy-sdk.bundle.js`, about 66 kB gzipped). Every 1.x release reaches all
  plugins (jsDelivr refreshes the `@1` range within hours), so a plugin never pins an exact version.
* The devices of one game may run different 1.x versions: the SDK's own messages (actions, state
  patches, reveals) only change additively and unknown parts are ignored. The connection to the host
  is Penpal 8 for the whole 1.x line (protocol SPEC, section 4); the SDK adds what Penpal needs on
  older browsers (`Promise.withResolvers`, `Object.hasOwn`), so older school iPads work too.
