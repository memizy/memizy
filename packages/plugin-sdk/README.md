# @memizy/plugin-sdk

Build **Memizy learning games** – solo and multiplayer – in a single HTML file.

```html
<script type="module">
  import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';

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

* **Unreleased (after 1.0.0-rc.4):**
  * `ui.question(item, { counts })` – how many players chose each option, as a badge on the option (choice types).
  * Timed phases re-render on their own (the `ui.timeLeft()` countdown runs without `tickMs`; `tickMs` stays for own animations).
  * `data-local="name"` + `defineGame({ local: { name(local, payload, ui) { … } } })` – device-only clicks (tabs, a 2D/3D switch) that change `ui.local` and re-render.
  * `createScene3d`: a black or slow scene switches to 2D at most once per page (the player's return to 3D is respected); `onFallback(reason, { kind })`; a game without `onFallback` stays 3D and shows a message only when 3D cannot run at all.
  * No zoom on phones: the SDK locks the viewport, stops pinch gestures and double-tap zoom and keeps text fields at least 16 px on touch screens (iOS zooms into smaller fields).
  * Removed `ui.escape` – `ui.html` escapes.
