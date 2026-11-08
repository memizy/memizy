# Changelog of @memizy/protocol

The protocol has its own changelog at the end of [SPEC.md](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md#changelog) (protocol 1.0, 2026-10-14). This file lists the releases of the npm package.

## 1.1.0 (unreleased)

* Personal sets (SPEC 3.4): manifest `modes.multiplayer.sets`, `PluginRuntime.multiplayer.sets`, `SessionInfo.sets`, `Player.set`.
* `HostApi.markItem(itemId, { starred })` (player views): a star from inside a game (SPEC 5).
* `HostApi.pickItems` with `PickItemsRequest` (`PickItemsRequestSchema` in the call schemas) and the feature `PICK_ITEMS_FEATURE` (`pick-items`): the host chooses the next items of a player by their progress (SPEC 5.4). A read note is recorded like a right answer (SPEC 5.1).
* Protocol 1.1 (`PROTOCOL_VERSION`): `PluginApi.finishRequested` (optional; in `PLUGIN_API_METHODS`) and the feature constant `FINISH_REQUEST_FEATURE` (`'finish-request'`). Additive.

## 1.0.0 (2026-10-21)

The first stable release: the contract of 1.0.0-rc.7, unchanged. From now on 1.x versions only add (see the README).

## 1.0.0-rc.7 (2026-10-16)

* `InitPayload.seed`: a secret seed for the game's random numbers, only for the authority (SPEC 4.2, 8.4). Before, the SDK seeded `ctx.random` with the session id, which every device knows – a player could compute a shuffled deck.
* Public items lose media that only hidden fields use (also in the public set's `meta.assets`); choice IDs are opaque to games, and a host may give per-session IDs (SPEC 4.4).
* `prepareDisplaySet` shuffles each item with its own seed (the seed and the item ID): editing, adding or removing an item, or a part of a set, never changes the order of the other items (SPEC 4.4).
* `recordAnswer` is an *authority* method (SPEC 5). The display order uses a secret, random seed (SPEC 4.4; not the session id).
* SPEC: the Penpal 8 wire format (4); a host may give a game a part of a large set (4.2); answers to `open-ended` items do not change repetition, games record the first attempt (5.1); Zod: only `parse` / `safeParse` of the exported schemas are covered (9).
* Public items keep only the fields the OQSE schema of their type lists (fail closed): unknown fields – also of choices, zones and other nested objects – and free-form `appSpecific` / `customData` are removed, so a field of a later OQSE version can never reveal an answer on players' devices (SPEC 4.4). Custom `x-` types keep their fields except `solution`.
* Settings of a type from a later protocol version: a manifest may declare them (`UnknownSettingSchema`, needs `id`, `label`, `default`); `PluginRuntime.unknownSettings` lists them, `resolveSettings(definitions, input, unknownSettings)` gives them their default; `isKnownSetting`, `SETTING_TYPES`. `SettingValue` may be any JSON value.
* `AnswerRecord.score` (partial credit 0–1).
* SPEC: `InitPayload.set` holds the questions of this instance (4.2); the two axes of questions (10, decided); reserved: personal sets (`modes.multiplayer.sets`, feature `personal-sets`, `Player.set`), `pickItems`, `openSource`, `markItem` (10).

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
