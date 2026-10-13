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

* **`LocalSession`** – runs a game: validates every plugin call (schemas, size and rate limits, views, authority), routes messages, runs the start barrier and countdown, handles authority outages (`setConnected`), reloads (`reload`), late joining (`addPlayer`), snapshots, learning progress and plugin data. Instances are mounted in this page (`mountPlugin`) or on players' devices (`RelayHost`).
* **`RelayHost` / `RelayPlayer`** – multiplayer across devices through the relay server (below).
* **`HostStorage`** – plug in your persistence (`MemoryStorage` for the Lab and tests).
* **`LearningAlgorithm`** – how answers change learning progress (`leitner` by default).
* **`prepareSetForPlugin`** – keeps only the item types the plugin declares, puts options, pairs… in display order (seeded) and makes the public copy without answers (SPEC 4.4). Which plugins can play a set: `checkCompatibility` in `@memizy/oqse`.
* **`HOST_SDK_VERSION`** – the version of this package (sent to plugins in `hello`).

The exports listed in `src/index.ts` are the public API; everything else is internal. Without `config.locale` the host uses `'en'`.

## Multiplayer over the relay

```ts
import { RelayHost, RelayPlayer, LocalSession, prepareSetForPlugin } from '@memizy/host-sdk';

// The host (teacher's machine) runs the session, and so the authority.
const host = await RelayHost.create({ serverUrl: 'https://mp.memizy.com' });   // room with a PIN
const seed = crypto.randomUUID();
await host.uploadBundle(pluginHtml, prepareSetForPlugin(set, plugin.manifest, { seed }));
// …players join, then:
const session = new LocalSession({ plugin, set, mode: 'multiplayer', hostAs: 'presenter',
  players: host.players.map((p) => ({ id: p.id, name: p.name })), shuffleSeed: seed });
host.attach(session); // players' instances connect through the relay
await session.start();

// A player's device: downloads the bundle once and runs the plugin locally.
const player = new RelayPlayer({ serverUrl: 'https://mp.memizy.com', pin, name: nickname, container: () => element });
```

`uploadBundle` takes the `PreparedSet` and uploads only its `publicSet`: anyone with the PIN can download the bundle, so answers never leave the host. Use the same seed for the bundle and `shuffleSeed`, so every device shows the same order. Memizy Play (`apps/play`, `HostView` and `JoinView`) is the reference host.

Iframes are sandboxed with `allow-scripts allow-forms allow-modals allow-pointer-lock` and **never** `allow-same-origin`.
