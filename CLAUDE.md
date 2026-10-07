# Memizy engine – notes for Claude Code

Open-source engine of Memizy (GitHub `memizy/memizy`): the OQSE study-set format, the
plugin protocol, the SDKs, the relay multiplayer server and Memizy Play (Lab + hosting).
The commercial platform lives next door in `../platform` and should use this engine as
its library (see "Using the engine from the platform").

## Working with the owner

- Talk to the owner in **Czech**; code, comments, commits and docs are in **English**.
- Work on a **feature branch** (never commit to `main`). The owner merges with
  `git merge --ff-only <branch>` and pushes; give them the commands at the end.
  Base a new branch on the newest unmerged branch if earlier work is not merged yet.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ask before starting long-running local servers (dev server, relay) – the machine has
  limited memory. Tests and builds are fine without asking.
- Product decisions already made: players always get **random nicknames** (no name
  editing, GDPR); no modal after a correct answer (a short toast instead); a review screen
  after a wrong answer is liked; fairness model "a lone player counts as the whole crew"
  (a smaller team's hits, repairs and shop items are multiplied by `bigger / own`).
- The contract is **Release Candidate 4** (frozen for the workshop, 2026-10-22; 1.0 after it). Change it only additively, record every change
  in the SPEC changelog and in the AI guide.

## Layout

| Path | What |
| :--- | :--- |
| `packages/oqse` | OQSE 0.2 types, Zod validation (`loadOQSEFile` tolerant, `safeValidateOQSEFile` strict), Markdown sets, compatibility. |
| `packages/protocol` | The plugin protocol: `SPEC.md` (normative), manifest/settings schemas, limits, errors, relay wire types, `prepareDisplaySet` (display order + public items). |
| `packages/plugin-sdk` | What plugins import: `defineGame` (state, actions, timers, sync, snapshots, `ui.pending`, `ctx.reveal`), morph renderer, `checkAnswer`, standalone mode. Bundle served as `/sdk/memizy-sdk.js` by Play. |
| `packages/host-sdk` | What hosts use: `loadPluginFromHtml`, `prepareSetForPlugin`, `LocalSession` (validates every call, routing, start barrier, authority, storage), `mountPlugin` (sandboxed iframe + Penpal), `RelayHost` / `RelayPlayer` (multiplayer over the relay). |
| `services/multiplayer-server` | Relay: rooms by PIN, host token, bundle store, WebSocket routing, rate limits. Bun; deployed with Docker + Cloudflare Tunnel (`deploy/`). |
| `apps/play` | Memizy Play (Vue 3 + Tailwind + vue-i18n): Lab (write/test plugins, AI question sets), host and join pages. Example plugins in `src/data/plugins`, sample sets in `src/data/sets`. |
| `docs/ai-plugin-guide.md` | The guide students paste into their AI (rules, API, item table, full example). The Lab copies it into prompts. |
| `docs/ARCHITEKTURA-A-PLAN.md` | Architecture and plan (Czech). `docs/presentation/` = the workshop talk. |
| `docs/PLAN-RC4.md` | **Current plan** (Czech): RC4 contract, SDK additions, decisions and what is reserved. Check it before changing the contract. |

## Commands

```bash
bun install
bun run build:packages          # oqse → protocol → plugin-sdk → host-sdk (dist is what the others import)
bun run test                    # builds packages, then every workspace's tests
cd apps/play && bun run test    # vitest (jsdom); bun run typecheck = vue-tsc
cd services/multiplayer-server && bun test
bun run dev:play                # Play on http://localhost:5180/play/ (ask first)
bun run dev:server              # relay on :8787 (ask first)
```

After changing a package, rebuild it (`bun run build:packages`) before testing the apps.

## How a game runs (the contract in one page)

- A **plugin** is one HTML file with a manifest (`<script type="application/oqse-manifest+json">`)
  and a module script that calls `defineGame` once. It runs in a sandboxed iframe
  (no same-origin: no storage, no network to the host).
- **Authority** = the instance that runs the rules: the board (`hostAs: 'presenter'`), the
  host's own controller (`hostAs: 'player'`) or the solo player. Everyone else sends
  actions (`data-act` / `ui.act`) and applies state patches. Followers accept state only
  from the authority's address.
- **Relay**: the server only forwards. A room has a PIN and a secret `hostToken` (only
  the creator can host or upload the bundle). Players can only send `up` (to the host)
  and `rename`; the server stamps the sender. The host machine runs the `LocalSession`
  (and so the authority); players' devices run the plugin and talk to it through
  `RelayPlayer`. Players download the bundle (plugin HTML + public set) once.
- **Display order and hidden answers (SPEC 4.4)**: the host shuffles options, pairs,
  orders… once per game with a seed (`LocalSession` uses the session id or
  `shuffleSeed`). The authority and solo get full items in that order; other instances
  in multiplayer get **public items** (`answerHidden: true`, answer fields removed). The
  authority shows answers with `ctx.reveal(itemId, { to? })`. `checkAnswer` runs in
  actions and understands `correctOrder` / `correctMatches`. Upload `prepared.publicSet`
  to the relay, never the full set.
- OQSE 0.3: choices `{ id, text }`, answers by ID, `skills`; 0.2 files are refused
  (`scripts/migrate-oqse-0.3.ts` converts them once).
- RC4 protocol: `recordAnswer.answer` and generated items, pauses (`SessionClock`),
  `permissions` (CSP + device grants), `service()` + `InitPayload.services`; SPEC §10
  lists decisions and reserved names – read it before extending the contract.
- SDK: `phases` + `ctx.goto`, `ui.html` (escaping templates), `ui.question` (ready-made
  controls), `playerView`, `ui.setLocal`, `ctx.reveal` / `ctx.hide`, `ui.service`,
  `createScene3d` (3D helper), plus older `ui.pending`, `afterRender`, `data-keep`,
  `data-key`, snapshots, `ctx.fromHost`. The Lab tests include a "naughty player".

## Testing tips

- Game rules without a browser: extract the plugin's module script, replace the SDK
  import with `{ defineGame: capture, checkAnswer }` and run the definition in
  `FakeSession` (`packages/plugin-sdk/src/test/fakeHost.ts`); see
  `apps/play/src/lib/babis.rules.test.ts`.
- Screens without servers: Playwright (`playwright-core`, `channel: 'msedge'`) with
  `page.route('https://cdn.jsdelivr.net/**')` fulfilled by
  `packages/plugin-sdk/dist/bundle/memizy-sdk.bundle.js` and the plugin HTML served
  from a routed URL (standalone solo mode).
- Real sessions in jsdom: `packages/host-sdk/src/session.test.ts` connects real SDK games
  to a `LocalSession`; `relay.test.ts` starts the relay server.

## Gotchas found the hard way

- Vue reactive proxies cannot be `structuredClone`d or stored in IndexedDB: keep sets
  in `shallowRef`; `LocalSession` copies the set plainly anyway.
- vue-i18n: `{` in a message is a placeholder – never put JSON in translations
  (`apps/play/src/i18n/messages.test.ts` compiles every message).
- Morph matches children by `id` / `data-key`; moving focused nodes blurs inputs (the
  keyed logic avoids moves). Draft proxies in actions are revoked afterwards: the SDK
  detaches what goes to `ctx.end` / `ctx.after` / `recordAnswer`.
- iOS Safari: `touch-action: manipulation` on the page and the iframe (double-tap zoom);
  re-measure the canvas on tap/frame (toolbars resize the page).
- Git Bash mangles complex heredocs with quotes: write patch scripts to a file.

## Deployment

- Play: Cloudflare Workers static assets (`apps/play/wrangler.jsonc`), domain
  `play.memizy.com`. Build: `bun install && bun run build:packages && cd apps/play && bun run build`
  with `PLAY_BASE=/`, `VITE_RELAY_URL=https://mp.memizy.com`; deploy `npx wrangler deploy`.
  Deploys from `main` on push.
- Relay: `mp.memizy.com` = Docker compose (`relay` + `cloudflared`, no published ports)
  on a Netcup Debian server reachable over Tailscale (`ssh memizy-vps`, user `agent`).
  `services/multiplayer-server/deploy/deploy.sh` bundles and restarts it. Never put the
  tunnel token in chat or in the repo.

## Using the engine from the platform

The platform (`../platform`, e.g. `memizy-app`) should not reimplement any of this:

1. Depend on `@memizy/oqse`, `@memizy/protocol`, `@memizy/host-sdk` (workspace link or
   published `1.0.0-rc.3`); serve the plugin-sdk bundle (or use the CDN URL plugins import).
2. Load plugins with `loadPluginFromHtml`, sets with `loadOQSEFile`, and run games with
   `LocalSession` + `mountPlugin` (solo, Lab-like previews) or `RelayHost` (multiplayer;
   upload `prepareSetForPlugin(set, manifest, { seed }).publicSet` and pass the same seed
   as `shuffleSeed`). Players join through `RelayPlayer`.
3. Persist with a `HostStorage` implementation (progress, plugin data, snapshots) backed
   by the platform's database instead of `MemoryStorage` / IndexedDB.
4. Memizy Play (`apps/play`) is the reference host: copy its flows (HostView, JoinView,
   LabView) rather than inventing new ones.
5. Future server authority (official games): run the same `LocalSession` / plugin rules
   on the server; `prepareDisplaySet` and the address `"server"` are ready for it.
