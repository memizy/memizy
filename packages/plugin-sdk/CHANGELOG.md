# Changelog of @memizy/plugin-sdk

Plugins import `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`: every 1.x release reaches them.

## Unreleased (1.0.1)

* `createScene3d` no longer piles up WebGL contexts. Browsers keep about 16 and drop the oldest – often the game's live scene, which then fell back to 2D (`lost`). `webglAvailable` tests WebGL once per page and frees its test context at once; `dispose()` frees the renderer's context (`forceContextLoss`) without calling `onFallback`.

## 1.0.0 (2026-10-21)

The first stable release: the contract of 1.0.0-rc.7, unchanged. The AI guide (`docs/ai-plugin-guide.md`) says what a Memizy game can be (6.5): fast player-vs-player action is a standalone game. From now on 1.x versions only add (see the README).

## 1.0.0-rc.7 (2026-10-16)

* The authority ignores an action whose payload contains a `__proto__` key (`INVALID_PAYLOAD`): a game that merges payloads into its state would otherwise let a player change the prototype.
* `ctx.random` / `ctx.shuffle` use the secret seed of the authority (`InitPayload.seed`) and a 128-bit generator (sfc32; was mulberry32 seeded with the session id, which every device knows). Snapshots store the new state; snapshots of earlier release candidates still load. The standalone preview creates a random seed.
* `ctx.recordAnswer(item, isCorrect, { score })`: partial credit 0–1.
* Media of a type from a later OQSE version are shown as a link; OQSE tags of a later version (`<name:key />`) are removed from the text.
* The standalone preview gives settings of a later protocol version their default.

## 1.0.0-rc.6 (2026-10-14)

Implements the final protocol 1.0 ([SPEC](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md)).

* The SDK keeps within the host's guaranteed rates (SPEC 8.1): recorded answers and asset requests wait for their turn in order (nothing is lost), `end` is sent after the answers recorded before it, extra error reports are dropped.
* `ui.question` shows pictures of the set's local assets (object URLs made from host assets), not only web URLs.
* Stricter sanitizing of the set's texts (`ui.text`, `ui.question`, `ui.note`): no `data-*` attributes (`data-act`, `data-local`…), no `id`s, no form controls or `<style>`; `style` keeps only colors and text formatting (no `url()`, no positioning). A GFM task list keeps its disabled checkboxes.
* KaTeX `0.16.47` and Mermaid `11.17.2` are loaded from jsDelivr in exact versions.
* Renamed `ui.renderNote` → `ui.note` and the type `Theme` → `HostConfig` (no aliases).
* Removed `ui.setProgress` (progress comes from `ctx.recordAnswer`; writing it directly is reserved in SPEC 10). A flashcard's self-rating is sent as its `confidence` automatically.
* `ui.question` attributes use the `data-mz-` prefix: the stable styling hooks are `data-mz-type` and `data-mz-option` (were `data-type`, `data-option`).
* State patches carry their format (`f: 1`); a device that does not know the format asks for the full state.
* Names starting with `$` (actions, timer keys) are reserved for the SDK; `defineGame` and `ctx.after` / `ctx.cancel` reject them.
* Links open in a new tab; the SDK can be imported without a DOM (Node).
* The SDK adds what Penpal 8 needs on older browsers (`Promise.withResolvers`, `Object.hasOwn`), so older school iPads work too.

## 1.0.0-rc.5

* Penpal 8, mutative 2 and a self-contained bundle (`dist/bundle/memizy-sdk.bundle.js`, served for `@1`).
* `ui.question(item, { counts })` – how many players chose each option, as a badge on the option (choice types).
* Timed phases re-render on their own (the `ui.timeLeft()` countdown runs without `tickMs`; `tickMs` stays for own animations).
* `data-local="name"` + `defineGame({ localActions: { name(local, payload, ui) { … } } })` – device-only clicks (tabs, a 2D/3D switch) that change `ui.local` and re-render.
* `createScene3d`: a black or slow scene switches to 2D at most once per page (the player's return to 3D is respected); `onFallback(reason, { kind })`; a game without `onFallback` stays 3D and shows a message only when 3D cannot run at all; `near` / `far` of the camera.
* No zoom on phones: the SDK locks the viewport, stops pinch gestures and double-tap zoom and keeps text fields at least 16 px on touch screens (iOS zooms into smaller fields).
* Removed `ui.escape` – `ui.html` escapes.
* Late actions: an action carries the `phaseSeq` the player saw; in games with phases the authority ignores actions from the screen of an older phase (late answers, double clicks), and still confirms them.
* `ctx.actedAt`: the time of the tap (limited to 400 ms before the arrival) for points by speed.
* `ctx.goto` takes effect immediately (the rest of the action sees the new phase; `onEnter` runs at once as the system). `playerView` gets `phase`, `phaseSeq`, `phaseEndsAt` copied (reserved fields).
* `ctx.hide` does nothing for items that were not revealed.
* `ui.question`: `itemId` in every answer payload; a sent answer is shown as chosen (and locked) until the authority confirms it; `--mz-q-index`; a warning (`REVEAL_WITHOUT_ANSWER`) for `reveal: true` without `ctx.reveal`.
* `ui.now` is a number (a getter, always the current game time), like `ctx.now`.
* `ui.html`: an unquoted attribute value is quoted and escaped; `data-payload=${{ … }}` is JSON (no `JSON.stringify` needed); objects in text are JSON instead of `[object Object]`.
