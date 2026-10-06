import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import type { HostApi, PluginApi } from '@memizy/protocol';
// Integration with the real plugin SDK (source import: startGame accepts a custom connector).
import { startGame, type GameHandle } from '../../plugin-sdk/src/game/defineGame';
import { checkAnswer } from '../../plugin-sdk/src/checkAnswer';
import type { GameDefinition } from '../../plugin-sdk/src/types';
import { LocalSession, SETTINGS_ADDRESS, type SessionConfig, type SessionEvent } from './session';
import { loadPluginFromHtml, prepareSetForPlugin, type LoadedPlugin } from './plugin';
import { MemoryStorage } from './storage';
import { leitner } from './learning';
import { PLUGIN_SANDBOX } from './frame';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

const manifest = {
  version: '0.2',
  id: 'https://example.com/plugins/race',
  appName: 'Race',
  pluginVersion: '1.0.0',
  capabilities: { actions: ['render'], types: ['mcq-single'] },
  appSpecific: {
    memizy: {
      protocol: '1.0',
      modes: { solo: {}, multiplayer: { players: { min: 1, max: 4 }, hostAs: ['presenter', 'player'], lateJoin: true } },
      settings: [{ id: 'rounds', type: 'number', label: 'Rounds', default: 2, min: 1, max: 10 }],
      settingsScreen: { size: 'compact' },
    },
  },
};
const pluginHtml = `<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`;

const setFile = loadOQSEFile({
  version: '0.2',
  meta: { id: id(0), language: 'cs', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [
    { id: id(1), type: 'mcq-single', question: 'A?', options: ['x', 'y'], correctIndex: 1 },
    { id: id(2), type: 'mcq-single', question: 'B?', options: ['x', 'y'], correctIndex: 0 },
    { id: id(3), type: 'note', content: 'not for this plugin' },
  ],
}).data as OQSEFile;

let plugin: LoadedPlugin;
beforeAll(() => {
  const result = loadPluginFromHtml(pluginHtml);
  if (!result.success) throw new Error(result.errors.join('\n'));
  plugin = result.plugin;
  // The SDK reads the manifest from its document.
  const script = document.createElement('script');
  script.type = 'application/oqse-manifest+json';
  script.textContent = JSON.stringify(manifest);
  document.head.appendChild(script);
});

const games: GameHandle[] = [];
afterEach(() => {
  games.splice(0).forEach((g) => g.destroy());
  document.body.innerHTML = '';
});

interface State { round: number; scores: Record<string, number>; answered: string[] }

const race: Omit<GameDefinition<State>, 'root'> = {
  initialState: () => ({ round: 0, scores: {}, answered: [] }),
  actions: {
    answer(state, payload, ctx) {
      if (!ctx.playerId || state.answered.includes(ctx.playerId)) return;
      const item = ctx.items[state.round];
      const correct = checkAnswer(item, payload?.answer);
      state.answered.push(ctx.playerId);
      if (correct) state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 1;
      ctx.recordAnswer(item.id, correct);
    },
    finish(_state, _payload, ctx) {
      if (!ctx.fromHost) return;
      ctx.end({ scores: { winner: 1 } });
    },
  },
  render: (state, ui) =>
    ui.view === 'board'
      ? `<p class="answered">${state.answered.length}</p>`
      : `<button data-act="answer" data-payload='{"answer":1}'>y</button><p class="score">${state.scores[ui.self!.id] ?? 0}</p>`,
  renderSettings: (settings) => `<input type="number" data-setting="rounds" value="${settings.rounds}">`,
};

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function newSession(config: Partial<SessionConfig> = {}) {
  const events: SessionEvent[] = [];
  const session = new LocalSession({
    plugin,
    set: setFile,
    mode: 'multiplayer',
    hostAs: 'presenter',
    players: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }],
    countdownMs: 0,
    shuffleSeed: null, // these tests answer by position; the display order has its own tests
    ...config,
  });
  session.on((e) => events.push(e));
  return { session, events };
}

/** Starts a real SDK game connected directly (no iframe) to the session. */
function play(session: LocalSession, address: string, def: Omit<GameDefinition<any>, 'root'> = race) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const game = startGame({ ...def, root }, {
    connector: async (pluginApi, handshake) => {
      const instance = await session.connect(address, () => pluginApi);
      const init = await instance.hostApi.hello(handshake);
      return { host: instance.hostApi, init, standalone: false, destroy: () => {} };
    },
  });
  games.push(game);
  return { root, game };
}

/** A bare instance for calling the host API directly. */
async function bare(session: LocalSession, address: string, overrides: Partial<PluginApi> = {}): Promise<HostApi> {
  const noop = async () => {};
  const pluginApi: PluginApi = { start: noop, deliver: noop, playersChanged: noop, authorityChanged: noop, setChanged: noop, configChanged: noop, clockChanged: noop, sessionEnded: noop, ...overrides };
  const instance = await session.connect(address, () => pluginApi);
  return instance.hostApi;
}

const handshake = { protocol: '1.0', sdk: { name: 'test', version: '0' }, plugin: { id: manifest.id, version: '1.0.0' }, features: [] };

// ----------------------------------------------------------------------------

describe('loading', () => {
  it('validates the plugin and prepares the set for its item types', () => {
    expect(loadPluginFromHtml('<p>no manifest</p>')).toMatchObject({ success: false });
    const tooNew = pluginHtml.replace('"protocol":"1.0"', '"protocol":"1.9"');
    expect(loadPluginFromHtml(tooNew)).toMatchObject({ success: false, errors: [expect.stringMatching(/Protocol 1\.9/)] });
    const prepared = prepareSetForPlugin(setFile, plugin.manifest);
    expect(prepared.set.items.map((i) => i.type)).toEqual(['mcq-single', 'mcq-single']);
    expect(prepared.skippedItems).toBe(1);
    expect(prepared.compatibility.unsupportedTypes).toEqual(['note']);
  });

  it('rejects impossible session configurations', () => {
    expect(() => newSession({ mode: 'solo', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })).toThrow(/exactly one player/);
    expect(() => newSession({ hostAs: 'player' })).toThrow(/isHost: true/);
    expect(() => newSession({ settings: { rounds: 99 } })).toThrow(/rounds: must be at most 10/);
    expect(() => newSession({ players: [{ id: 'board', name: 'X' }] })).toThrow(/reserved/);
  });
});

describe('set data', () => {
  it('accepts a set wrapped in proxies (e.g. Vue reactive) and sends a plain copy', () => {
    const wrap = <T,>(v: T): T => (v && typeof v === 'object' ? new Proxy(v as object, { get: (t, k) => wrap((t as Record<PropertyKey, unknown>)[k]) }) as T : v);
    const proxied = wrap(setFile);
    expect(() => structuredClone(proxied)).toThrow();
    const { session } = newSession({ set: proxied });
    expect(() => structuredClone(session.prepared.set)).not.toThrow();
    expect(session.prepared.set.items.length).toBe(prepareSetForPlugin(setFile, plugin.manifest).set.items.length);
  });
});

describe('display order and hidden answers (SPEC 4.4)', () => {
  const reveal: Omit<GameDefinition<{ shown: boolean }>, 'root'> = {
    initialState: () => ({ shown: false }),
    actions: {
      show(state, _p, ctx) {
        state.shown = true;
        ctx.reveal(ctx.items[0].id, { to: ctx.playerId! });
      },
    },
    render: (_state, ui) => {
      const item = ui.item(ui.items[0].id) as any;
      return `<p class="opts">${item.options.join(',')}</p><p class="answer">${item.answerHidden ? 'hidden' : item.correctIndex}</p><button data-act="show">s</button>`;
    },
  };

  it('shuffles once per session; only the authority has the answers until ctx.reveal', async () => {
    const { session } = newSession({ shuffleSeed: undefined, sessionId: 'seed-7' });
    const board = play(session, 'board', reveal);
    const anna = play(session, 'anna', reveal);
    const ben = play(session, 'ben', reveal);
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(150);
    const full = session.prepared.set.items[0] as any;
    expect(session.prepared.publicSet.items[0]).toMatchObject({ answerHidden: true });
    expect('correctIndex' in session.prepared.publicSet.items[0]).toBe(false);
    // The same order everywhere; the answer only on the board (the authority).
    expect(board.root.querySelector('.opts')!.textContent).toBe(full.options.join(','));
    expect(anna.root.querySelector('.opts')!.textContent).toBe(full.options.join(','));
    expect(board.root.querySelector('.answer')!.textContent).toBe(String(full.correctIndex));
    expect(anna.root.querySelector('.answer')!.textContent).toBe('hidden');
    // Revealed to Anna only.
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(anna.root.querySelector('.answer')!.textContent).toBe(String(full.correctIndex));
    expect(ben.root.querySelector('.answer')!.textContent).toBe('hidden');
    // A reloaded device gets the reveal again.
    const anna2 = play(session, 'anna', reveal);
    await anna2.game.ready;
    await wait(150);
    expect(anna2.root.querySelector('.answer')!.textContent).toBe(String(full.correctIndex));
  });

  it('the order depends on the seed; solo gets the answers', () => {
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify((newSession({ shuffleSeed: seed }).session.prepared.set.items[0] as any).options)));
    expect(orders.size).toBe(2); // two options: both orders occur
    const solo = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }], shuffleSeed: undefined }).session;
    expect(solo.prepared.set.items[0]).not.toHaveProperty('answerHidden');
  });
});

describe('solo', () => {
  it('starts when ready, records answers with the learning algorithm and saves data', async () => {
    const storage = new MemoryStorage();
    const { session, events } = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }], storage });
    const { root } = play(session, 'me', {
      ...race,
      render: (state, ui) => {
        ui.save('set', { best: state.scores.me ?? 0 });
        return `<button data-act="answer" data-payload='{"answer":1}'>y</button><p class="score">${state.scores.me ?? 0}</p>`;
      },
    });
    // Poll instead of a fixed delay: the test can share the CPU with the relay end-to-end test.
    for (let i = 0; i < 100 && !(events.some((e) => e.type === 'started') && root.querySelector('button')); i++) await wait(20);
    expect(events.some((e) => e.type === 'started')).toBe(true);
    (root.querySelector('button') as HTMLButtonElement).click();
    await wait(2500); // ui.save is debounced by the SDK (1 s) and by the host (1 s)
    expect(root.querySelector('.score')!.textContent).toBe('1');
    const progress = await storage.loadProgress('me', id(0));
    expect(progress[id(1)]).toMatchObject({ bucket: 2, stats: { attempts: 1, incorrect: 0, streak: 1 } });
    expect(await storage.loadData('me', manifest.id, 'set', id(0))).toEqual({ best: 1 });
  });
});

describe('multiplayer', () => {
  it('waits for everyone, runs the countdown and synchronizes the game', async () => {
    const { session, events } = newSession({ countdownMs: 1000 });
    const board = play(session, 'board');
    const anna = play(session, 'anna');
    const ben = play(session, 'ben');
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    expect(events.filter((e) => e.type === 'countdown')).toEqual([{ type: 'countdown', secondsLeft: 1 }]);
    await wait(200);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    (ben.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(board.root.querySelector('.answered')!.textContent).toBe('2');
    expect(anna.root.querySelector('.score')!.textContent).toBe('1');
    expect(events.filter((e) => e.type === 'answer').map((e) => (e as any).playerId).sort()).toEqual(['anna', 'ben']);
    expect(events.some((e) => e.type === 'traffic' && e.from === 'board' && e.to === 'anna')).toBe(true);
    expect(events.filter((e) => e.type === 'rejected')).toEqual([]);
  });

  it('refuses to start with too many players or invalid settings', async () => {
    const { session } = newSession({ players: ['a', 'b', 'c', 'd', 'e'].map((p) => ({ id: p, name: p })) });
    await expect(session.start()).rejects.toThrow(/1–4 players/);
  });

  it('handles an authority outage and resumes the board from its snapshot', async () => {
    const { session, events } = newSession();
    play(session, 'board');
    const anna = play(session, 'anna');
    play(session, 'ben');
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(200);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(700); // the board saves a snapshot

    session.setConnected('board', false);
    expect(events.at(-1)).toEqual({ type: 'authority', connected: false });
    // the teacher reloads the board: a new instance resumes from the snapshot
    const board2 = play(session, 'board');
    await board2.game.ready;
    await wait(300);
    expect(board2.root.querySelector('.answered')!.textContent).toBe('1');
    expect(events.filter((e) => e.type === 'authority').at(-1)).toEqual({ type: 'authority', connected: true });
    (anna.root.querySelector('button') as HTMLButtonElement).click(); // already answered: ignored
    await wait(100);
    expect(board2.root.querySelector('.answered')!.textContent).toBe('1');
  });

  it('lets a late player join and synchronize', async () => {
    const { session } = newSession();
    play(session, 'board');
    play(session, 'anna');
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(200);
    session.addPlayer({ id: 'cyril', name: 'Cyril' });
    const cyril = play(session, 'cyril');
    await cyril.game.ready;
    await wait(150);
    (cyril.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(cyril.root.querySelector('.score')!.textContent).toBe('1');
  });

  it('runs the lobby settings screen of the plugin', async () => {
    const { session, events } = newSession();
    const settings = play(session, SETTINGS_ADDRESS);
    await settings.game.ready;
    const input = settings.root.querySelector('input')!;
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    expect(events.filter((e) => e.type === 'settings').at(-1)).toMatchObject({ valid: false, message: 'rounds: must be at most 10' });
    await expect(session.start()).rejects.toThrow(/settings are not valid/);
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    expect(session.settings).toEqual({ rounds: 5 });
    expect(session.settingsValid).toBe(true);
  });
});

describe('protocol enforcement', () => {
  it('rejects invalid, oversized, unauthorized and late calls', async () => {
    const { session, events } = newSession();
    const anna = await bare(session, 'anna');
    const board = await bare(session, 'board');
    await expect(anna.hello({ ...handshake, protocol: '2.0' })).rejects.toThrow(/\[UNSUPPORTED_PROTOCOL\]/);
    await expect(anna.send({ to: 'all', data: 'x'.repeat(70_000) })).rejects.toThrow(/\[MESSAGE_TOO_LARGE\]/);
    await expect(anna.send({ to: 'all', data: { when: new Date() } as any })).rejects.toThrow(/\[INVALID_ARGUMENT\]/);
    await expect(anna.saveSnapshot({})).rejects.toThrow(/\[NOT_AUTHORITY\]/);
    await expect(board.saveData('set', {})).rejects.toThrow(/\[NOT_ALLOWED_IN_VIEW\]/);
    await expect(anna.recordAnswer({ playerId: 'ben', itemId: id(1), isCorrect: true })).rejects.toThrow(/\[NOT_AUTHORITY\]/);
    await expect(anna.updateSettings({ values: {}, valid: true })).rejects.toThrow(/\[NOT_ALLOWED_IN_VIEW\]/);
    await expect(anna.getAsset('nope')).rejects.toThrow(/\[ASSET_NOT_FOUND\]/);
    await expect((anna as any).send({ to: 42 })).rejects.toThrow(/\[INVALID_ARGUMENT\] send:/);
    expect(events.filter((e) => e.type === 'rejected').length).toBe(9);

    await session.end();
    await expect(anna.send({ to: 'all', data: 1 })).rejects.toThrow(/\[SESSION_ENDED\]/);
  });

  it('rate-limits messages', async () => {
    const { session } = newSession();
    await bare(session, 'board');
    const anna = await bare(session, 'anna');
    const results = await Promise.allSettled(Array.from({ length: 80 }, () => anna.send({ to: 'all', data: 1 })));
    expect(results.filter((r) => r.status === 'rejected').length).toBe(20);
  });

  it('rejects messages to an unreachable authority', async () => {
    const { session } = newSession();
    await bare(session, 'board');
    const anna = await bare(session, 'anna');
    session.setConnected('board', false);
    await expect(anna.send({ to: 'authority', data: 1 })).rejects.toThrow(/\[AUTHORITY_UNAVAILABLE\]/);
  });

  it('notifies instances about players and the authority', async () => {
    const { session } = newSession();
    const authorityChanged = vi.fn(async () => {});
    const playersChanged = vi.fn(async () => {});
    await bare(session, 'board');
    await bare(session, 'anna', { authorityChanged, playersChanged });
    session.renamePlayer('ben', 'Benny');
    session.setConnected('board', false);
    await wait(10);
    expect(playersChanged).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'ben', name: 'Benny' })]));
    expect(authorityChanged).toHaveBeenCalledWith({ connected: false });
  });
});

describe('leitner', () => {
  it('moves buckets up on correct answers and back to 1 on mistakes', () => {
    const now = new Date('2026-10-04T10:00:00Z');
    const first = leitner.apply(undefined, { itemId: 'x', isCorrect: true }, now);
    expect(first).toMatchObject({ bucket: 2, nextReviewAt: '2026-10-07T10:00:00.000Z', stats: { attempts: 1, incorrect: 0, streak: 1 } });
    const wrong = leitner.apply(first, { itemId: 'x', isCorrect: false, confidence: 1 }, now);
    expect(wrong).toMatchObject({ bucket: 1, stats: { attempts: 2, incorrect: 1, streak: 0 }, lastAnswer: { isCorrect: false, confidence: 1 } });
    const skipped = leitner.apply(wrong, { itemId: 'x', isCorrect: false, isSkipped: true }, now);
    expect(skipped.bucket).toBe(1);
    expect(skipped.stats.attempts).toBe(2);
  });
});

describe('sandbox', () => {
  it('never allows the plugin to share the app origin', () => {
    expect(PLUGIN_SANDBOX).not.toContain('allow-same-origin');
  });
});

describe('resume after a host reload', () => {
  it('continues from the stored snapshot with the same session id and storage', async () => {
    const storage = new MemoryStorage();
    const first = newSession({ sessionId: 'room-1', storage });
    const board = play(first.session, 'board');
    const anna = play(first.session, 'anna');
    play(first.session, 'ben');
    await Promise.all(games.map((g) => g.ready));
    await first.session.start();
    await wait(150);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(800); // the snapshot is stored (max 2 per second)
    expect(board.root.querySelector('.answered')!.textContent).toBe('1');
    games.splice(0).forEach((g) => g.destroy());
    await first.session.end('closed');

    // The host page reloads: a new session object resumes the game.
    const second = newSession({ sessionId: 'room-1', storage, resume: true });
    const board2 = play(second.session, 'board');
    const anna2 = play(second.session, 'anna');
    await Promise.all(games.map((g) => g.ready));
    await wait(200);
    expect(board2.root.querySelector('.answered')!.textContent).toBe('1');
    expect(anna2.root.querySelector('.score')!.textContent).toBe('1');
    await second.session.start(); // no-op for a resumed session
    expect(second.events.filter((e) => e.type === 'countdown')).toEqual([]);
  });

  it('starts over when there is no snapshot', async () => {
    const { session, events } = newSession({ sessionId: 'room-2', resume: true });
    const board = play(session, 'board');
    const anna = play(session, 'anna');
    await Promise.all(games.map((g) => g.ready));
    await wait(200);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(board.root.querySelector('.answered')!.textContent).toBe('1');
    expect(events.filter((e) => e.type === 'rejected')).toEqual([]);
  });
});
