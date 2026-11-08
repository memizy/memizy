# Changelog of @memizy/host-sdk

## 1.0.1 (unreleased)

* Relay connections that die without a close are found and replaced. A phone that slept or switched networks kept a socket that looked open but carried nothing (half-open), so the player stayed out of the game until the operating system gave up on it, often minutes. Now a heartbeat pings every 15 s and drops a connection that hears nothing back within 8 s; `RelayPlayer.reconnectNow()` on an open connection checks it within 4 s; a connection attempt that is not attached after 10 s starts again. Applies to `RelayHost` and `RelayPlayer`; the new connection attaches with the same token, so the player keeps their place.

## 1.0.0 (2026-10-21)

The first stable release: the contract of 1.0.0-rc.7, unchanged. From now on 1.x versions only add (see the README).

## 1.0.0-rc.7 (2026-10-16)

* `LocalSession` gives the authority a secret random seed (`InitPayload.seed`; `SessionConfig.seed` only for replays and tests).
* The default seed of the display order (`shuffleSeed`) is random, no longer the session id: a player knows the session id and could undo the shuffle (authors often write sets in the answer's order). Pass the same `shuffleSeed` to continue a saved game.
* `getAsset` gives a player's instance in multiplayer only media of its own (public) set: media of the back of a flashcard or of an explanation can no longer be fetched by key.
* `recordAnswer` is accepted only from the authority (SPEC 5): another instance cannot prove an answer, so a modified player's device cannot write "correct" into a teacher's statistics.
* Answers to `open-ended` items are kept, not graded: the `answer` event has `ungraded: true` and no record, the learning progress is unchanged. Every `answer` event carries `setId` (an item is identified by set + item ID).
* `prepareSetForPlugin` leaves out items whose `mustUnderstand` names properties this version does not support.
* `leitner` keeps the learner's `starred` and fields of a later OQSEP version (also in `stats`) and stores the answer as `lastAnswer.answer`; the `LearningAlgorithm` contract says so.
* `LocalSession` gives settings of a later protocol version their default and ignores values sent for them.
* Public items of a session come from the new fail-closed `publicItem` of `@memizy/protocol`.

## 1.0.0-rc.6 (2026-10-14)

Enforces the final protocol 1.0 ([SPEC](https://github.com/memizy/memizy/blob/main/packages/protocol/SPEC.md)).

* `LocalSession` enforces the protocol rules: a second `hello` of an instance rejects with `INVALID_ARGUMENT`; only the first `end(result)` emits `result`; `recordAnswer` (per player for the authority) and `getAsset` are rate-limited (`RATE_LIMITED`); `reportError` beyond its rate is dropped; service results use `LIMITS.serviceResultBytes`.
* `RelayHost` refuses a result too large for a relay frame with `DATA_TOO_LARGE` (such a frame would close the host's connection); a 2 MB asset fits.
* `RelayPlayer` ignores a repeated `mount` of the same generation (the host repeats it when a device reconnects while loading) and confirms it again, so the game is not loaded twice.
* `RelayPlayer` tells the game `sessionEnded` (`kicked`, `closed`, `host-left`; once, with a 1 s grace period) before it removes it, also when the host takes the game away (`unmount`).
* Since 1.0.0-rc.5:
  * Saving and continuing games: `SessionConfig.restore`, `HostStorage.deleteSnapshot?`, a finished game deletes its snapshot (late saves stay in memory only); `RelayHost.attach(session, { seats, taken })`, `assignSeat`, `seats`, `seatAssignments`, the `seats` event; `RelayPlayer.seat` and `claimSeat()`; `RelayHost.rejoin`.
  * `LearningAlgorithm.apply(previous, answer, now, item)` gets the answered item.
  * Relay compatibility: `RELAY_APP_VERSION` in `hello` / `mount`, `RelayHost.appVersionOf`; calls of unknown methods answer `UNKNOWN_METHOD`; `join.auth` reaches the host only (`RoomPlayer.auth`).
  * The sandbox adds `allow-popups allow-popups-to-escape-sandbox` (never `allow-top-navigation`).
  * Renamed without aliases: `SessionConfig.resume` → `restore`, `RelayHost.resume` → `rejoin`, the session event `ended` → `result`; `locale` / `theme` are direct `SessionConfig` fields (`session.config`, `setConfig`); `players`, `settings`, `settingsValid`, `config`, `started`, `ended` are read-only getters; `RelayPlayer.refreshConfig()`; `uploadBundle(pluginHtml, prepared)` uploads only the public set; the default locale is `'en'`; `HOST_SDK_VERSION`.

## 1.0.0-rc.5

The public API of the host SDK: `loadPluginFromHtml`, `prepareSetForPlugin` (`PreparedSet`), `LocalSession`, `mountPlugin`, `RelayHost` / `RelayPlayer`, `HostStorage`, `LearningAlgorithm`.
