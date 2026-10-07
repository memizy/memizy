# Memizy Plugin Guide for AI Assistants

> Status: **Release Candidate 4** (2026-10-07) – describes `@memizy/plugin-sdk@1` and OQSE 0.3 study sets.
> Paste this whole document into your AI assistant together with your idea for a game.

You are writing a **Memizy plugin**: a learning game in **one HTML file**. Memizy (the host app) gives the game a study set (questions, notes) and runs it alone (**solo**) or with a whole class (**multiplayer**). You write only the game rules and the screens. The SDK handles connection, synchronization between devices, reconnecting, timers, pauses, rendering of formatted text, ready-made answer controls and saving learning progress.

---

## 1. Rules (always follow)

1. Produce **one complete `index.html`** file. No build step, no other files. If you edit files directly (an IDE or coding agent), write it into `index.html`; otherwise give the whole file in **one** code block (```html), never in parts.
2. Include the **manifest** `<script type="application/oqse-manifest+json">` (section 3).
3. Import the SDK exactly like this: `import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';`
4. Call `defineGame({...})` **once**. Do not use `localStorage` or `IndexedDB` (blocked) – to remember things between games use `ui.save` (section 5.3). Network requests (`fetch`, `WebSocket`) work only to origins declared in the manifest `permissions.network` (section 3); for AI and other Memizy services use `ui.service` (section 5.4).
5. **All game state lives in the state object** and changes **only inside actions** (and phase hooks). `render` only reads the state and draws the screen.
6. Inside actions, **mutate `state` directly** (e.g. `state.scores[id] = 10`). Do not return a new object.
7. Never use `Math.random()` or `Date.now()` inside `initialState`/actions. Use `ctx.random()`, `ctx.shuffle()`, `ctx.now`.
8. Describe the game as **phases** (`phases` + `ctx.goto`, section 4.2): the SDK then ignores actions that do not belong to the current phase and runs the time limits. Every action still **validates its payload** and ignores duplicates (just `return`).
9. Draw screens with **`ui.html`** templates (section 6): they escape player names and other text automatically. Buttons call actions with `data-act` attributes, never with `onclick`.
10. Show questions with **`ui.question(item, …)`** (ready-made controls for every common question type, section 6.2) unless the game needs its own controls. Choices have **ids**: send `option.id`, never a position (section 7).
11. **Answers live only on the authority.** In multiplayer the players' devices get the items **without answers** (`item.answerHidden === true`). Check answers only in actions with `checkAnswer(ctx.item(id), answer)`. Show the right answer after `ctx.reveal(itemId)`.
12. If the state holds something other players must not see (their answers before the reveal, cards in a hand), add **`playerView`** (section 5.5).

---

## 2. How a Game Runs

| Mode | Screens (views) | Who runs the rules |
| :--- | :--- | :--- |
| Solo | one `solo` screen | the player's device |
| Multiplayer, teacher presents | one `board` (projector) + a `controller` for every student | the board |
| Multiplayer, host plays along | a `controller` for every player (the host too), no board | the host's device |

You do not have to care who runs the rules. Write actions as if there was one shared state; the SDK runs them in the right place and sends the new state to every screen. `render` is called on every screen with `ui.view` telling you which screen it is. The teacher can **pause** the game at any time: the SDK stops the time and covers the screens – you do not need to do anything.

---

## 3. Manifest

Declare what the game supports. Adjust `id`, `appName`, `types` and `modes`.

```json
{
  "version": "0.2",
  "id": "https://memizy.com/plugins/my-game",
  "appName": "My Game",
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
        "multiplayer": { "players": { "min": 1, "max": 40 }, "hostAs": ["presenter", "player"], "lateJoin": true }
      },
      "settings": [
        { "id": "questionTime", "type": "number", "label": { "cs": "Čas na otázku (s)", "en": "Time per question (s)" }, "default": 20, "min": 5, "max": 120 }
      ]
    }
  }
}
```

* `"version": "0.2"` is the version of the manifest format (keep it). `types`: only item types your game can show (section 7). With `ui.question` that can be many of them. The app gives you only these.
* Remove `solo` or `multiplayer` if the game does not support it. In `hostAs` keep `"presenter"` only if you draw a `board` view, keep `"player"` only if the game works without a board.
* `settings`: options of the game (types `number`, `boolean`, `select`, `text`). Read them as `ctx.settings.questionTime`.
  * **Multiplayer:** the teacher sets them in the lobby; the app generates a form automatically.
  * **Solo:** the app may show a simple form before the start. If the player should choose something during the game (a level, a character), make it the **first phase of your game**.
  * A setting only for one mode: `"modes": ["solo"]` or `"modes": ["multiplayer"]`. Without `modes` it applies to both.
* Optional: `"permissions": { "network": ["https://lichess.org"], "devices": ["microphone"] }` – the only places the game may connect to and the devices it uses (`camera`, `microphone`, `geolocation`, `serial`, `bluetooth`). Users see them; everything else is blocked. Load libraries only from `https://cdn.jsdelivr.net` (also `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`) – those need no permission.
* Optional: `"services": ["chess.puzzles"]` – Memizy services the game calls with `ui.service` (section 5.4).
* Optional, multiplayer only: `"settingsScreen": { "size": "compact" }` (a panel in the lobby) or `{ "size": "large" }` (a full-screen dialog): the game draws its own settings screen with `renderSettings` (section 4.1). The `settings` list is still required.

---

## 4. `defineGame`

```js
const game = defineGame({
  root: document.getElementById('app'),  // where to render
  tickMs: 250,                           // optional: re-render periodically (countdowns)

  initialState(ctx) {                    // once, when the game starts → initial state
    ctx.goto('question');                // the first phase (section 4.2)
    return { round: 0, scores: {}, answers: {} };
  },

  phases: { /* section 4.2 */ },

  actions: {                             // what players (and the teacher) can do
    answer(state, payload, ctx) { /* ... */ },
  },

  playerView(state, playerId) {},        // optional: what one player may see (section 5.5)
  playerJoined(state, player, ctx) {},   // optional
  playerLeft(state, player, ctx) {},     // optional

  renderWaiting(ui) {},                  // optional: multiplayer screen before the game starts
  renderSettings(settings, ui) {},       // optional: own lobby settings screen ("settingsScreen" in the manifest)
  validateSettings(settings) {},         // optional: return an error message, or nothing if valid

  render(state, ui) {                    // draw the screen
    return ui.html`<h1>Ahoj ${ui.self?.name ?? ''}</h1>`;
  },

  afterRender(state, ui) {},             // optional: after each render, for canvas / 3D (section 6.3)
});
```

`defineGame` returns a handle: `game.act(name, payload)` calls an action from your own code (section 6.3).

### 4.1 Before the game starts

* **Solo:** the game starts immediately – no lobby, no countdown.
* **Multiplayer:** the app shows the lobby, waits until the game has loaded on every device, shows a countdown and then calls `initialState`. Until then the SDK shows `renderWaiting(ui)` (or a default "Waiting for the game to start" screen).
* **Own lobby settings screen** (only with `"settingsScreen"`): `renderSettings(settings, ui)` returns HTML; inputs with `data-setting="id"` update that setting automatically. `validateSettings(settings)` returns an error text (Start stays disabled) or nothing. `ui.players` shows who has joined so far.

```js
renderSettings(settings, ui) {
  return ui.html`<label>Čas na otázku: <input type="range" min="5" max="120" data-setting="questionTime" value="${settings.questionTime}"> ${settings.questionTime} s</label>
                 <p>Připojeno hráčů: ${ui.players.length}</p>`;
},
```

### 4.2 Phases (the life cycle of the game)

Almost every game goes through phases: choosing a team → a question → the reveal → … → the end. Declare them and move between them with `ctx.goto(name)`:

```js
phases: {
  question: {
    seconds: (state, ctx) => ctx.settings.questionTime,  // time limit (a number, or computed)
    actions: ['answer'],                                  // actions allowed only in this phase
    onEnter(state, ctx) { state.answers = {}; },
    onTimeout: 'reveal',                                  // next phase when the time is up
  },
  reveal: {
    seconds: 4,
    onEnter(state, ctx) { ctx.reveal(state.questions[state.round]); },
    onTimeout(state, ctx) { nextQuestion(state, ctx); },  // or a function that calls ctx.goto
  },
  end: {
    onEnter(state, ctx) { ctx.end({ scores: state.scores }); },
  },
},
```

* The SDK keeps **`state.phase`**, **`state.phaseEndsAt`** (the deadline, or `null`) and `state.phaseSeq` – do not set them yourself. `ui.phase` is the current phase, **`ui.timeLeft()`** (without an argument) the milliseconds until the end of the phase.
* An action listed in some phase's `actions` is **ignored in every other phase** (late answers, taps during the reveal). Actions that no phase lists are always allowed – e.g. a teacher's "next" (protect it with `ctx.fromHost`, section 5.2).
* `ctx.goto` takes effect right **after** the current action or hook. Ending a phase early (everyone answered) is just `ctx.goto('reveal')`.
* Time limits use the game clock: when the teacher pauses the game, the phase waits too.
* You can still use `ctx.after(ms, action, payload)` for other timers.

### `ctx` (in `initialState`, actions, phase hooks, `playerJoined`, `playerLeft`)

| Name | Description |
| :--- | :--- |
| `ctx.playerId` | Who sent the action (`null` for timers, phase hooks and buttons on the board – the board is not a player). |
| `ctx.fromHost` | `true` if the action comes from the host (the board, or the host playing along) or from the game itself (timers); `false` for other players. Protect teacher-only controls with it (section 5.2). |
| `ctx.players` | Current players `[{ id, name, isHost, connected }]` (the presenter is not a player). |
| `ctx.items` / `ctx.item(id)` | Items of the study set, **with answers** (this code runs on the authority). |
| `ctx.settings` | Values of the manifest settings. |
| `ctx.mode` / `ctx.hostAs` | `'solo'` / `'multiplayer'`; `'presenter'` / `'player'` / `null`. |
| `ctx.now` | Current time in ms (same clock on all devices; stands still while paused). |
| `ctx.random()` / `ctx.shuffle(array)` | Random number 0–1 / shuffled copy of an array. |
| `ctx.goto(phase)` | Move to another phase (section 4.2). |
| `ctx.after(ms, action, payload?, { key }?)` / `ctx.cancel(key)` | Run an action later / cancel a timer. A timer with the same `key` replaces the previous one. |
| `ctx.recordAnswer(itemId, isCorrect, { playerId?, answer? }?)` | Save learning progress (default player: `ctx.playerId`). Call it for every answered question and pass `answer` (what the player chose) – teachers see it. For a question that is not in the set (from a service or your own generator) pass the item itself instead of its id. |
| `ctx.reveal(itemId \| ids, { to? }?)` | Send the answer (correct option, explanation, back of a flashcard) to the players' devices: to everyone, or `{ to: playerId }`. |
| `ctx.hide(itemId \| ids, { to? }?)` | Take a reveal back (e.g. before the same question is asked again). |
| `ctx.end({ scores })` | The game is over. `scores` = `{ [playerId]: points }`. |

### `ui` (in `render`, `afterRender`, `renderWaiting`)

| Name | Description |
| :--- | :--- |
| `ui.html` | Template for HTML: ``ui.html`<p>${name}</p>` `` escapes every value; values from `ui.text`, `ui.question` and nested `ui.html` stay HTML; arrays are joined; `null`/`false` are left out. |
| `ui.question(item, options?)` | Ready-made answering controls (section 6.2). |
| `ui.text(markdown, { inline, item }?)` | Safe HTML for text from the set (Markdown, LaTeX, images). `inline: true` inside buttons; pass `item` so its images are found. |
| `ui.renderNote(note)` | Safe HTML of a whole `note` item. |
| `ui.view` | `'solo'`, `'board'` or `'controller'`. |
| `ui.self` | This player (`null` on the board). |
| `ui.players`, `ui.settings`, `ui.mode`, `ui.hostAs` | Same as in `ctx`. |
| `ui.items`, `ui.item(id)` | The items to show. On players' devices in multiplayer **without** answers (`answerHidden: true`) until `ctx.reveal`. |
| `ui.phase`, `ui.timeLeft()` | The current phase / ms until its end (`ui.timeLeft(deadline)` for your own deadline). |
| `ui.isPending(name?)`, `ui.pending` | Whether an action of this device still waits for the authority / the list `{ name, payload, sentAt }`. Use it to mark the chosen option right away. |
| `ui.local`, `ui.setLocal(update)` | Data for this screen only (selected tab, 2D/3D switch…). `ui.setLocal({ tab: 'map' })` changes it **and re-renders**. Not shared, not saved. |
| `ui.act(name, payload)` | Call an action from your own JavaScript (normally use `data-act`). |
| `ui.paused` | `true` while the teacher has paused the game (the app covers the screen). |
| `ui.service(name, payload)`, `ui.services` | Call a Memizy service (section 5.4) / services available here. |
| `ui.progress` | Learning progress of this player `{ [itemId]: { bucket: 0-4, … } }` (empty on the board). |
| `ui.saved` / `ui.save(scope, value)` | Data saved between games for this player (section 5.3). |
| `ui.setProgress(itemId, { bucket })` | Set this player's progress directly (self-rating). Prefer `ctx.recordAnswer` when an answer can be checked. |
| `ui.escape(text)`, `ui.raw(html)` | Escape text by hand / mark your own HTML as safe (rarely needed with `ui.html`). |
| `ui.locale` | Language of the app, e.g. `'cs'`. |

---

## 5. State Rules

* Keep the state **small and JSON-only** (numbers, strings, booleans, arrays, plain objects). Store item **ids**, not whole items.
* A player can leave or join at any time: use `ctx.players`, never assume a fixed number of players, and write `state.scores[id] ?? 0`.
* Use player ids as keys (`state.scores[playerId]`). Show names with `ui.players`.

### 5.1 Limits

Exceeding a limit makes the action fail (and the Plugin Lab tests report it):

* **State size:** under **64 KB** as JSON (ids, not whole items; no images or long texts).
* **Actions:** at most **30 per second** per device. Never call `ui.act` in a loop, in `requestAnimationFrame` or on every mouse move; send the decision, not every intermediate step.
* **Timers:** use phases or `ctx.after` with a deadline in the state; never an action every second to count down – `render` with `tickMs` shows the countdown.
* **Saved data** (section 5.3): at most **256 KB** per scope.

### 5.2 Teacher-Only Controls

Any player can send any action – a curious student can do it from the browser's developer tools (and the Plugin Lab tests try it). Actions that only the teacher may use, such as "next question" or "end game", must check `ctx.fromHost` first:

```js
actions: {
  next(state, payload, ctx) {
    if (!ctx.fromHost) return;           // ignore players
    if (state.phase === 'question') ctx.goto('reveal');
  },
},
render(state, ui) {
  const canControl = ui.view === 'board' || ui.self?.isHost;   // the board, or the host playing along
  return ui.html`${canControl ? ui.html`<button data-act="next">Další</button>` : ''}`;
},
```

Timers and phase timeouts count as the host.

### 5.3 Saving Progress Between Games

The game state is forgotten when the game ends. To remember something **for the next time** (unlocked levels, coins, best score), use the player's saved data:

* `ui.saved.plugin` – across all study sets (e.g. `{ coins: 120, unlocked: ['dragon'] }`),
* `ui.saved.set` – for the current study set (e.g. `{ level: 4, best: 9800 }`),
* `ui.save('plugin' | 'set', value)` replaces the whole value. Both are `null` until something is saved.

```js
afterRender(state, ui) {
  const best = ui.saved.set?.best ?? 0;
  if (state.phase === 'end' && state.score > best) ui.save('set', { ...ui.saved.set, best: state.score });
},
```

* Saved data belongs to **this player** – the board has none. Learning results go through `ctx.recordAnswer`, never through `ui.save`.

### 5.4 Memizy Services

A service is something a study set cannot contain: an AI answer, speech, a fresh exercise from a database ("a chess puzzle for my level"). Declare it in the manifest `services` and call it with `ui.service`. The call is asynchronous, so do it in `afterRender` or an event handler (never in an action), then pass the result to the game with an action:

```js
afterRender(state, ui) {
  if (ui.isAuthority && state.phase === 'loading' && !ui.local.loading) {
    ui.local.loading = true;
    ui.service('chess.puzzles', { rating: 1400 })
      .then((puzzle) => ui.act('puzzleLoaded', { puzzle }))   // an OQSE chess-puzzle item
      .catch(() => ui.act('puzzleLoaded', { puzzle: null }))   // not available here: use the set
      .finally(() => (ui.local.loading = false));
  }
},
```

* A service that returns questions returns OQSE items: show and check them like items of the set and record them with `ctx.recordAnswer(item, isCorrect)`.
* A service may be unavailable (the Plugin Lab, an older app): `ui.service` then rejects with `SERVICE_UNAVAILABLE`. Always have a fallback.

### 5.5 Secrets in the State: `playerView`

Every device receives the state – a student with developer tools can read all of it. If the state holds something others must not see before the right moment (other players' answers, cards in a hand, hidden units), add `playerView`: the SDK then sends each device **only its own view**, and every `render` (also on the board and on the host) gets the view instead of the state.

```js
playerView(state, playerId) {                 // playerId is null on the board
  if (state.phase !== 'question') return state;
  const answers = {};
  for (const [id, a] of Object.entries(state.answers)) answers[id] = id === playerId ? a : { answered: true };
  return { ...state, answers };               // a new object; never change `state` here
},
```

Without secrets, leave `playerView` out.

---

## 6. Rendering and Input

`render` returns HTML – write it with **`ui.html`**. The SDK updates the page efficiently and keeps focus and typed text in inputs.

```js
render(state, ui) {
  return ui.html`<ul>${ui.players.map((p) => ui.html`<li>${p.name}: ${state.scores[p.id] ?? 0}</li>`)}</ul>`;
}
```

* **Buttons:** `<button data-act="answer" data-payload='${JSON.stringify({ answer: option.id })}'>…</button>` calls the action `answer` with `{ answer: option.id }`. Inside `ui.html` the JSON is escaped correctly; keep the attribute in single quotes.
* **Forms:** `<form data-act="sendText"><input name="text"><button>OK</button></form>` calls `sendText` with `{ text: "…" }` on submit.
* Screen-only state (the selected tab, an open menu) goes to `ui.setLocal`; call an action when the player decides.
* In multiplayer an action travels to the authority and back (~0.1–0.3 s). Show it right away with `ui.isPending('answer')` or `ui.pending` (e.g. the chosen option highlighted), but let the result come from the state.
* Elements that appear and disappear (messages, popups, timers) need an `id` or `data-key`, e.g. `<div data-key="toast">`, so an input below them keeps its focus.
* A controller can be a **phone, tablet or computer**: big buttons (min. 48 px), one column on narrow screens, no hover-only interactions. The board is for a **projector**: large font, high contrast. Browsers grey out disabled buttons; add `button:disabled { color: inherit; }` if you show them on the board.
* Support light and dark mode with `light-dark(lightColor, darkColor)` in CSS (the SDK sets `color-scheme` from the app; do not use `prefers-color-scheme`).

### 6.2 Ready-Made Question Controls: `ui.question`

`ui.question(item, options)` draws the question and its answering controls for any common type: choices and true/false (one tap), multiple choice, short / numeric / math answers, slider, sorting and timelines (tap in order), pairs and categories (pick from a list), fill-in blanks, matrix, flashcards (flip and self-rating), notes and pins on an image. When the player answers, it calls the action with `{ ...payload, answer }`, where `answer` is exactly what `checkAnswer` expects.

```js
ui.question(item, {
  action: 'answer',                     // default
  payload: { round: state.round },      // extra fields for the action
  chosen: mine?.answer,                 // the player's answer: marked, controls locked
  reveal: state.phase === 'reveal',     // mark right / wrong (after ctx.reveal)
  disabled: ui.view === 'board',        // e.g. the board only shows the question
  showQuestion: true,                   // false = only the controls
})
```

Restyle it with CSS variables on a parent: `--mz-q-accent`, `--mz-q-bg`, `--mz-q-fg`, `--mz-q-border`, `--mz-q-radius`, `--mz-q-gap`, `--mz-q-right`, `--mz-q-wrong` (classes `.mz-q-opt`, `.mz-q-submit`… for more). Draw your own controls only when the game needs them (e.g. answering by shooting at a target); then send `option.id`s.

### 6.3 Canvas, WebGL and 3D Games

HTML is for text, buttons and menus. For a canvas or a 3D scene (e.g. Three.js):

* Put an empty element with **`data-keep`** into the HTML: `<div id="scene" data-keep></div>`. The SDK never touches what is inside it, so your canvas survives every render.
* Create the scene once and update it in **`afterRender(state, ui)`**, which runs after every render (not every animation frame): move objects, start an explosion when `state.lastShot` changed. It must not change the state. Keep your own `requestAnimationFrame` loop for smooth movement.
* Clicks inside the scene: call **`game.act('fire', { target: 2 })`** (the handle from `defineGame`) or `ui.act`. Device-only flags (2D/3D, camera mode) go to `ui.setLocal`.
* The state holds what matters for the game (positions after a move, hits), not animation frames: one action per decision (limit 30 per second).
* Not every device runs WebGL well: check that a WebGL context can be created, offer a 2D view (another `render` branch) when it fails or the frame rate stays low, and a button to switch. Lower the quality on phones (`setPixelRatio(Math.min(devicePixelRatio, 2))`, no or small shadows). On iOS the page resizes when the toolbars move: re-measure the canvas size before handling a tap.
* Load libraries as ES modules from `https://cdn.jsdelivr.net/npm/...` (e.g. `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js`).

---

## 7. Study Set Items (OQSE 0.3)

Every item has `id` and `type`. Common optional fields: `hints`, `explanation`, `tags`, `topic`, `skills`.

Lists the player chooses from or arranges are **choices** `{ id, text }`: `options`, `items`, `prompts`, `matches`, `categories`… Show `choice.text` (with `ui.text`) and send back **`choice.id`** – never a position.

| `type` | Fields to show | Answer for `checkAnswer(item, answer)` |
| :--- | :--- | :--- |
| `mcq-single` | `question`, `options[]` | id of the chosen option |
| `mcq-multi` | `question`, `options[]` | array of chosen option ids |
| `true-false` | `question` | `true` / `false` |
| `short-answer` | `question` | typed text |
| `numeric-input` | `question`, `unit?` | number (or text like `"9,81"`) |
| `slider` | `question`, `min`, `max`, `step`, `unit?` | number |
| `sort-items` | `question`, `items[]` | array of item ids in the player's order |
| `match-pairs` | `question?`, `prompts[]`, `matches[]` (may have extra matches) | `{ promptId: matchId }` |
| `categorize` | `question`, `categories[]`, `items[]` | `{ itemId: categoryId }` |
| `fill-in-blanks` / `fill-in-select` | `text` with blanks | `{ token: text }` / `{ token: optionId }` |
| `timeline` | `question`, `events[]` | array of event ids in order |
| `flashcard` | `front`, `back` | no checking – let the player rate themselves |
| `note` | `title?`, `content`, `hiddenContent?` | no checking – show with `ui.renderNote` |

* `checkAnswer(item, answer)` returns `true`/`false` and applies the rules of the set (case, tolerance, alternative answers). Call it in **actions** (on a player's device the item has no answer and `checkAnswer` throws).
* Memizy already shuffles options and lists once per game (the same order on every device). Show them in the order you get them.
* The answer fields (`correctId`, `correctIds`, `correctOrder`, `pairs`, `correctAnswer(s)`, `explanation`, a choice's `explanation`, the `back` of a flashcard…) exist on players' devices only after `ctx.reveal`. Show them only after the reveal and only when `!item.answerHidden` (`ui.question` with `reveal: true` does it for you).

---

## 8. Complete Example

A quiz race: questions with a countdown, faster correct answers give more points. Works in solo, with a presenter board, and with the host playing along; uses phases, `ui.question`, `ui.html` and `playerView`.

```html
<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiz Race</title>
<script type="application/oqse-manifest+json">
{
  "version": "0.2",
  "id": "https://memizy.com/plugins/quiz-race",
  "appName": "Quiz Race",
  "pluginVersion": "2.0.0",
  "capabilities": { "actions": ["render"], "types": ["mcq-single", "true-false", "mcq-multi", "short-answer", "numeric-input"], "features": ["markdown", "latex"] },
  "appSpecific": { "memizy": {
    "protocol": "1.0",
    "modes": { "solo": {}, "multiplayer": { "players": { "min": 1, "max": 40 }, "hostAs": ["presenter", "player"], "lateJoin": true } },
    "settings": [
      { "id": "questionTime", "type": "number", "label": { "cs": "Čas na otázku (s)", "en": "Time per question (s)" }, "default": 20, "min": 5, "max": 120 },
      { "id": "questionCount", "type": "number", "label": { "cs": "Počet otázek", "en": "Number of questions" }, "default": 10, "min": 1, "max": 50 }
    ]
  } }
}
</script>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; }
  .screen { padding: 16px; display: grid; gap: 16px; max-width: 900px; margin: auto; }
  .board { font-size: 1.5rem; --mz-q-gap: 16px; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  .timer { font-size: 2rem; font-weight: bold; }
  .result { font-size: 1.3rem; font-weight: bold; }
  button:disabled { color: inherit; }
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';

/** After the reveal: the next question, or the end. */
function nextQuestion(state, ctx) {
  if (state.round + 1 >= state.questions.length) return ctx.goto('end');
  state.round += 1;
  ctx.goto('question');
}

defineGame({
  root: document.getElementById('app'),
  tickMs: 250,

  initialState(ctx) {
    const ids = ctx.shuffle(ctx.items).slice(0, ctx.settings.questionCount).map((item) => item.id);
    ctx.goto('question');
    return { questions: ids, round: 0, scores: {}, answers: {} };
  },

  phases: {
    question: {
      seconds: (state, ctx) => ctx.settings.questionTime,
      actions: ['answer'],
      onEnter(state) { state.answers = {}; },
      onTimeout: 'reveal',
    },
    reveal: {
      seconds: 4,
      onEnter(state, ctx) { ctx.reveal(state.questions[state.round]); },
      onTimeout: nextQuestion,
    },
    end: {
      onEnter(state, ctx) { ctx.end({ scores: state.scores }); },
    },
  },

  actions: {
    answer(state, payload, ctx) {
      if (!ctx.playerId || state.answers[ctx.playerId] || payload?.answer === undefined) return;
      const item = ctx.item(state.questions[state.round]);
      const correct = checkAnswer(item, payload.answer);
      state.answers[ctx.playerId] = { answer: payload.answer, correct };
      if (correct) {
        const total = ctx.settings.questionTime * 1000;
        const left = Math.max(0, state.phaseEndsAt - ctx.now);
        state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 500 + Math.round(500 * left / total);
      }
      ctx.recordAnswer(item.id, correct, { answer: payload.answer });
      if (ctx.players.filter((p) => p.connected).every((p) => state.answers[p.id])) ctx.goto('reveal');
    },
    next(state, payload, ctx) {
      if (!ctx.fromHost) return;                      // teacher only
      if (state.phase === 'question') ctx.goto('reveal');
      else if (state.phase === 'reveal') nextQuestion(state, ctx);
    },
  },

  // Before the reveal, nobody sees the others' answers (or whether they were right).
  playerView(state, playerId) {
    if (state.phase !== 'question') return state;
    const answers = {};
    for (const [id, a] of Object.entries(state.answers)) answers[id] = id === playerId ? { answer: a.answer } : { answered: true };
    return { ...state, answers };
  },

  render(state, ui) {
    const board = ui.view === 'board';
    const canControl = board || ui.self?.isHost;
    const ranking = [...ui.players].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0));

    if (state.phase === 'end') {
      return ui.html`<div class="screen ${board ? 'board' : ''}">
        <h1>Konec hry</h1>
        <ol>${ranking.map((p) => ui.html`<li>${p.name}: ${state.scores[p.id] ?? 0}</li>`)}</ol>
      </div>`;
    }

    const item = ui.item(state.questions[state.round]);
    const mine = ui.self ? state.answers[ui.self.id] : null;
    const sent = ui.pending.find((a) => a.name === 'answer')?.payload?.answer;
    const seconds = Math.ceil(ui.timeLeft() / 1000);

    return ui.html`<div class="screen ${board ? 'board' : ''}">
      <div class="top">
        <span>Otázka ${state.round + 1} / ${state.questions.length}</span>
        ${state.phase === 'question' ? ui.html`<span class="timer">${seconds}</span>` : ''}
      </div>
      ${ui.question(item, {
        chosen: mine?.answer ?? sent,
        reveal: state.phase === 'reveal',
        disabled: !ui.self,
      })}
      ${board ? ui.html`<div>Odpovědělo ${Object.keys(state.answers).length} / ${ui.players.length}</div>` : ''}
      ${state.phase === 'reveal' && mine ? ui.html`<div class="result">${mine.correct ? 'Správně! 🎉' : 'Špatně'}</div>` : ''}
      ${canControl ? ui.html`<button data-act="next">Další ⏭</button>` : ''}
    </div>`;
  },
});
</script>
</body>
</html>
```

---

## 9. Checklist Before You Answer

- [ ] One complete `index.html` with the manifest and the SDK import from section 1.
- [ ] `types` in the manifest match the item types the game handles.
- [ ] `hostAs` contains `"presenter"` only if `render` handles `ui.view === 'board'`.
- [ ] The game is described as `phases`; actions of a phase are listed in its `actions`; every action validates its payload and ignores duplicates.
- [ ] Answers are checked in actions with `checkAnswer`; the reveal calls `ctx.reveal(itemId)`; answers are shown only after it.
- [ ] Choices are sent as ids (`option.id`), never positions; `ui.question` is used where it fits.
- [ ] `render` uses `ui.html`; study-set text goes through `ui.text` / `ui.question` / `ui.renderNote`.
- [ ] No `Math.random()`, `Date.now()`, `localStorage` in game logic; network only to declared `permissions.network`.
- [ ] `ctx.recordAnswer(itemId, correct, { answer })` for every answered question, `ctx.end({ scores })` at the end.
- [ ] Secrets in the state (others' answers before the reveal, hands) are hidden with `playerView`.
- [ ] Teacher-only actions (next, end…) start with `if (!ctx.fromHost) return;`.
- [ ] Controllers usable on a phone and a computer, the board readable on a projector.
- [ ] State stays small (ids instead of items); no actions in loops or animation frames.
- [ ] Progress between games uses `ui.save`; in solo, player choices (level, character) are the first phase.

## 10. Common Mistakes

1. Changing state inside `render`, `afterRender` or event listeners instead of in actions.
2. Sending the position of an option (`answer: 2`) instead of its id (`answer: option.id`).
3. Using `onclick="..."` – functions inside `<script type="module">` are not global; use `data-act`.
4. Building HTML with plain template strings and forgetting to escape a player name – use `ui.html`.
5. Assuming the board is a player (it is not in `ctx.players`) or that the host never plays.
6. Showing the correct answer before the reveal, or reading answer fields on a player's device without `ctx.reveal`.
7. Forgetting that a player may join late: `state.scores[id] ?? 0`.
8. Setting `state.phase` by hand in a game with `phases` – use `ctx.goto`.
9. Teacher-only actions without `ctx.fromHost` – students could skip questions or end the game.
10. A canvas or 3D scene without `data-keep` – it is recreated on every render (black or flickering screen). Never call `location.reload()`.
