# Release 1.0 – what is left

The open items before and right after releasing **1.0.0** of `@memizy/oqse`,
`@memizy/protocol`, `@memizy/plugin-sdk` and `@memizy/host-sdk`. The architecture and the
contract are described in [ARCHITECTURE.md](./ARCHITECTURE.md); finished work is in the
Git history.

Dates: the workshop is 2026-10-22. Publish 1.0.0 at least 1–2 days before the workshop
(the guide imports `@memizy/plugin-sdk@1` from the CDN; `@1` does not match release candidates).
AI plugin testing can run continuously as soon as ready.

## 1. Decisions waiting for the owner

- [x] **Sessions that end on a player's device.** `RelayPlayer` tells the game `sessionEnded`
      (`kicked`, `closed`, `host-left`; once, with a 1 s grace period) before it removes it, also
      when the host takes the game away (`unmount`). SPEC 3.1 defines the host as the application
      on each device (the plugin never sees the transport); SPEC 4.4 no longer mentions the relay.
- [x] **Learning progress in Memizy Play: stays in memory** (owner, 2026-10-14). Play keeps
      progress and plugin data in `MemoryStorage` (only snapshots and saved games persist); fine
      for the workshop. Persistent storage comes with the platform after 1.0.

## 2. Play app & plugins polish

- [x] **URL link parameter `set=none`:** `play.memizy.com/host?plugin=lab&set=none` now recognizes `none`
      as `NO_SET_KEY` instead of reporting "Sadu z odkazu („none“) se nepodařilo najít".
- [x] **Solo & Host-as-player container size:** In `SoloView.vue` (`max-w-3xl`) and `HostView.vue` (`max-w-md`),
      games in solo mode or when the host plays along are constrained to a narrow column. Expand to full
      width (`w-full` / `max-w-6xl` or responsive based on manifest `orientation`), so 3D/landscape games
      (Civhrad, Pirates) have adequate space on desktop.
- [x] **Pirates ship breach appearance:** In `pirates-of-memizy.html`, update the `scorch` texture from a soft
      radial blur to splintered wood planks around the cannonball hole. And maybe also put damage somwhere else on the ship than just where it is now, somewhere more visible on the deck, use Claude in new context for this
- [x] **Alza mascot (Alzák) removal from production:** Avoid trademark/commercial dispute with Alza.cz a.s. on
      `memizy.com` – sanitized to "Kobliha vs. Zelenáč" with cosmic blue antenna tips, removed from public
      `EXAMPLE_PLUGINS` menus, but accessible via direct link (`?plugin=kobliha`).
- [x] **Link to workshop presentation in Play:** Add a link to the presentation slides on Play's home page
      (`HomeView.vue`).

## 3. CI, Web & Deployment (Platform & Engine)

- [ ] **GitHub Actions (Engine):** Add `.github/workflows/ci.yml` in `engine` running `bun run test`, `bun run typecheck`,
      linting and schema validation on pull requests and pushes to `main`.
- [ ] **GitHub Pages for OQSE Validator (Engine):** Host schema validator / documentation tool on Pages.
- [ ] **Migrate Play to Platform repo:** Move `apps/play` into the private `platform` project to keep open-source `engine`
      focused strictly on SDKs, specs and tools.
- [ ] **Astro landing page for memizy.com (Platform):** Create a clean, modern landing page for `https://memizy.com` with links to play.
- [ ] **Deploy Play & Landing Page:** Deploy Memizy Play and landing page (subpaths/subdomains), verify base URLs and CDN links.
- [ ] **Relay server deploy:** Deploy latest relay server (`deploy.sh` on VPS `memizy-vps`).

## 4. Test with AI-made games & Prompts

- [ ] Several games written by different AI assistants from `docs/ai-plugin-guide.md`, through
      the Lab: tests including the naughty player, solo and multiplayer on real phones.
- [ ] Compare models that students will use on following the guide and formulate
      concrete recommendations for workshop attendees.
- [ ] **Fix what the games show (guide first, then the SDK – strictly additive):**
      When AI models make recurring mistakes, improve `docs/ai-plugin-guide.md` first (add concrete
      examples and antipatterns to "Common AI mistakes"). If the SDK is too brittle, add safe fallbacks
      or clearer warnings, but strictly without breaking changes to the frozen 1.0 contract (no renames,
      no removals, no altered method signatures).

## 5. Documentation & Presentation

- [x] SPEC: status 1.0 (2026-10-14), no "RC4" labels; the changelog line "1.0 (2026-10-14)"
      covers everything since RC4 (also `phaseSeq` and `actedAt` in the SDK messages and the
      rule about SDK versions on one game's devices).
- [x] OQSE: "Version 1.0 (2026-10-14)" in `oqse.md`; the sub-specifications point to its changelog.
- [x] `CHANGELOG.md` in every package (1.0.0-rc.6 and rc.5; the plugin-sdk history moved there).
      For 1.0.0: add a "1.0.0" section to each.
- [x] READMEs of the packages: links to files outside the package are GitHub URLs (they work on
      npm); the CDN URLs at `@1`, the JSON Schemas. For 1.0.0: drop "release candidates" from
      the plugin-sdk README.
- [ ] Finish workshop presentation in `docs/presentation/`: check versions, import URLs and API names (`ui.note`, no `/+esm`).

## 6. Release

- [x] `bun run test`, `bun run typecheck`, `cd apps/play && bun run e2e:3d`,
      `bun run build:packages`; generated JSON Schemas committed (rc.6). The packed tarballs were
      installed into an empty project: ESM and CommonJS imports in Node, typings with
      `moduleResolution` `bundler` and `node16` (an ESM project), one copy of the protocol.
- [x] Release candidate **1.0.0-rc.6** (`npm publish --tag next --access public`, in the order
      oqse → protocol → plugin-sdk → host-sdk): published on npm under tag `next`. Check the published packages
      and the SDK bundle from jsDelivr (`…/plugin-sdk@1.0.0-rc.6`) in a browser, as students will use them.
      - **Standalone mode test:** Open an example or AI-generated plugin HTML file directly from disk
        (`file://…`) in the browser (importing `…/plugin-sdk@1.0.0-rc.6`) to verify that standalone mode
        starts cleanly without an iframe/host, loads the sample set, and plays questions.
- [ ] The owner's manual test on phones (iPhone: zoom, 3D; the oldest school device).
- [ ] Version **1.0.0** of all four packages and their dependencies on each other; publish in
      the same order (tag `latest`); check that the CDN `@1` returns the SDK bundle and the schemas.
      - **Standalone mode on CDN `@1`:** Open a plugin HTML file directly in the browser importing the
        official production URL (`https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`) to confirm that
        standalone mode works out-of-the-box for workshop participants.
      - **Switch validator import to CDN `@1`:** In `packages/oqse/docs/index.html`, update import from
        `@memizy/oqse@1.0.0-rc.6` to `@memizy/oqse@1` once 1.0.0 is live on npm.
- [ ] Merge to `main` → Play deploys (Workers); deploy the relay (`deploy.sh`); tag `v1.0.0`.
- [ ] No deployments the day before the workshop; during it: relay logs open
      (`ssh memizy-vps`), a printed QR code and the address.

## 7. Right after 1.0

- [ ] The platform depends on 1.0.0 (`@memizy/oqse`, `@memizy/protocol`, `@memizy/host-sdk`)
      instead of `@memizy/plugin-sdk` 0.3 / `@memizy/multiplayer-sdk`; it stores answers by the
      OQSE Answer Formats.
- [ ] Convert the course sets to OQSE 1.0: `bun scripts/migrate-oqse/cli.ts <dir>` (dry run),
      then `--apply`.
- [ ] Authoring shorthand for questions: move `upgradeItem` / `normalizeAiAnswer` from
      `apps/play/src/lib/aiSets.ts` into `@memizy/oqse` as a documented, tested function
      (`compileShorthand`), used by Play, the platform and scripts; IDs kept across edits
      (OQSE "Canonical and Authoring Formats").
- [ ] **Rich content in the SDK (additive, from the final contract audit):**
      - `latexPackages`: load KaTeX's `mhchem` extension when a set declares it (today `\ce{…}`
        renders as a KaTeX error).
      - YouTube / Vimeo videos (OQSE allows them): an embed player in `ui.text` and a CSP
        `frame-src` for the privacy-friendly embed origins (today a `<video>` that cannot play
        and `frame-src 'none'`).
      - `http:` media: OQSE accepts them with a warning, the plugin CSP allows only `https:`
        images and media; decide between allowing them and upgrading the URLs to `https:`.
      - LaTeX inside inline code (`` `$x$` ``) is rendered as a formula; protect code spans
        before replacing math.
- [ ] **Typings for CommonJS TypeScript projects:** the packages are ESM with a CommonJS build;
      `require` works at runtime, but a TypeScript project compiled to CommonJS with
      `moduleResolution: node16` gets TS1479 (the `.d.ts` are ESM). Emit `.d.cts` for the
      `require` condition if a consumer needs it.
- [ ] **`GameHandle` for code outside `render` (additive):** `game.setLocal(patch)`, `game.ui` /
      `game.state` (read-only), so that document listeners, timers and 3D scenes need not keep
      `ui` in a global (Civhrad `G.ui`, Pirates `view.ui`). Perhaps `data-act-on="pointerdown"`
      for actions where the tap time matters (Pirates fires on `pointerdown` itself).
- [ ] **AI tooling & micro-prompts (discussion):** Consider dedicated AI tooling (e.g. `@memizy/ai` or
      platform/CLI helpers) that export modular micro-prompts and partial JSON Schemas on demand
      (e.g. generating specific question types like `match-pairs` or `sort-items` without prompt bloating).
- Planned features: [ARCHITECTURE.md, section 7](./ARCHITECTURE.md#7-after-10).