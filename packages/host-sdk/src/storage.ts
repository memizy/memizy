/**
 * Persistence the host provides to plugins: learning progress (OQSEP records),
 * plugin data (SPEC 5.2) and game snapshots. Apps implement this interface on
 * top of their own storage (IndexedDB, accounts…); MemoryStorage is for the
 * Plugin Lab and tests.
 */

import type { ProgressRecord } from '@memizy/oqse';
import type { DataScope } from '@memizy/protocol';

export interface HostStorage {
  loadProgress(userKey: string, setId: string): Promise<Record<string, ProgressRecord>>;
  /** Upserts the given records (other records stay). */
  saveProgress(userKey: string, setId: string, records: Record<string, ProgressRecord>): Promise<void>;
  /** `setId` is ignored for scope `plugin`. Returns `null` when nothing is saved. */
  loadData(userKey: string, pluginId: string, scope: DataScope, setId: string): Promise<unknown>;
  saveData(userKey: string, pluginId: string, scope: DataScope, setId: string, value: unknown): Promise<void>;
  loadSnapshot(sessionId: string): Promise<unknown | null>;
  saveSnapshot(sessionId: string, snapshot: unknown): Promise<void>;
}

const dataKey = (userKey: string, pluginId: string, scope: DataScope, setId: string) =>
  JSON.stringify([userKey, pluginId, scope, scope === 'set' ? setId : null]);

/** In-memory storage (values are copied, like a real store would). */
export class MemoryStorage implements HostStorage {
  readonly progress = new Map<string, Record<string, ProgressRecord>>();
  readonly data = new Map<string, unknown>();
  readonly snapshots = new Map<string, unknown>();

  async loadProgress(userKey: string, setId: string) {
    return structuredClone(this.progress.get(`${userKey}|${setId}`) ?? {});
  }

  async saveProgress(userKey: string, setId: string, records: Record<string, ProgressRecord>) {
    const key = `${userKey}|${setId}`;
    this.progress.set(key, { ...(this.progress.get(key) ?? {}), ...structuredClone(records) });
  }

  async loadData(userKey: string, pluginId: string, scope: DataScope, setId: string) {
    const value = this.data.get(dataKey(userKey, pluginId, scope, setId));
    return value === undefined ? null : structuredClone(value);
  }

  async saveData(userKey: string, pluginId: string, scope: DataScope, setId: string, value: unknown) {
    this.data.set(dataKey(userKey, pluginId, scope, setId), structuredClone(value));
  }

  async loadSnapshot(sessionId: string) {
    const value = this.snapshots.get(sessionId);
    return value === undefined ? null : structuredClone(value);
  }

  async saveSnapshot(sessionId: string, snapshot: unknown) {
    this.snapshots.set(sessionId, structuredClone(snapshot));
  }
}
