# Release 1.0 – what is left

The open items before and right after releasing **1.0.0** of `@memizy/oqse`,
`@memizy/protocol`, `@memizy/plugin-sdk` and `@memizy/host-sdk`. The architecture and the
contract are described in [ARCHITECTURE.md](./ARCHITECTURE.md); finished work is in the
Git history.

Dates: test with AI-made games 2026-10-19/20, the workshop 2026-10-22. Publish 1.0.0 at
least 1–2 days before the workshop (the guide imports `@memizy/plugin-sdk@1` from the CDN;
`@1` does not match release candidates).

## 1. Decisions waiting for the owner

- [ ] **Sessions that end on a player's device.** When the relay closes a room (the host was
      away for 10 minutes, the host closed it) or kicks a player, `RelayPlayer` removes the
      game without calling `sessionEnded`, so the reasons `host-left` and `kicked` never reach
      a game. Proposal: `RelayPlayer` calls `sessionEnded` (`kicked`, `closed`, `host-left`)
      before it removes the game; SPEC 6.1 says the host *or the relay* ends the session
      (today it says the host does, which no host implements). Additive, no contract change.
- [ ] **Learning progress in Memizy Play.** Play stores progress and plugin data in memory
      only (`MemoryStorage`; only snapshots and saved games are persistent), so a student who
      plays alone in Play loses the Leitner progress and `ui.save` data when the page closes.
      Fine for the workshop (the platform will own progress); otherwise an IndexedDB
      `HostStorage` in Play.

## 2. Play app & plugins polish

- [x] **URL link parameter `set=none`:** `play.memizy.com/host?plugin=lab&set=none` now recognizes `none`
      as `NO_SET_KEY` instead of reporting "Sadu z odkazu („none“) se nepodařilo najít".
- [ ] **Solo & Host-as-player container size:** In `SoloView.vue` (`max-w-3xl`) and `HostView.vue` (`max-w-md`),
      games in solo mode or when the host plays along are constrained to a narrow column. Expand to full
      width (`w-full` / `max-w-6xl` or responsive based on manifest `orientation`), so 3D/landscape games
      (Civhrad, Pirates) have adequate space on desktop.
- [ ] **Pirates ship breach appearance:** In `pirates-of-memizy.html`, update the `scorch` texture from a soft
      radial blur to splintered wood planks around the cannonball hole.
- [ ] **Alza mascot (Alzák) removal from production:** Avoid trademark/commercial dispute with Alza.cz a.s. on
      `memizy.com` – remove `babis-vs-alzak.html` from `EXAMPLE_PLUGINS` in production or replace the mascot
      with a generic alien without Alza branding.
- [ ] **Link to workshop presentation in Play:** Add a link to the presentation slides on Play's home page
      (`HomeView.vue`).

## 3. CI, Web & Deployment

- [ ] **GitHub Actions:** Add `.github/workflows/ci.yml` running `bun run test`, `bun run typecheck` and
      `apps/play` build on pull requests and pushes to `main`.
- [ ] **Astro landing page for memizy.com:** Create a clean, modern landing page for `https://memizy.com` with only links for play
- [ ] **Deploy Play to subpath / subdomain:** Deploy Memizy Play to `memizy.com/play/` or think of the route where it should be,
      verify base URL routing, assets and CDN links.
- [ ] **Relay server deploy:** Deploy latest relay server (`deploy.sh` on VPS `memizy-vps`).

## 4. Test with AI-made games & Prompts (2026-10-19/20)

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

- [ ] SPEC status: "1.0" instead of "Release Candidate 4"; the changelog line "1.0 (unreleased)"
      gets the date, and covers everything since RC4 (also `phaseSeq` and `actedAt` in the
      SDK messages and the rule about SDK versions on one game's devices).
- [ ] OQSE: date of "Version 1.0" in `oqse.md`; the sub-specifications (`oqse-manifest.md`,
      `oqse-progress.md`, `oqse-header.md`) have no changelog – add a line pointing to the one in
      `oqse.md`, or their own.
- [ ] `CHANGELOG.md` in every package, starting with 1.0.0 (the plugin-sdk README has the RC history).
- [ ] READMEs of the packages: version 1.0, the CDN URLs at `@1`, the JSON Schemas.
- [ ] Finish workshop presentation in `docs/presentation/`: check versions, import URLs and API names (`ui.note`, no `/+esm`).

## 6. Release

- [ ] `bun run test`, `cd apps/play && bun run typecheck`, `cd apps/play && bun run e2e:3d`,
      `bun run build:packages`; generated JSON Schemas committed.
- [ ] Release candidate **1.0.0-rc.6** (`npm publish --tag next --access public`, in the order
      oqse → protocol → plugin-sdk → host-sdk): check the published packages and the SDK bundle
      from jsDelivr (`…/plugin-sdk@1.0.0-rc.6`) in a browser, as students will use them.
      - **Standalone mode test:** Open an example or AI-generated plugin HTML file directly from disk
        (`file://…`) in the browser (importing `…/plugin-sdk@1.0.0-rc.6`) to verify that standalone mode
        starts cleanly without an iframe/host, loads the sample set, and plays questions.
- [ ] The owner's manual test on phones (iPhone: zoom, 3D; the oldest school device).
- [ ] Version **1.0.0** of all four packages and their dependencies on each other; publish in
      the same order (tag `latest`); check that the CDN `@1` returns the SDK bundle and the schemas.
      - **Standalone mode on CDN `@1`:** Open a plugin HTML file directly in the browser importing the
        official production URL (`https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1`) to confirm that
        standalone mode works out-of-the-box for workshop participants.
- [ ] Merge to `main` → Play deploys (Workers); deploy the relay (`deploy.sh`); tag `v1.0.0`.
- [ ] No deployments the day before the workshop; during it: relay logs open
      (`ssh memizy-vps`), a printed QR code and the address.

## 7. Right after 1.0

- [ ] The platform depends on 1.0.0 (`@memizy/oqse`, `@memizy/protocol`, `@memizy/host-sdk`)
      instead of `@memizy/plugin-sdk` 0.3 / `@memizy/multiplayer-sdk`; it stores answers by the
      OQSE Answer Formats.
- [ ] Convert the course sets to OQSE 1.0: `bun scripts/migrate-oqse/cli.ts <dir>` (dry run),
      then `--apply`.
- Planned features: [ARCHITECTURE.md, section 7](./ARCHITECTURE.md#7-after-10).
