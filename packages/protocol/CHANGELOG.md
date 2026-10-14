# Changelog of @memizy/protocol

The protocol has its own changelog at the end of [SPEC.md](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md#changelog) (protocol 1.0, 2026-10-14). This file lists the releases of the npm package.

## 1.0.0-rc.6 (2026-10-14)

The contract of protocol 1.0 is final: within MAJOR 1 it changes only additively (SPEC 9).

* SPEC status 1.0; the "RC4" labels are gone.
* The address `"settings"` (`SETTINGS_ADDRESS`, the plugin's settings screen in the lobby) is defined in SPEC 3.1 and on the `Address` type.
* `hello` is called once per instance: a second call rejects with `INVALID_ARGUMENT`. Only the first `end(result)` counts; later calls (also from a recreated authority) resolve and are ignored.
* Guaranteed rates and sizes in SPEC 8.1 and `LIMITS`: `recordAnswer` 10 per second, burst 20 (`answersPerSecond`, `answerBurst`; the authority: per player), `getAsset` 10 per second, burst 20, and 2 MB per asset (`assetsPerSecond`, `assetBurst`, `assetBytes`), `reportError` 5 per second, burst 10, more dropped without an error (`errorReportsPerSecond`, `errorReportBurst`), and `serviceResultBytes` (256 KB, the service result limit that was already in the SPEC).
* `RELAY_LIMITS.frameBytes` (in `@memizy/protocol/internal`) is 3 MB, so that a 2 MB asset fits a relay frame as base64.
* Since 1.0.0-rc.5 (details in the SPEC changelog "1.0"): the term *host* (3.1) and `sessionEnded` before a player's instance is removed (`kicked`, `closed`, `host-left`); `exit`, `resize`, `setChanged` and `saveProgress` removed and reserved (SPEC 10); `InitPayload.services` and all `SessionClock` fields always present; the relay type `RoomPlayer`; state patches carry their format (`f`); reserved names `$…`, `data-mz-…`, `mz-…`; the `@memizy/protocol/internal` entry point (not public API); Zod 4 for the 1.x line; the error code `UNKNOWN_METHOD`; the sandbox allows popups that escape it (links in a new tab); `appSpecific.memizy.set`; OQSE 1.0 sets and OQSEM 1.0 manifests.

## 1.0.0-rc.5

Protocol RC4 as a package: handshake, views and authority, messages, learning progress, plugin data, services, pauses, permissions with a content policy, display order and public items, limits and errors.
