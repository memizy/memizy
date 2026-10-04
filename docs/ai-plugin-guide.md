# Memizy Plugin Guide for AI Assistants

> Status: **Release Candidate 1** (2026-10-04) – describes `@memizy/plugin-sdk@1` (being implemented).
> Paste this whole document into your AI assistant together with your idea for a game.

You are writing a **Memizy plugin**: a learning game in **one HTML file**. Memizy (the host app) gives the game a study set (questions, notes) and runs it alone (**solo**) or with a whole class (**multiplayer**). You write only the game rules and the screens. The SDK handles connection, synchronization between devices, reconnecting, timers, rendering of formatted text and saving learning progress.

---

## 1. Rules (always follow)

1. Produce **one complete `index.html`** file. No build step, no other files.
2. Include the **manifest** `<script type="application/oqse-manifest+json">` (section 3).
3. Import the SDK exactly like this: `import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';`
4. Call `defineGame({...})` **once**. Do not use `fetch`, `WebSocket`, `localStorage`, `IndexedDB` or other network/storage APIs – they are blocked in Memizy. To remember things between games (levels, best score) use `ui.save` (section 5.2).
5. **All game state lives in the state object** and changes **only inside `actions`**. `render` only reads the state and draws the screen.
6. Inside actions, **mutate `state` directly** (e.g. `state.scores[id] = 10`). Do not return a new object.
7. Never use `Math.random()` or `Date.now()` inside `initialState`/`actions`. Use `ctx.random()`, `ctx.shuffle()`, `ctx.now`.
8. Every action **validates its payload** and **checks the current phase** before changing anything. Ignore invalid or late actions (just `return`).
9. Buttons call actions with `data-act` attributes, not with `onclick` handlers (section 6).
10. Render text from the study set with `ui.text(...)` – never insert it as raw HTML.

---

## 2. How a Game Runs

| Mode | Screens (views) | Who runs the rules |
| :--- | :--- | :--- |
| Solo | one `solo` screen | the player's device |
| Multiplayer, teacher presents | one `board` (projector) + a `controller` for every student | the board |
| Multiplayer, host plays along | a `controller` for every player (the host too), no board | the host's device |

You do not have to care who runs the rules. Write `actions` as if there was one shared state; the SDK runs them in the right place and sends the new state to every screen. `render` is called on every screen with `ui.view` telling you which screen it is.

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

* `types`: only item types your game can show (see section 7). The app gives you only these.
* Remove `solo` or `multiplayer` if the game does not support it. In `hostAs` keep `"presenter"` only if you draw a `board` view, keep `"player"` only if the game works without a board.
* `settings`: options of the game (types `number`, `boolean`, `select`, `text`). Read them as `ctx.settings.questionTime`.
  * **Multiplayer:** the teacher sets them in the lobby; the app generates a form automatically.
  * **Solo:** the app shows **no** settings screen. The game gets the defaults (or values preset by the app). If the player should choose something (difficulty, level), make it the **first phase of your game**.
* Optional, multiplayer only: `"settingsScreen": { "size": "compact" }` (a panel in the lobby) or `{ "size": "large" }` (a full-screen dialog): the game draws its own settings screen with `renderSettings` (section 4.1), e.g. to preview the chosen map. The `settings` list is still required – it defines types, defaults and limits.

---

## 4. `defineGame`

```js
defineGame({
  root: document.getElementById('app'),  // where to render
  tickMs: 250,                           // optional: re-render periodically (countdowns)

  initialState(ctx) {                    // once, when the game starts → initial state
    return { phase: 'play', scores: {} };
  },

  actions: {                             // the only place where state changes
    answer(state, payload, ctx) { /* ... */ },
    timeUp(state, payload, ctx) { /* ... */ },
  },

  playerJoined(state, player, ctx) {},   // optional
  playerLeft(state, player, ctx) {},     // optional

  renderWaiting(ui) {},                  // optional: multiplayer screen before the game starts (HTML string)
  renderSettings(settings, ui) {},       // optional: own lobby settings screen (needs "settingsScreen" in the manifest)
  validateSettings(settings) {},         // optional: return an error message, or nothing if valid

  render(state, ui) {                    // draw the screen; return an HTML string
    return `<h1>Hello ${ui.self?.name ?? ''}</h1>`;
  },
});
```

### 4.1 Before the game starts

* **Solo:** the game starts immediately – no lobby, no settings screen, no countdown.
* **Multiplayer:** the app shows the lobby, waits until the game has loaded on every device, shows a countdown and then calls `initialState`. Until the first state exists, the SDK shows `renderWaiting(ui)` (or a default "Waiting for the game to start" screen).
* **Own lobby settings screen** (multiplayer, only with `"settingsScreen"` in the manifest): `renderSettings(settings, ui)` returns HTML. Inputs with `data-setting="id"` update that setting automatically. `validateSettings(settings)` returns an error text (Start stays disabled) or nothing. `ui.players` shows who has joined so far.

```js
renderSettings(settings, ui) {
  return `<label>Čas na otázku: <input type="range" min="5" max="120" data-setting="questionTime" value="${settings.questionTime}"> ${settings.questionTime} s</label>
          <p>Připojeno hráčů: ${ui.players.length}</p>`;
},
validateSettings(settings) {
  if (settings.questionTime < 10 && settings.questionCount > 30) return 'Too many short questions.';
},
```

* A "pick your character" step or similar belongs to the game itself: make it the first `phase` of your state.

### `ctx` (in `initialState`, `actions`, `playerJoined`, `playerLeft`)

| Name | Description |
| :--- | :--- |
| `ctx.playerId` | Who sent the action (`null` for timers). |
| `ctx.players` | Current players `[{ id, name, isHost, connected }]` (the presenter is not a player). |
| `ctx.items` / `ctx.item(id)` | Items of the study set. |
| `ctx.settings` | Values of the manifest settings. |
| `ctx.mode` / `ctx.hostAs` | `'solo'` / `'multiplayer'`; `'presenter'` / `'player'` / `null`. |
| `ctx.now` | Current time in ms (same clock on all devices). |
| `ctx.random()` / `ctx.shuffle(array)` | Random number 0–1 / shuffled copy of an array. |
| `ctx.after(ms, action, payload?, { key }?)` | Run `action` later. A timer with the same `key` replaces the previous one. |
| `ctx.cancel(key)` | Cancel a timer. |
| `ctx.recordAnswer(itemId, isCorrect, { playerId?, confidence? }?)` | Save learning progress (default player: `ctx.playerId`). Call it for every answered question. |
| `ctx.end({ scores })` | The game is over. `scores` = `{ [playerId]: points }`. |

### `ui` (in `render`)

| Name | Description |
| :--- | :--- |
| `ui.view` | `'solo'`, `'board'` or `'controller'`. |
| `ui.self` | This player (`null` on the board). |
| `ui.players`, `ui.items`, `ui.item(id)`, `ui.settings`, `ui.mode`, `ui.hostAs` | Same as in `ctx`. |
| `ui.timeLeft(deadline)` | Milliseconds until `deadline` (≥ 0), synchronized across devices. |
| `ui.text(markdown, { inline }?)` | Safe HTML for text from the set (Markdown, LaTeX, images). Use `inline: true` inside buttons. |
| `ui.renderNote(note, { titleLevel }?)` | Safe HTML of a whole `note` item. |
| `ui.local` | An object for this screen only (e.g. the currently selected option). Not shared, not saved. |
| `ui.act(name, payload)` | Call an action from your own JavaScript (normally use `data-act`). |
| `ui.escape(text)` | Escape plain text (player names, your own strings) for HTML. |
| `ui.progress` | Learning progress of this player: `{ [itemId]: { bucket: 0-4, ... } }` (empty on the board). Useful to prefer items the player does not know yet. |
| `ui.saved` / `ui.save(scope, value)` | Data saved between games for this player (section 5.2). |
| `ui.setProgress(itemId, { bucket })` | Set this player's progress directly (bucket 0 = new … 4 = mastered), e.g. when the player rates themselves ("I know it / not sure / no idea"). Not available on the board. Prefer `ctx.recordAnswer` when an answer can be checked. |
| `ui.locale` | Language of the app, e.g. `'cs'`. |

---

## 5. State Rules

* Keep the state **small and JSON-only** (numbers, strings, booleans, arrays, plain objects). Store item **IDs**, not whole items.
* Use a `phase` field (`'question'`, `'reveal'`, `'end'` …) and check it at the start of every action.
* For time limits store a **deadline** (`state.deadline = ctx.now + 20000`), schedule `ctx.after(20000, 'timeUp', { round })` and in `timeUp` check that the round still matches.
* A player can leave or join at any time: use `ctx.players`, and never assume a fixed number of players.
* Use player IDs as keys (`state.scores[playerId]`). Show names with `ui.players`.

### 5.1 Limits

The app protects the class network and the server. Exceeding a limit makes the action fail (and the Plugin Lab tests report it):

* **State size:** keep the whole state under **64 KB** as JSON (store IDs, not whole items; no images or long texts).
* **Actions:** at most **30 actions per second** per device. Never call `ui.act` in a loop, in `requestAnimationFrame` or on every mouse move; send the result, not every intermediate step.
* **Timers:** use `ctx.after` with a deadline in the state; do not create an action every second to count down – `render` with `tickMs` shows the countdown.
* The SDK sends only the changes of the state, so a small change of a big state is cheap – but the limit on the total size still applies.
* **Saved data** (section 5.2): at most **256 KB** per scope; save when something meaningful changes (level finished), not on every click.

### 5.2 Saving Progress Between Games

The game state is forgotten when the game ends. To remember something **for the next time** (unlocked levels, coins, best score, chosen avatar), use the player's saved data:

* `ui.saved.plugin` – data for your game across all study sets (e.g. `{ coins: 120, unlocked: ['dragon'] }`),
* `ui.saved.set` – data for your game and the current study set (e.g. `{ level: 4, best: 9800 }`),
* `ui.save('plugin' | 'set', value)` replaces the whole value. Both are `null` until something is saved.

```js
// when the player finishes a level (e.g. in render after state.phase becomes 'levelDone')
const best = ui.saved.set?.best ?? 0;
if (state.score > best) ui.save('set', { ...ui.saved.set, level: state.level + 1, best: state.score });
```

* Saved data belongs to **this player on this device** – the board has none. In multiplayer each player saves their own.
* Use it only for game progress. Learning results go through `ctx.recordAnswer` (or `ui.setProgress`), never through `ui.save`.
* Never store game progress in the study set.

---

## 6. Rendering and Input

`render` returns an HTML string. The SDK updates the page efficiently and keeps focus and typed text in inputs.

* **Buttons:** `<button data-act="answer" data-payload='{"answer":2}'>B</button>` calls the action `answer` with payload `{ answer: 2 }`.
* **Forms:** `<form data-act="submitText"><input name="text"><button>OK</button></form>` calls `submitText` with `{ text: "…" }` on submit.
* Screen-only UI state (selected but not yet submitted option) goes to `ui.local`; call `ui.act` when the player confirms.
* Escape names and your own strings with `ui.escape(text)`; text from the study set always goes through `ui.text`.
* A controller can be a **phone, tablet or computer**: make it responsive, with big buttons (min. 48 px), one column on narrow screens and no hover-only interactions. Design the board for a **projector**: large font, high contrast, visible from the back of the classroom.
* Support light and dark mode: `:root { color-scheme: light dark; }` and use `light-dark()` or `prefers-color-scheme`.

---

## 7. Study Set Items

Every item has `id` and `type`. Common optional fields: `hints`, `explanation`, `tags`, `topic`.

| `type` | Fields to show | Answer for `checkAnswer(item, answer)` |
| :--- | :--- | :--- |
| `mcq-single` | `question`, `options[]` | index of the chosen option |
| `mcq-multi` | `question`, `options[]` | array of chosen indices |
| `true-false` | `question` | `true` / `false` |
| `short-answer` | `question` | typed text |
| `numeric-input` | `question`, `unit?` | number |
| `slider` | `question`, `min`, `max`, `step`, `unit?` | number |
| `sort-items` | `question`, `items[]` (in correct order – shuffle before showing) | array of original indices in the player's order |
| `match-pairs` | `question?`, `prompts[]`, `matches[]` (shuffle matches) | array: for each prompt the index of the chosen match |
| `flashcard` | `front`, `back` | no checking – let the player rate themselves |
| `note` | `title?`, `content`, `hiddenContent?` | no checking – show with `ui.renderNote` |

* `checkAnswer(item, answer)` returns `true`/`false` and applies the rules of the set (case, tolerance, alternative answers). Import it from the SDK.
* Shuffle options only for display; always send **original indices** back.
* Never show `correctIndex`, `correctAnswer` etc. before the reveal phase.

---

## 8. Complete Example

A quiz race: questions with a countdown, faster correct answers give more points. Works in solo, with a presenter board, and with the host playing along.

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
  "pluginVersion": "1.0.0",
  "capabilities": { "actions": ["render"], "types": ["mcq-single", "true-false"], "features": ["markdown", "latex"] },
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
  .board { font-size: 1.6rem; }
  .options { display: grid; gap: 10px; }
  button { font: inherit; font-size: 1.15rem; padding: 14px; border-radius: 12px; border: 2px solid #8884; background: light-dark(#fff, #222); }
  .correct { background: #2e7d32; color: #fff; }
  .wrong { background: #c62828; color: #fff; }
  .timer { font-size: 2rem; font-weight: bold; }
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';

function startQuestion(state, ctx) {
  const seconds = ctx.settings.questionTime;
  state.phase = 'question';
  state.answers = {};
  state.deadline = ctx.now + seconds * 1000;
  ctx.after(seconds * 1000, 'timeUp', { round: state.round }, { key: 'question' });
}

function reveal(state, ctx) {
  state.phase = 'reveal';
  ctx.cancel('question');
  ctx.after(4000, 'next', { round: state.round });
}

defineGame({
  root: document.getElementById('app'),
  tickMs: 250,

  initialState(ctx) {
    const ids = ctx.shuffle(ctx.items).slice(0, ctx.settings.questionCount).map((item) => item.id);
    const state = { questions: ids, round: 0, scores: {}, answers: {}, phase: 'question', deadline: 0 };
    startQuestion(state, ctx);
    return state;
  },

  actions: {
    answer(state, payload, ctx) {
      if (state.phase !== 'question' || !ctx.playerId || state.answers[ctx.playerId]) return;
      const item = ctx.item(state.questions[state.round]);
      const correct = checkAnswer(item, payload?.answer);
      state.answers[ctx.playerId] = { answer: payload.answer, correct };
      if (correct) {
        const total = ctx.settings.questionTime * 1000;
        const left = Math.max(0, state.deadline - ctx.now);
        state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 500 + Math.round(500 * left / total);
      }
      ctx.recordAnswer(item.id, correct);
      const everyone = ctx.players.filter((p) => p.connected).every((p) => state.answers[p.id]);
      if (everyone) reveal(state, ctx);
    },
    timeUp(state, payload, ctx) {
      if (state.phase === 'question' && payload.round === state.round) reveal(state, ctx);
    },
    next(state, payload, ctx) {
      if (state.phase !== 'reveal' || payload.round !== state.round) return;
      if (state.round + 1 >= state.questions.length) {
        state.phase = 'end';
        ctx.end({ scores: state.scores });
        return;
      }
      state.round += 1;
      startQuestion(state, ctx);
    },
  },

  render(state, ui) {
    const item = ui.item(state.questions[state.round]);
    const options = item.type === 'true-false'
      ? [{ label: 'Pravda', answer: true }, { label: 'Nepravda', answer: false }]
      : item.options.map((text, i) => ({ label: ui.text(text, { inline: true }), answer: i }));
    const ranking = [...ui.players].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0));
    const board = ui.view === 'board';

    if (state.phase === 'end') {
      return `<div class="screen ${board ? 'board' : ''}">
        <h1>Konec hry</h1>
        <ol>${ranking.map((p) => `<li>${ui.escape(p.name)}: ${state.scores[p.id] ?? 0}</li>`).join('')}</ol>
      </div>`;
    }

    const seconds = Math.ceil(ui.timeLeft(state.deadline) / 1000);
    const mine = ui.self ? state.answers[ui.self.id] : null;
    const isCorrect = (o) => checkAnswer(item, o.answer);

    return `<div class="screen ${board ? 'board' : ''}">
      <div>Otázka ${state.round + 1} / ${state.questions.length}
        ${state.phase === 'question' ? `<span class="timer">${seconds}</span>` : ''}</div>
      <div>${ui.text(item.question)}</div>
      <div class="options">
        ${options.map((o) => {
          const cls = state.phase === 'reveal' ? (isCorrect(o) ? 'correct' : 'wrong') : '';
          const disabled = board || mine || state.phase !== 'question' ? 'disabled' : '';
          return `<button class="${cls}" ${disabled} data-act="answer" data-payload='${JSON.stringify({ answer: o.answer })}'>${o.label}</button>`;
        }).join('')}
      </div>
      ${board ? `<div>Odpovědělo ${Object.keys(state.answers).length} / ${ui.players.length}</div>` : ''}
      ${mine && state.phase === 'question' ? '<div>Odpověď odeslána ✔</div>' : ''}
      ${state.phase === 'reveal' && mine ? `<div>${mine.correct ? 'Správně! 🎉' : 'Špatně'}</div>` : ''}
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
- [ ] Every action checks `state.phase`, the payload, and duplicates (`state.answers[ctx.playerId]`).
- [ ] No `Math.random()`, `Date.now()`, `fetch`, `localStorage`, `WebSocket` in game logic.
- [ ] Timers use `ctx.after` + a deadline in the state; `render` shows `ui.timeLeft(deadline)`.
- [ ] `ctx.recordAnswer` for every answered question, `ctx.end({ scores })` at the end.
- [ ] Study-set text rendered with `ui.text` / `ui.renderNote`; other text escaped with `ui.escape`.
- [ ] Controllers usable on a phone and on a computer, board readable on a projector.
- [ ] State stays small (IDs instead of items) and no actions are sent in loops or animation frames (section 5.1).
- [ ] Progress between games uses `ui.save` (never `localStorage`); in solo there is no settings screen from the app – player choices are a game phase.

## 10. Common Mistakes

1. Changing state inside `render` or in event listeners instead of in `actions`.
2. Storing whole items or DOM elements in the state.
3. Using `onclick="..."` – functions inside `<script type="module">` are not global, so inline handlers cannot call them; use `data-act`.
4. Assuming the board is a player (it is not in `ctx.players`) or that the host never plays.
5. Revealing the correct answer on controllers before the reveal phase.
6. Forgetting that a player may join late: `state.answers[id]` and `state.scores[id]` may be missing – use `?? 0`.
7. Using `localStorage` – it throws an error inside Memizy; use `ui.save`.
