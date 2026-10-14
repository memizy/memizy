# Changelog of @memizy/host-sdk

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
