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
