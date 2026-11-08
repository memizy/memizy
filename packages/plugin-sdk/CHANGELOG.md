# Changelog of @memizy/plugin-sdk

Plugins import `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`: every 1.x release reaches them.

## 1.1.0-rc.2 (unreleased)

* Media of hidden fields after a reveal (protocol 1.1, feature `reveal-items`): `ctx.reveal` tells the host (`revealItems`), and the players' devices fetch the pictures of the back of a card or an explanation they did not have. A continued game tells its new host again.

* `migrate(state, info)` in `defineGame`: a saved game continues in a newer version of the game (SPEC 3.3). Runs on the authority on every resume from a snapshot (`info.from` / `info.to`: the versions); snapshots keep the `pluginVersion` that saved them. If it throws, the saved state stays and the host hears `MIGRATE_FAILED`.

* `ui.download(fileName, content, type?)` and `ui.copy(text, html?)`: a game saves a file (results for the teacher) or copies text and formatted HTML (tables into Word). Directly under protocol 1.1 hosts (they allow downloads and the clipboard in the frame, SPEC 8.4); under older hosts the file is saved from a new window and copying uses a selection. Links with `download` are no longer stopped by the link guard.
* `ui.redrawIn(ms)`: draws the screen once more after a time – a countdown or a reading time that runs only sometimes, without `tickMs` (several calls keep the earliest).

## 1.1.0-rc.1 (2026-11-08)

* `setChanged` (protocol 1.1, feature `set-changes`, listed by every game): the set of a running instance changes – `ui.items` and `ui.progress` take the new ones, the earlier items stay known (a question on the screen keeps working), and with personal sets the player's queue starts again from the new set. Games that keep item IDs need nothing.

* Personal sets (protocol 1.1, SPEC 3.4): `ctx.personal` / `ui.personal`. On a player's device the SDK keeps the player's queue at the authority filled with their own next items (`state.$picks`, IDs and types, chosen by their progress), checks the answers given through `ui.question` to their own items, records them on the device and adds `correct` to the action. On the authority `ctx.nextItem` hands out those IDs and `ctx.recordAnswer` skips items it does not have.

* `ui.question(item, { star: true })`: a ☆ in the corner – the player stars the item for later (`ui.markItem(itemId, starred)` does the same from a game's own UI; protocol 1.1 apps keep it with `markItem`).
* `ui.question` waits on notes and flipped flashcards: "Done" and the ratings are disabled with a countdown for a reading time – by the length of the text in games that declare protocol 1.1 (1.5–10 s), none in older games; `minReadMs` sets it, `0` turns it off.

* `ctx.nextItem(playerId, { types })` and `defineGame({ pickItems })` (protocol 1.1, feature `pick-items`): the app chooses each player's next item by their learning progress; the SDK keeps a short queue per player in `state.$picks` (reserved), filled by the host as a system change (deterministic), and falls back to a random item not given lately. `pickItems: { ahead, weights }` sets the queue length and the level weights.

* `onFinish(state, ctx)` in `defineGame`: the app may ask the game to finish (the teacher presses "End game"; protocol 1.1, feature `finish-request`, listed only when the game has `onFinish`). It runs on the authority like an action, also while paused; call `ctx.end` there (e.g. `ctx.goto('end')`). Without `ctx.end` the SDK reports `FINISH_WITHOUT_END`. Games without `onFinish` are unchanged. The SDK speaks protocol 1.1.

## 1.0.2 (2026-11-08)

* `ui.question` with `reveal` shows the right answer for every item type, not only for choices: the right text of typed answers (and other accepted ones), the number with its tolerance and unit, the right order of a sorting or a timeline (with dates), each pair, category, blank or diagram zone marked with the right one where it was wrong, right / wrong / missed matrix cells, the right areas of a pin-on-image item, the sample answer of an open question. The item's `explanation` follows (with the feedback of a wrong answer and the explanation of a chosen option); `explanation: false` hides it.
* Once an answer is sent (`chosen`), every type shows that answer instead of empty controls (selects, blanks, matrix cells, the slider, pins kept the device's state and lost it after sending; typed answers no longer keep an empty field and a disabled button).

## 1.0.1 (2026-11-08)

* "Starting the game…" ("Spouštím hru…" in Czech) shows at once in an empty game root while the SDK looks for its host, instead of a blank page – in another site's preview (an AI chat's canvas) that took the whole hello deadline (10 s) before the standalone preview. A root with the game's own markup is left as it is.
* A revealed item (`ctx.reveal`) keeps the media this device loaded. Media from a set package (relative paths) reach a game as object URLs of its own document; the revealed copy came with the authority's URLs, so after the reveal a player's device lost even the picture of the question. Media that only hidden fields use (an explanation, the back of a card) still do not reach players' devices from a package (planned for 1.1); linked media (`https:`) work everywhere.
* `ui.question` keeps text typed but not yet sent (short, numeric and math answers, open answers, fill-in blanks) on the device for the item, like picked choices: when a game hides a question and draws it again (Regrowth puts an open question aside for a crisis), the text is still there. Typing draws nothing; sending the answer forgets the text.
* `ui.question` dropdowns (`match-pairs`, `match-complex`, `fill-in-select`): the open list was light text on a white list in dark games – the options took the game's text colour, the browser draws the list in the page's colour scheme. Options now use the system colours of that scheme (`Canvas` / `CanvasText`); a game's own option styles still win.
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
