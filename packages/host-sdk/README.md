# @memizy/host-sdk

Run Memizy plugins in a host application (the Memizy app, the Plugin Lab): load and validate plugins, mount them in sandboxed iframes, enforce the [Memizy Plugin Protocol](../protocol/SPEC.md) and run game sessions.

```ts
import { loadOQSEFile } from '@memizy/oqse';
import { loadPluginFromHtml, LocalSession, mountPlugin } from '@memizy/host-sdk';

const loaded = loadPluginFromHtml(html);            // manifest validated without running the plugin
if (!loaded.success) throw new Error(loaded.errors.join('\n'));

const session = new LocalSession({
  plugin: loaded.plugin,
  set: loadOQSEFile(setJson).data!,
  mode: 'multiplayer',
  hostAs: 'presenter',
  players: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }],
});
session.on((event) => console.log(event));        // ready, countdown, answer, ended, traffic, rejected…

await mountPlugin(session, 'board', boardElement); // sandboxed iframe + Penpal
await mountPlugin(session, 'anna', annaElement);
await mountPlugin(session, 'ben', benElement);
await session.start();                              // waits for everyone, countdown, start
```

* **`LocalSession`** – all instances in one page (Lab, solo games in the app). Validates every plugin call (schemas, size and rate limits, views, authority), routes messages, runs the start barrier and countdown, handles authority outages (`setConnected`), reloads (`reload`), late joining (`addPlayer`), snapshots, learning progress and plugin data. Multiplayer across devices will use the same API with a relay transport.
* **`HostStorage`** – plug in your persistence (`MemoryStorage` for the Lab and tests).
* **`LearningAlgorithm`** – how answers change learning progress (`leitner` by default).
* **`prepareSetForPlugin` / `checkCompatibility`** – keep only item types the plugin supports, decide which plugins can play a set.

Iframes are sandboxed with `allow-scripts allow-forms allow-modals allow-pointer-lock` and **never** `allow-same-origin`.
