/**
 * Messages between the host app and a player app, carried in the `data` of
 * relay frames. The host runs the session; a player app runs one plugin
 * instance and bridges its calls (HostApi up, PluginApi down).
 */

import type { Player, SessionResult } from '@memizy/protocol';

/**
 * Version of the messages between the host app and the player apps. Within one relay
 * protocol they only change additively: receivers ignore unknown `k` and unknown fields,
 * and an app that sends nothing is version 0. Player apps send it in `hello`, hosts in
 * `mount`, so each side knows what the other understands (e.g. a cached older player app).
 *
 * 1 – places in a continued game (`seat` / `claim`), `UNKNOWN_METHOD` errors.
 */
export const RELAY_APP_VERSION = 1;

export type RemotePhase = 'lobby' | 'loading' | 'countdown' | 'running' | 'ended';

export interface RemoteLobbyState {
  phase: RemotePhase;
  appName: string | null;
  players: Player[];
  /** Seconds left while counting down. */
  countdown?: number;
  /** Whether the authority is reachable (false = "waiting for the host"). */
  authorityConnected: boolean;
  result?: SessionResult;
  /**
   * A continued (saved) game: the places of the earlier players. A device takes one
   * (`claim`) or the host assigns it; `taken` places have a device.
   */
  seats?: RemoteSeat[];
  /** A continued game: whether a device may also join as a new player (late join, space left). */
  newPlayers?: boolean;
}

/** A place of a player in a continued game (the earlier player's ID and nickname). */
export interface RemoteSeat {
  id: string;
  name: string;
  taken: boolean;
}

export type SerializedError = { message: string };

export type HostToPlayer =
  /** Lobby / game state for the player app's own screens. */
  | { k: 'state'; state: RemoteLobbyState }
  /**
   * Create (or recreate) the plugin instance; download the bundle if its version changed.
   * `locale` is the host's language (informational: player apps use their own); `v` = RELAY_APP_VERSION.
   */
  | { k: 'mount'; gen: number; bundle: number; locale: string; v?: number }
  /** Remove the plugin instance. */
  | { k: 'unmount' }
  /** A continued game: the place of this device (`null` = none yet) and its nickname. */
  | { k: 'seat'; seat: string | null; name?: string }
  /** A PluginApi call. */
  | { k: 'call'; id: number; gen: number; method: string; args: unknown[] }
  /** Result of a HostApi call. `hostNow` comes with `hello` (clock sync). */
  | { k: 'result'; id: number; ok: true; value: unknown; hostNow?: number }
  | { k: 'result'; id: number; ok: false; error: SerializedError };

export type PlayerToHost =
  /** After (re)joining: the generation of the plugin instance still alive (0 = none); `v` = RELAY_APP_VERSION. */
  | { k: 'hello'; gen: number; v?: number }
  /** A continued game: take the place `seat`, or join as a new player (`null`). */
  | { k: 'claim'; seat: string | null }
  /** The plugin instance `gen` connected (Penpal handshake done). */
  | { k: 'mounted'; gen: number }
  | { k: 'mount-failed'; gen: number; error: SerializedError }
  /** A HostApi call of instance `gen`. */
  | { k: 'call'; id: number; gen: number; method: string; args: unknown[] }
  /** Result of a PluginApi call. */
  | { k: 'result'; id: number; ok: true; value: unknown }
  | { k: 'result'; id: number; ok: false; error: SerializedError };

export function serializeError(error: unknown): SerializedError {
  const message = error instanceof Error ? error.message : String(error);
  // Penpal inside the device: the plugin has no such method (keep the code across the relay).
  if ((error as { code?: unknown } | null)?.code === 'METHOD_NOT_FOUND') return { message: `[UNKNOWN_METHOD] ${message}` };
  return { message };
}

/** The error for a call whose method the receiving app does not know (an older or newer version). */
export function unknownMethod(method: unknown): SerializedError {
  return { message: `[UNKNOWN_METHOD] This app does not know the method "${String(method).slice(0, 64)}".` };
}

/** Blobs (getAsset) are not JSON: they travel as base64. */
export interface SerializedBlob {
  $blob: string;
  type: string;
}

export async function blobToJson(blob: Blob): Promise<SerializedBlob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { $blob: btoa(binary), type: blob.type };
}

export function jsonToBlob(value: SerializedBlob): Blob {
  const binary = atob(value.$blob);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: value.type });
}

export function isSerializedBlob(value: unknown): value is SerializedBlob {
  return typeof value === 'object' && value !== null && typeof (value as SerializedBlob).$blob === 'string';
}
