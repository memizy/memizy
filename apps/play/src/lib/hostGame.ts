/**
 * Keeps a running multiplayer game alive across a reload of the host page:
 * the authority's snapshots and a record of the game (plugin, set, roster,
 * settings) are stored in IndexedDB. Not in localStorage: snapshots can have
 * up to 1 MB, localStorage is small, synchronous and shared with all of
 * memizy.com.
 */

import { createStore, del, get, set } from 'idb-keyval';
import { MemoryStorage } from '@memizy/host-sdk';
import type { HostAs, SettingValue } from '@memizy/protocol';

const store = createStore('memizy-play-host', 'games');

/** Progress and plugin data stay in memory; snapshots are persisted. */
export class PersistentSnapshotStorage extends MemoryStorage {
  override async loadSnapshot(sessionId: string) {
    try {
      return ((await get(`snapshot:${sessionId}`, store)) as {} | undefined) ?? null;
    } catch {
      return super.loadSnapshot(sessionId);
    }
  }

  override async saveSnapshot(sessionId: string, snapshot: unknown): Promise<void> {
    await super.saveSnapshot(sessionId, snapshot);
    await set(`snapshot:${sessionId}`, snapshot, store).catch((error) => console.warn('[memizy play] could not save the snapshot:', error));
  }
}

export interface HostGameRecord {
  sessionId: string;
  pluginHtml: string;
  setKey: string;
  hostAs: HostAs;
  hostName: string;
  settings: Record<string, SettingValue>;
  players: { id: string; name: string; isHost: boolean }[];
}

/** Games older than this are not resumed. */
const MAX_AGE_MS = 6 * 60 * 60_000;

export async function saveHostGame(pin: string, record: HostGameRecord): Promise<void> {
  // Plain JSON copy: Vue reactive proxies cannot be stored in IndexedDB.
  const plain = JSON.parse(JSON.stringify({ ...record, savedAt: Date.now() }));
  await set(`game:${pin}`, plain, store).catch((error) => console.warn('[memizy play] could not save the game record:', error));
}

export async function loadHostGame(pin: string): Promise<HostGameRecord | null> {
  try {
    const record = (await get(`game:${pin}`, store)) as (HostGameRecord & { savedAt: number }) | undefined;
    return record && Date.now() - record.savedAt < MAX_AGE_MS ? record : null;
  } catch {
    return null;
  }
}

export async function clearHostGame(pin: string): Promise<void> {
  const record = await loadHostGame(pin);
  await del(`game:${pin}`, store).catch(() => {});
  if (record) await del(`snapshot:${record.sessionId}`, store).catch(() => {});
}
