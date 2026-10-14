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

* **Guide** (also meant to be pasted into an AI assistant): [docs/ai-plugin-guide.md](https://github.com/memizy/memizy/blob/main/docs/ai-plugin-guide.md)
* **Protocol** between plugins and hosts: [@memizy/protocol](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md)

The SDK handles the connection to Memizy, synchronization between devices (board and players), late joining and reconnecting, timers, safe rendering of Markdown/LaTeX/Mermaid, answer checking (`checkAnswer`), learning progress and saved game data.

Opened directly in a browser (without Memizy), a plugin runs in **standalone preview** mode: solo with sample questions. Multiplayer is tested in the Memizy Plugin Lab.

Version 1.0 (release candidates `1.0.0-rc.*` until 1.0.0); the API follows the guide and stays backward compatible within `1.x`.

Changes of every release: [CHANGELOG.md](./CHANGELOG.md).

## Compatibility within 1.x

The contract has three layers, all backward compatible within `1.x`: the protocol between hosts and plugins ([SPEC](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md)), this API (`defineGame`, `ctx`, `ui`, the documented classes and attributes of `ui.question`) and the messages between SDK instances. The devices of one game may run different `1.x` versions of the SDK, so an SDK ignores message types and fields it does not know, and new parts of messages are optional fields (an older SDK ignores them, a newer one keeps the old behaviour without them). State patches carry the version of their format, so even the patch format can change within 1.x (older devices then ask for the full state).

Reserved for the SDK (SPEC 9): action names and timer keys starting with `$`, attributes `data-mz-…`, CSS classes `mz-…`. Fields of the SDK in the game state exist only on request (`phase`, `phaseSeq`, `phaseEndsAt` with `phases`); later ones will be opt-in too.

## Loading and compatibility

* Plugins import `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`: the package's self-contained
  ES module (`dist/bundle/memizy-sdk.bundle.js`, about 66 kB gzipped). Every 1.x release reaches all
  plugins (jsDelivr refreshes the `@1` range within hours), so a plugin never pins an exact version.
* The devices of one game may run different 1.x versions: the SDK's own messages (actions, state
  patches, reveals) only change additively and unknown parts are ignored. The connection to the host
  is Penpal 8 for the whole 1.x line (protocol SPEC, section 4); the SDK adds what Penpal needs on
  older browsers (`Promise.withResolvers`, `Object.hasOwn`), so older school iPads work too.
