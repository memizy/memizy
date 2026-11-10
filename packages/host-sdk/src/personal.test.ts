/** The host API of a player's instance with their own set (SPEC 3.4). */

import { describe, expect, it } from 'vitest';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import type { AnswerRecord, HostApi } from '@memizy/protocol';
import { personalHostApi } from './personal';
import { loadPluginFromHtml, prepareSetForPlugin } from './plugin';
import { MemoryStorage } from './storage';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6f${String(n).padStart(2, '0')}`;
const manifest = {
  version: '1.0',
  id: 'https://example.com/plugins/personal',
  appName: 'Personal',
  pluginVersion: '1.0.0',
  capabilities: { actions: ['render'], types: ['mcq-single'] },
  appSpecific: { memizy: { protocol: '1.1', modes: { multiplayer: { players: { min: 1, max: 4 }, hostAs: ['player'], sets: ['shared', 'personal'] } } } },
};
const setFile = loadOQSEFile({
  version: '1.0',
  meta: { id: id(0), language: 'en', title: 'Mine', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [{ id: id(1), type: 'mcq-single', question: 'A?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y' }],
}).data as OQSEFile;

describe('personalHostApi', () => {
  it("keeps only its own player's answers; another player's answer (e.g. the authority of a host who plays) goes on", async () => {
    const loaded = loadPluginFromHtml(`<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`);
    if (!loaded.success) throw new Error(loaded.errors.join('; '));
    const passed: AnswerRecord[] = [];
    const remote = { recordAnswer: async (answer: AnswerRecord) => void passed.push(answer) } as unknown as HostApi;
    const storage = new MemoryStorage();
    const api = personalHostApi(remote, { file: setFile, storage, userKey: 'me' }, prepareSetForPlugin(setFile, loaded.plugin.manifest), () => 'host');
    await api.recordAnswer({ playerId: 'anna', itemId: id(1), isCorrect: true });
    expect(passed.map((a) => a.playerId)).toEqual(['anna']);
    expect(await storage.loadProgress('me', id(0))).toEqual({});
    await api.recordAnswer({ playerId: 'host', itemId: id(1), isCorrect: true });
    await api.recordAnswer({ itemId: id(1), isCorrect: true }); // no player: this device's
    expect(passed).toHaveLength(1);
    expect((await storage.loadProgress('me', id(0)))[id(1)]?.stats.attempts).toBe(2);
  });

  it('a pass in order on the player’s own set: in the set’s order, given ones not again, a wrong one not back', async () => {
    const loaded = loadPluginFromHtml(`<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`);
    if (!loaded.success) throw new Error(loaded.errors.join('; '));
    const q = (n: number) => ({ id: id(n), type: 'mcq-single', question: `Q${n}?`, options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y' });
    const four = loadOQSEFile({ ...setFile, items: [q(1), q(2), q(3), q(4)] }).data as OQSEFile;
    const api = personalHostApi({} as HostApi, { file: four, storage: new MemoryStorage(), userKey: 'me', order: { order: 'sequence', since: new Date().toISOString() } }, prepareSetForPlugin(four, loaded.plugin.manifest), () => 'me');
    const pick = (count: number, exclude: string[] = []) => api.pickItems!({ playerId: 'me', count, exclude });
    expect(await pick(2)).toEqual([id(1), id(2)]); // the game's queue
    await api.recordAnswer({ playerId: 'me', itemId: id(1), isCorrect: false });
    expect(await pick(1, [id(2)])).toEqual([id(3)]); // 2 waits in the queue, 1 was wrong: neither again
    expect(await pick(1)).toEqual([id(4)]);
  });
});
