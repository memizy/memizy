/**
 * Messages between the host app and a player app, carried in the `data` of
 * relay frames. The host runs the session; a player app runs one plugin
 * instance and bridges its calls (HostApi up, PluginApi down).
 */

import type { Player, SessionResult } from '@memizy/protocol';

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
}

export type SerializedError = { message: string };

export type HostToPlayer =
  /** Lobby / game state for the player app's own screens. */
  | { k: 'state'; state: RemoteLobbyState }
  /** Create (or recreate) the plugin instance; download the bundle if its version changed. */
  | { k: 'mount'; gen: number; bundle: number; locale: string }
  /** Remove the plugin instance. */
  | { k: 'unmount' }
  /** A PluginApi call. */
  | { k: 'call'; id: number; gen: number; method: string; args: unknown[] }
  /** Result of a HostApi call. `hostNow` comes with `hello` (clock sync). */
  | { k: 'result'; id: number; ok: true; value: unknown; hostNow?: number }
  | { k: 'result'; id: number; ok: false; error: SerializedError };

export type PlayerToHost =
  /** After (re)joining: the generation of the plugin instance still alive (0 = none). */
  | { k: 'hello'; gen: number }
  /** The plugin instance `gen` connected (Penpal handshake done). */
  | { k: 'mounted'; gen: number }
  | { k: 'mount-failed'; gen: number; error: SerializedError }
  /** A HostApi call of instance `gen`. */
  | { k: 'call'; id: number; gen: number; method: string; args: unknown[] }
  /** Result of a PluginApi call. */
  | { k: 'result'; id: number; ok: true; value: unknown }
  | { k: 'result'; id: number; ok: false; error: SerializedError };

export function serializeError(error: unknown): SerializedError {
  return { message: error instanceof Error ? error.message : String(error) };
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
