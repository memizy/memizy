/**
 * Relay wire protocol: the host app and player apps ↔ the Memizy multiplayer
 * server (WebSocket, JSON text frames). Plugins never see it (SPEC D2).
 *
 * The server is a room relay: PINs, player identity (reconnect tokens),
 * presence and forwarding between the host and the players. The game session
 * itself (validation, limits, authority, state) runs in the host's browser.
 * The plugin and the study set are uploaded once over HTTP and downloaded by
 * the players over HTTP (`RelayBundle`), not sent through the WebSocket.
 *
 * HTTP API (JSON):
 * - `POST /api/rooms` → `CreateRoomResponse`
 * - `GET  /api/rooms/:pin` → `RoomInfo` (404 if unknown)
 * - `PUT  /api/rooms/:pin/bundle` (header `Authorization: Bearer <hostToken>`, body `RelayBundle`) → `{ version }`
 * - `GET  /api/rooms/:pin/bundle` → `RelayBundle` (header `X-Bundle-Version`)
 * - `GET  /api/health`
 * WebSocket: `/ws`.
 */

/**
 * Version of the relay wire protocol (client <-> server). Within version 1 messages only
 * change additively: receivers ignore unknown fields; the server answers an unknown `t`
 * with a non-fatal `NOT_ALLOWED` error. The messages between the host app and the player
 * apps (inside `data`) have their own version (`RELAY_APP_VERSION` in @memizy/host-sdk).
 */
export const RELAY_PROTOCOL = 1;

export const RELAY_LIMITS = {
  /** Max size of one WebSocket frame (UTF-8 JSON). */
  frameBytes: 2 * 1024 * 1024,
  /** Max size of an uploaded bundle (plugin + set). */
  bundleBytes: 8 * 1024 * 1024,
  /** Max players in a room (the plugin may allow fewer). */
  playersPerRoom: 100,
  /** Player frames per second (sustained / burst). */
  playerFramesPerSecond: 60,
  playerFrameBurst: 120,
  /** Host frames per second (it talks to every player). */
  hostFramesPerSecond: 3000,
  hostFrameBurst: 6000,
  /** Max player name length. */
  nameLength: 32,
  /** Max length of the `auth` a player sends when joining. */
  authLength: 4096,
  /** A room is closed when its host has been away this long. */
  hostAwayMs: 10 * 60_000,
  /** A room is closed after this time in any case. */
  roomTtlMs: 6 * 60 * 60_000,
} as const;

/** What the players download: the plugin HTML and the set prepared for it. */
export interface RelayBundle {
  pluginHtml: string;
  /** The set as delivered to plugins (`InitPayload.set`). */
  set: unknown;
}

export interface CreateRoomResponse {
  pin: string;
  hostToken: string;
}

export interface RoomInfo {
  pin: string;
  /** Whether new players can join right now. */
  open: boolean;
  /** Name of the game (once the host uploaded a bundle). */
  appName: string | null;
  players: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  /**
   * What the player's app sent as `auth` when joining (e.g. a signed token of a signed-in
   * student). Only the host gets it; the server does not check it – the host app does.
   */
  auth?: string;
}

// ============================================================================
// Client → server
// ============================================================================

export type RelayClientMessage =
  /** The host attaches to its room (also after a reconnect). */
  | { t: 'host'; protocol: number; pin: string; hostToken: string }
  /**
   * A player joins (with `token`: rejoins as the same player). `auth` (optional, at most
   * `RELAY_LIMITS.authLength` characters) is passed to the host only, for apps with
   * signed-in players; a rejoin with `auth` replaces the earlier one.
   */
  | { t: 'join'; protocol: number; pin: string; name: string; token?: string; auth?: string }
  /** Host → one player. */
  | { t: 'to'; to: string; data: unknown }
  /** Host: allow or stop new players joining. */
  | { t: 'open'; open: boolean }
  /** Host: remove a player (they cannot rejoin with their token). */
  | { t: 'kick'; playerId: string }
  /** Host: close the room for everyone. */
  | { t: 'close' }
  /** Player → host. */
  | { t: 'up'; data: unknown }
  /** Player: change the name. */
  | { t: 'rename'; name: string }
  | { t: 'ping' };

// ============================================================================
// Server → client
// ============================================================================

export type RelayErrorCode =
  | 'BAD_MESSAGE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'NOT_ALLOWED'
  | 'KICKED'
  | 'RATE_LIMITED'
  | 'TOO_LARGE';

export type RelayServerMessage =
  /** To the host after `host`: the current roster. */
  | { t: 'hosting'; pin: string; players: RoomPlayer[] }
  /** To a player after `join`. Keep `token` to rejoin as the same player. */
  | { t: 'joined'; pin: string; playerId: string; token: string; name: string; hostConnected: boolean }
  /** To the host: a player joined, reconnected, disconnected or was renamed. */
  | { t: 'presence'; player: RoomPlayer; event: 'join' | 'connect' | 'disconnect' | 'rename' | 'leave' }
  /** To players: the host connection state. */
  | { t: 'host-presence'; connected: boolean }
  /** Player → host. */
  | { t: 'from'; from: string; data: unknown }
  /** Host → player. */
  | { t: 'data'; data: unknown }
  /** A request failed; fatal errors are followed by closing the socket. */
  | { t: 'error'; code: RelayErrorCode; message: string; fatal: boolean }
  /** The room was closed by the host or expired. */
  | { t: 'closed'; reason: 'host' | 'expired' | 'kicked' }
  | { t: 'pong'; time: number };

/** Normalizes a player name (trimmed, collapsed spaces, max length). */
export function normalizePlayerName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, RELAY_LIMITS.nameLength);
}

/** A 6-digit PIN. */
export function isPin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}
