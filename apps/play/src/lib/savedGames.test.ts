import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { get, set } from 'idb-keyval';
import { BUILTIN_SETS } from './sets';
import { PersistentSnapshotStorage, clearHostGame, hostStore, saveHostGame } from './hostGame';
import { deleteSavedGame, listSavedGames, loadSavedGame, saveGame, type SavedGame } from './savedGames';

const game = (id: string, kind: SavedGame['kind'], savedAt: number): SavedGame => ({
  id,
  kind,
  appName: 'Race',
  setTitle: 'Animals',
  savedAt,
  pluginHtml: '<!doctype html>',
  set: BUILTIN_SETS[0].file,
  settings: { rounds: 3 },
  players: [{ id: 'p1', name: 'Anna', isHost: false }],
  shuffleSeed: 'seed',
  clock: { pausedMs: 10, pausedAt: null },
});

describe('saved games', () => {
  it('lists the games of one kind, newest first; a saved game is paused when it was saved', async () => {
    await saveGame(game('a', 'multiplayer', 1000));
    await saveGame(game('b', 'multiplayer', 3000));
    await saveGame(game('c', 'solo', 2000));
    expect((await listSavedGames('multiplayer')).map((g) => g.id)).toEqual(['b', 'a']);
    expect((await listSavedGames('solo')).map((g) => g.id)).toEqual(['c']);
    expect((await loadSavedGame('a'))?.clock).toEqual({ pausedMs: 10, pausedAt: 1000 });
    expect((await loadSavedGame('a'))?.set.items.length).toBe(BUILTIN_SETS[0].file.items.length);
  });

  it('deleting a saved game deletes its snapshot too', async () => {
    const storage = new PersistentSnapshotStorage();
    await saveGame(game('d', 'solo', 1));
    await storage.saveSnapshot('d', { turn: 1 });
    await deleteSavedGame('d');
    expect(await loadSavedGame('d')).toBeNull();
    expect(await new PersistentSnapshotStorage().loadSnapshot('d')).toBeNull();
  });

  it('a finished game deletes its stored snapshot (deleteSnapshot)', async () => {
    const storage = new PersistentSnapshotStorage();
    await storage.saveSnapshot('e', { turn: 2 });
    await storage.deleteSnapshot('e');
    expect(await get('snapshot:e', hostStore)).toBeUndefined();
  });

  it("leaving a room's game keeps the snapshot of a game saved for later", async () => {
    const record = { pluginHtml: '', setKey: 'k', hostAs: 'presenter' as const, hostName: 'X', settings: {}, players: [] };
    await saveHostGame('111111', { ...record, sessionId: 'kept' });
    await set('snapshot:kept', { turn: 3 }, hostStore);
    await saveGame(game('kept', 'multiplayer', 5));
    await clearHostGame('111111');
    expect(await get('snapshot:kept', hostStore)).toEqual({ turn: 3 });

    await saveHostGame('222222', { ...record, sessionId: 'gone' });
    await set('snapshot:gone', { turn: 4 }, hostStore);
    await clearHostGame('222222');
    expect(await get('snapshot:gone', hostStore)).toBeUndefined();
  });
});
