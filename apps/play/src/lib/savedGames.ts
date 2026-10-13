/**
 * Games saved for later ("Save for later" when a game is ended, or a solo game
 * left in the middle): everything needed to continue it in another lesson. The
 * authority's last snapshot stays under `snapshot:<id>` (PersistentSnapshotStorage);
 * the plugin and the set are copied, so a later change in the Lab or a new version
 * of a built-in set cannot break the saved game. Kept until the user deletes them.
 */

import { del, entries, get, set } from 'idb-keyval';
import type { OQSEFile } from '@memizy/oqse';
import type { HostAs, SettingValue } from '@memizy/protocol';
import { hostStore } from './hostGame';

export interface SavedGame {
  /** The session ID (also the key of its snapshot). */
  id: string;
  kind: 'multiplayer' | 'solo';
  /** The game's name (`appName`). */
  appName: string;
  setTitle: string;
  savedAt: number;
  pluginHtml: string;
  set: OQSEFile;
  settings: Record<string, SettingValue>;
  /** Multiplayer: the host's role and nickname. */
  hostAs?: HostAs;
  hostName?: string;
  /** The players (their IDs are the places devices take when the game continues). */
  players: { id: string; name: string; isHost: boolean }[];
  /** Seed of the display order (the same order when continuing). */
  shuffleSeed: string | null;
  /** Pauses so far; a saved game is paused (`pausedAt` = when it was saved). */
  clock: { pausedMs: number; pausedAt: number | null };
}

const key = (id: string) => `saved:${id}`;

export async function saveGame(game: SavedGame): Promise<void> {
  // Plain JSON copy: Vue reactive proxies cannot be stored in IndexedDB.
  const plain = JSON.parse(JSON.stringify({ ...game, clock: { ...game.clock, pausedAt: game.clock.pausedAt ?? game.savedAt } }));
  await set(key(game.id), plain, hostStore);
}

export async function loadSavedGame(id: string): Promise<SavedGame | null> {
  try {
    return ((await get(key(id), hostStore)) as SavedGame | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Saved games of one kind, newest first. */
export async function listSavedGames(kind: SavedGame['kind']): Promise<SavedGame[]> {
  try {
    const all = await entries<string, SavedGame>(hostStore);
    return all
      .filter(([k, v]) => typeof k === 'string' && k.startsWith('saved:') && v?.kind === kind)
      .map(([, v]) => v)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Deletes a saved game and its snapshot. */
export async function deleteSavedGame(id: string): Promise<void> {
  await del(key(id), hostStore).catch(() => {});
  await del(`snapshot:${id}`, hostStore).catch(() => {});
}
