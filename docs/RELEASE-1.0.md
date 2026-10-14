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

## 2. Test with AI-made games (2026-10-19/20)

- [ ] Several games written by different AI assistants from `docs/ai-plugin-guide.md`, through
      the Lab: tests including the naughty player, solo and multiplayer on real phones.
- [ ] Fix what the games show (guide first, then the SDK), only additively.

## 3. Documentation

- [ ] SPEC status: "1.0" instead of "Release Candidate 4"; the changelog line "1.0 (unreleased)"
      gets the date, and covers everything since RC4 (also `phaseSeq` and `actedAt` in the
      SDK messages and the rule about SDK versions on one game's devices).
- [ ] OQSE: date of "Version 1.0" in `oqse.md`; the sub-specifications (`oqse-manifest.md`,
      `oqse-progress.md`, `oqse-header.md`) have no changelog – add a line pointing to the one in
      `oqse.md`, or their own.
- [ ] `CHANGELOG.md` in every package, starting with 1.0.0 (the plugin-sdk README has the RC history).
- [ ] READMEs of the packages: version 1.0, the CDN URLs at `@1`, the JSON Schemas.
- [ ] `docs/presentation/`: check versions, the import URL and API names (`ui.note`, no `/+esm`).

## 4. Release

- [ ] `bun run test`, `cd apps/play && bun run typecheck`, `cd apps/play && bun run e2e:3d`,
      `bun run build:packages`; generated JSON Schemas committed.
- [ ] Release candidate **1.0.0-rc.6** (`npm publish --tag next --access public`, in the order
      oqse → protocol → plugin-sdk → host-sdk): check the published packages and the SDK bundle
      from jsDelivr (`…/plugin-sdk@1.0.0-rc.6`) in a browser, as students will use them.
- [ ] The owner's manual test on phones (iPhone: zoom, 3D; the oldest school device).
- [ ] Version **1.0.0** of all four packages and their dependencies on each other; publish in
      the same order (tag `latest`); check that the CDN `@1` returns the SDK bundle and the schemas.
- [ ] Merge to `main` → Play deploys (Workers); deploy the relay (`deploy.sh`); tag `v1.0.0`.
- [ ] No deployments the day before the workshop; during it: relay logs open
      (`ssh memizy-vps`), a printed QR code and the address.

## 5. Right after 1.0

- [ ] The platform depends on 1.0.0 (`@memizy/oqse`, `@memizy/protocol`, `@memizy/host-sdk`)
      instead of `@memizy/plugin-sdk` 0.3 / `@memizy/multiplayer-sdk`; it stores answers by the
      OQSE Answer Formats.
- [ ] Convert the course sets to OQSE 1.0: `bun scripts/migrate-oqse/cli.ts <dir>` (dry run),
      then `--apply`.
- Planned features: [ARCHITECTURE.md, section 7](./ARCHITECTURE.md#7-after-10).
