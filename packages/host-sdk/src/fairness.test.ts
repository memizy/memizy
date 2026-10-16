/**
 * The secret seed of the game rules, ungraded answers and must-understand items
 * (SPEC 4.2, 5.1; OQSE "Must-Understand Properties").
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import type { PluginApi } from '@memizy/protocol';
import { LocalSession, type SessionEvent } from './session';
import { loadPluginFromHtml, prepareSetForPlugin, type LoadedPlugin } from './plugin';
import { MemoryStorage } from './storage';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6e${String(n).padStart(2, '0')}`;
const manifest = {
  version: '1.0',
  id: 'https://example.com/plugins/fair',
  appName: 'Fair',
  pluginVersion: '1.0.0',
  capabilities: { actions: ['render'], types: ['mcq-single', 'open-ended', 'numeric-input'] },
  appSpecific: { memizy: { protocol: '1.0', modes: { solo: {}, multiplayer: { players: { min: 1, max: 4 }, hostAs: ['presenter', 'player'] } } } },
};
const html = `<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`;
const setFile = loadOQSEFile({
  version: '1.0',
  meta: { id: id(0), language: 'en', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [
    { id: id(1), type: 'mcq-single', question: 'A?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y' },
    { id: id(2), type: 'open-ended', question: 'Why?' },
  ],
}).data as OQSEFile;
const handshake = { protocol: '1.0', sdk: { name: 'test', version: '0' }, plugin: { id: manifest.id, version: '1.0.0' }, features: [] };

let plugin: LoadedPlugin;
beforeAll(() => {
  const loaded = loadPluginFromHtml(html);
  if (!loaded.success) throw new Error(loaded.errors.join('; '));
  plugin = loaded.plugin;
});

const noop = async () => {};
const pluginApi: PluginApi = { start: noop, deliver: noop, playersChanged: noop, authorityChanged: noop, configChanged: noop, clockChanged: noop, sessionEnded: noop };

describe('the seed of the game rules (SPEC 4.2)', () => {
  it('only the authority gets it; it is random and not derived from the session id', async () => {
    const make = (seed?: string) =>
      new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', sessionId: 'room-1', players: [{ id: 'anna', name: 'Anna' }], ...(seed && { seed }) });
    const session = make();
    const board = await (await session.connect('board', () => pluginApi)).hostApi.hello(handshake);
    const anna = await (await session.connect('anna', () => pluginApi)).hostApi.hello(handshake);
    expect(board.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(anna).not.toHaveProperty('seed');
    expect(anna.session.id).toBe('room-1'); // known to everyone, so it must not be the seed

    const other = await (await make().connect('board', () => pluginApi)).hostApi.hello(handshake);
    expect(other.seed).not.toBe(board.seed);
    const replay = await (await make('fixed-seed').connect('board', () => pluginApi)).hostApi.hello(handshake);
    expect(replay.seed).toBe('fixed-seed');
  });
});

describe('answers that are not checked automatically (SPEC 5.1)', () => {
  it('an open-ended answer is kept for a teacher and does not change repetition', async () => {
    const storage = new MemoryStorage();
    const session = new LocalSession({ plugin, set: setFile, mode: 'solo', storage });
    const events: SessionEvent[] = [];
    session.on((e) => events.push(e));
    const me = session.players[0].id;
    const host = (await session.connect(me, () => pluginApi)).hostApi;
    await host.recordAnswer({ itemId: id(2), isCorrect: false, answer: 'Because the Earth rotates.' });
    await host.recordAnswer({ itemId: id(1), isCorrect: true, answer: 'y' });
    const answers = events.filter((e) => e.type === 'answer') as Extract<SessionEvent, { type: 'answer' }>[];
    expect(answers.map((a) => [a.ungraded, a.record === null, a.setId])).toEqual([[true, true, id(0)], [false, false, id(0)]]);
    expect(answers[0].answer.answer).toBe('Because the Earth rotates.');
    const progress = [...storage.progress.values()][0];
    expect(Object.keys(progress)).toEqual([id(1)]);
  });
});

describe('media of hidden fields (SPEC 4.4)', () => {
  it('a player device in multiplayer cannot fetch media only the answer uses', async () => {
    const file = structuredClone(setFile);
    file.items.push({ id: id(4), type: 'mcq-single', question: 'Which? <asset:q />', explanation: '<asset:answer />', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'x',
      assets: { q: { type: 'image', value: 'assets/q.png', altText: 'Q' }, answer: { type: 'image', value: 'assets/answer.png', altText: 'A' } } } as never);
    const session = new LocalSession({ plugin, set: file, mode: 'multiplayer', hostAs: 'presenter', players: [{ id: 'anna', name: 'Anna' }], loadAsset: async (key) => new Blob([key]) });
    const anna = (await session.connect('anna', () => pluginApi)).hostApi;
    const board = (await session.connect('board', () => pluginApi)).hostApi;
    expect(await (await anna.getAsset('q', id(4))).text()).toBe('q');
    await expect(anna.getAsset('answer', id(4))).rejects.toThrow(/\[ASSET_NOT_FOUND\]/);
    expect(await (await board.getAsset('answer', id(4))).text()).toBe('answer'); // the authority has everything
  });
});

describe('must-understand items', () => {
  it('never reach a game when the host does not support their properties', () => {
    const file = structuredClone(setFile);
    file.items.push({ id: id(3), type: 'numeric-input', question: 'g?', correctAnswer: 9.81, tolerancePercent: 5, mustUnderstand: ['tolerancePercent'] } as never);
    const prepared = prepareSetForPlugin(file, plugin.manifest);
    expect(prepared.set.items.map((item) => item.id)).toEqual([id(1), id(2)]);
  });
});
