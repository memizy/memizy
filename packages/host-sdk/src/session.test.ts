import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import type { HostApi, PluginApi } from '@memizy/protocol';
// Integration with the real plugin SDK (source import: startGame accepts a custom connector).
import { startGame, type GameHandle } from '../../plugin-sdk/src/game/defineGame';
import { checkAnswer } from '../../plugin-sdk/src/checkAnswer';
import type { GameDefinition } from '../../plugin-sdk/src/types';
import { SETTINGS_ADDRESS } from '@memizy/protocol';
import { LocalSession, type SessionConfig, type SessionEvent } from './session';
import { loadPluginFromHtml, prepareSetForPlugin, type LoadedPlugin } from './plugin';
import { MemoryStorage } from './storage';
import { leitner, type LearningAlgorithm } from './learning';
import { PLUGIN_SANDBOX, createPluginFrame } from './frame';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

const manifest = {
  version: '1.0',
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
  version: '1.0',
  meta: { id: id(0), language: 'cs', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [
    { id: id(1), type: 'mcq-single', question: 'A?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y', skills: ['geo.capitals'], tags: ['eu'] },
    { id: id(2), type: 'mcq-single', question: 'B?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'x' },
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
      : `<button data-act="answer" data-payload='{"answer":"y"}'>y</button><p class="score">${state.scores[ui.self!.id] ?? 0}</p>`,
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
  const pluginApi: PluginApi = { start: noop, deliver: noop, playersChanged: noop, authorityChanged: noop, configChanged: noop, clockChanged: noop, sessionEnded: noop, ...overrides };
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
      return `<p class="opts">${item.options.map((o: any) => o.text).join(',')}</p><p class="answer">${item.answerHidden ? 'hidden' : item.correctId}</p><button data-act="show">s</button>`;
    },
  };

  it('shuffles once per session; only the authority has the answers until ctx.reveal', async () => {
    const { session } = newSession({ shuffleSeed: 'seed-7' });
    const board = play(session, 'board', reveal);
    const anna = play(session, 'anna', reveal);
    const ben = play(session, 'ben', reveal);
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(150);
    const full = session.prepared.set.items[0] as any;
    expect(session.prepared.publicSet.items[0]).toMatchObject({ answerHidden: true });
    expect('correctId' in session.prepared.publicSet.items[0]).toBe(false);
    // The same order everywhere; the answer only on the board (the authority).
    expect(board.root.querySelector('.opts')!.textContent).toBe(full.options.map((o: any) => o.text).join(','));
    expect(anna.root.querySelector('.opts')!.textContent).toBe(full.options.map((o: any) => o.text).join(','));
    expect(board.root.querySelector('.answer')!.textContent).toBe(full.correctId);
    expect(anna.root.querySelector('.answer')!.textContent).toBe('hidden');
    // Revealed to Anna only.
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(anna.root.querySelector('.answer')!.textContent).toBe(full.correctId);
    expect(ben.root.querySelector('.answer')!.textContent).toBe('hidden');
    // A reloaded device gets the reveal again.
    const anna2 = play(session, 'anna', reveal);
    await anna2.game.ready;
    await wait(150);
    expect(anna2.root.querySelector('.answer')!.textContent).toBe(full.correctId);
  });

  it('a revealed item keeps the media this device loaded, never another device’s object URLs; its hidden media come from the host (1.1)', async () => {
    const original = URL.createObjectURL;
    let n = 0;
    URL.createObjectURL = () => `blob:null/url-${++n}`; // jsdom has no object URLs; each call is a new one
    try {
      const set = loadOQSEFile({
        version: '1.0',
        meta: { id: id(0), language: 'cs', title: 'Package', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        items: [{
          id: id(10), type: 'mcq-single', question: 'Kdo štěká? <asset:pic />', options: [{ id: 'x', text: 'kočka' }, { id: 'y', text: 'pes' }], correctId: 'y',
          explanation: 'Takhle: <asset:back />',
          assets: { pic: { type: 'image', value: 'media/pic.png', altText: 'Zvíře' }, back: { type: 'image', value: 'media/back.png', altText: 'Pes' } },
        }],
      }).data as OQSEFile;
      const { session } = newSession({ set, loadAsset: async (key) => new Blob([key], { type: 'image/png' }) });
      const def: Omit<GameDefinition<{}>, 'root'> = {
        initialState: () => ({}),
        actions: { show(_s, _p, ctx) { ctx.reveal(ctx.items[0].id); } },
        render: (_s, ui) => {
          const item = ui.item(ui.items[0].id) as any;
          return `<p class="pic">${item.assets?.pic?.value ?? '-'}</p><p class="back">${item.assets?.back?.value ?? '-'}</p><p class="answer">${item.answerHidden ? 'hidden' : item.correctId}</p><button data-act="show">s</button>`;
        },
      };
      const board = play(session, 'board', def);
      const anna = play(session, 'anna', def);
      await Promise.all(games.map((g) => g.ready));
      await session.start();
      await wait(150);
      const annaPic = anna.root.querySelector('.pic')!.textContent!;
      expect(annaPic).toMatch(/^blob:/);
      expect(board.root.querySelector('.pic')!.textContent).not.toBe(annaPic); // each device has its own URL
      expect(board.root.querySelector('.back')!.textContent).toMatch(/^blob:/);
      expect(anna.root.querySelector('.back')!.textContent).toBe('-'); // hidden media never reach a player

      (anna.root.querySelector('button') as HTMLButtonElement).click();
      await wait(150);
      expect(anna.root.querySelector('.answer')!.textContent).toBe('y');
      expect(anna.root.querySelector('.pic')!.textContent).toBe(annaPic); // still this device's picture
      // The explanation's picture: fetched by this device after the reveal (revealItems), not the board's URL.
      const annaBack = anna.root.querySelector('.back')!.textContent!;
      expect(annaBack).toMatch(/^blob:/);
      expect(annaBack).not.toBe(board.root.querySelector('.back')!.textContent);
    } finally {
      URL.createObjectURL = original;
    }
  });

  it('the order depends on the seed; solo gets the answers', () => {
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify((newSession({ shuffleSeed: seed }).session.prepared.set.items[0] as any).options)));
    expect(orders.size).toBe(2); // two options: both orders occur
    const solo = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }], shuffleSeed: undefined }).session;
    expect(solo.prepared.set.items[0]).not.toHaveProperty('answerHidden');
    // Without a seed the order is random, not derived from the session id (which players know).
    const bySessionId = new Set(Array.from({ length: 12 }, () => JSON.stringify((newSession({ shuffleSeed: undefined, sessionId: 'same' }).session.prepared.set.items[0] as any).options)));
    expect(bySessionId.size).toBe(2);
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
        return `<button data-act="answer" data-payload='{"answer":"y"}'>y</button><p class="score">${state.scores.me ?? 0}</p>`;
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

describe('pause', () => {
  it('the host pauses and resumes every device; the SDK covers the game meanwhile', async () => {
    const { session, events } = newSession();
    const board = play(session, 'board');
    const anna = play(session, 'anna');
    play(session, 'ben');
    await Promise.all(games.map((g) => g.ready));
    session.pause(); // before the start: nothing to pause
    expect(session.paused).toBe(false);
    await session.start();
    await wait(100);
    session.pause();
    await wait(100);
    expect(session.paused).toBe(true);
    expect(document.querySelectorAll('.mz-paused').length).toBeGreaterThan(0);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(board.root.querySelector('.answered')!.textContent).toBe('0');
    session.resume();
    await wait(100);
    expect(document.querySelectorAll('.mz-paused').length).toBe(0);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    expect(board.root.querySelector('.answered')!.textContent).toBe('1');
    const paused = events.filter((e) => e.type === 'paused') as Extract<SessionEvent, { type: 'paused' }>[];
    expect(paused.map((e) => e.paused)).toEqual([true, false]);
    expect(paused[1].clock.pausedAt).toBeNull();
    expect(paused[1].clock.pausedMs).toBeGreaterThan(50);
    // A reloaded host passes the stored clock on.
    const resumed = newSession({ restore: true, clock: { pausedMs: 1234, pausedAt: null } }).session;
    expect(resumed.clock).toEqual({ offsetMs: 0, pausedMs: 1234, pausedAt: null });
  });
});

describe('finishing on request (SPEC 7, protocol 1.1)', () => {
  const finishing: Omit<GameDefinition<State & { phase?: string }>, 'root'> = {
    ...race,
    phases: { play: {}, end: { onEnter: (state, ctx) => ctx.end({ scores: state.scores, summary: 'done' }) } },
    initialState: (ctx) => {
      ctx.goto('play');
      return { round: 0, scores: {}, answered: [] };
    },
    onFinish: (_state, ctx) => ctx.goto('end'),
    render: (state, ui) => (state.phase === 'end' ? '<p class="final">final</p>' : race.render(state, ui)),
  };

  it('the host asks the authority; the game ends with its result and shows its final screen', async () => {
    const { session, events } = newSession();
    const board = play(session, 'board', finishing);
    const anna = play(session, 'anna', finishing);
    play(session, 'ben', finishing);
    await Promise.all(games.map((g) => g.ready));
    expect(session.canFinish).toBe(false); // not started yet
    await session.start();
    await wait(150);
    (anna.root.querySelector('button') as HTMLButtonElement).click();
    await wait(150);
    session.pause();
    expect(session.canFinish).toBe(true);
    expect(await session.requestFinish()).toBe(true);
    await wait(150);
    expect(session.paused).toBe(false); // the final screen is not covered
    expect(events.filter((e) => e.type === 'result')).toEqual([{ type: 'result', result: { scores: { anna: 1 }, summary: 'done' } }]);
    expect(board.root.querySelector('.final')).not.toBeNull();
    expect(anna.root.querySelector('.final')).not.toBeNull();
    expect(session.canFinish).toBe(false);
    expect(await session.requestFinish()).toBe(false);
  });

  it('only games with onFinish and protocol 1.1 offer it', async () => {
    const plain = newSession().session;
    play(plain, 'board');
    play(plain, 'anna');
    play(plain, 'ben');
    await Promise.all(games.map((g) => g.ready));
    await plain.start();
    await wait(100);
    expect(plain.canFinish).toBe(false);
    expect(await plain.requestFinish()).toBe(false);

    // A plugin that speaks protocol 1.0 gets no host features, even if it lists one.
    const old = newSession().session;
    const host = await bare(old, 'board', { finishRequested: async () => {} });
    const init = await host.hello({ ...handshake, features: ['finish-request'] });
    expect(init.features).toEqual([]);
    const current = await (await bare(newSession().session, 'board')).hello({ ...handshake, protocol: '1.1' });
    expect(current.protocol).toBe('1.1');
    expect(current.features).toEqual(['finish-request', 'pick-items', 'reveal-items', 'set-changes']); // choose-set: only hosts with a set picker
  });

  it('revealItems: only the players an item was revealed to may fetch its hidden media (protocol 1.1)', async () => {
    const set = loadOQSEFile({
      version: '1.0',
      meta: { id: id(0), language: 'cs', title: 'Package', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      items: [{
        id: id(10), type: 'mcq-single', question: 'Kdo štěká?', options: [{ id: 'x', text: 'kočka' }, { id: 'y', text: 'pes' }], correctId: 'y',
        explanation: 'Takhle: <asset:back />', assets: { back: { type: 'image', value: 'media/back.png' } },
      }],
    }).data as OQSEFile;
    const { session } = newSession({ set, loadAsset: async (key) => new Blob([key]) });
    const v11 = { ...handshake, protocol: '1.1', features: ['reveal-items'] };
    const board = await bare(session, 'board');
    await board.hello(v11);
    const anna = await bare(session, 'anna');
    await anna.hello(v11);
    const ben = await bare(session, 'ben');
    await ben.hello(v11);
    await expect(anna.getAsset('back', id(10))).rejects.toThrow(/ASSET_NOT_FOUND/); // hidden
    await expect(anna.revealItems!({ itemIds: [id(10)], to: null })).rejects.toThrow(/NOT_AUTHORITY|authority/i);
    await board.revealItems!({ itemIds: [id(10), 'unknown'], to: ['anna'] });
    await expect(anna.getAsset('back', id(10))).resolves.toBeInstanceOf(Blob);
    await expect(ben.getAsset('back', id(10))).rejects.toThrow(/ASSET_NOT_FOUND/); // not revealed to Ben
    await board.revealItems!({ itemIds: [id(10)], to: null });
    await expect(ben.getAsset('back', id(10))).resolves.toBeInstanceOf(Blob);
    // Without the feature (an older SDK) the method is unknown.
    const old = await bare(newSession({ set }).session, 'board');
    await old.hello({ ...handshake, protocol: '1.1' });
    await expect(old.revealItems!({ itemIds: [id(10)], to: null })).rejects.toThrow(/UNKNOWN_METHOD/);
  });

  it('markItem: a player stars an item from the game (protocol 1.1); its learning stays', async () => {
    const storage = new MemoryStorage();
    const { session, events } = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }], storage });
    const me = await bare(session, 'me');
    await me.hello({ ...handshake, protocol: '1.1' });
    const [first] = session.prepared.set.items;
    await me.markItem!(first.id, { starred: true });
    expect((await storage.loadProgress('me', session.prepared.set.meta.id))[first.id]).toMatchObject({ bucket: 0, starred: true });
    await me.recordAnswer({ itemId: first.id, isCorrect: true });
    await me.markItem!(first.id, { starred: false });
    expect((await storage.loadProgress('me', session.prepared.set.meta.id))[first.id]).toMatchObject({ bucket: 2, starred: false });
    expect(events.filter((e) => e.type === 'marked').map((e) => (e as { starred: boolean }).starred)).toEqual([true, false]);
    await expect(me.markItem!('nope', { starred: true })).rejects.toThrow(/INVALID_ARGUMENT/);
    const board = await bare(newSession().session, 'board');
    await board.hello({ ...handshake, protocol: '1.1' });
    await expect(board.markItem!(first.id, { starred: true })).rejects.toThrow(/NOT_ALLOWED_IN_VIEW/);
  });

  it('ctx.nextItem: the queue the host refills by progress; without the feature a random item', async () => {
    interface S { got: string[]; queue?: unknown }
    const def = (pick: boolean): Omit<GameDefinition<S>, 'root'> => ({
      ...(pick && { pickItems: { ahead: 2 } }),
      initialState: () => ({ got: [] }),
      actions: {
        next(state, _p, ctx) { const item = ctx.nextItem(ctx.playerId); if (item) state.got.push(item.id); },
        answer(state, payload: { ok: boolean }, ctx) { ctx.recordAnswer(state.got[state.got.length - 1], payload.ok); },
      },
      render: (state, ui) => `<p class="got">${state.got.join(',')}</p><p class="queue">${JSON.stringify((state as any).$picks?.[ui.self?.id ?? '']?.q ?? [])}</p><button class="n" data-act="next">n</button><button class="w" data-act="answer" data-payload='{"ok":false}'>w</button><button class="r" data-act="answer" data-payload='{"ok":true}'>r</button>`,
    });
    const { session } = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }], shuffleSeed: null });
    const me = play(session, 'me', def(true));
    await me.game.ready;
    await wait(150);
    // The host filled the queue at the start.
    expect(JSON.parse(me.root.querySelector('.queue')!.textContent!)).toHaveLength(2);
    const click = async (sel: string) => { (me.root.querySelector(sel) as HTMLButtonElement).click(); await wait(80); };
    await click('.n');
    await click('.w'); // the first item answered wrong
    const wrong = me.root.querySelector('.got')!.textContent!.split(',')[0];
    for (let i = 0; i < 3; i++) { await click('.n'); await click('.r'); }
    await click('.n');
    await wait(100);
    const got = me.root.querySelector('.got')!.textContent!.split(',');
    // Queued ahead: the wrong item comes back within the next picks.
    for (let i = 0; i < 2 && got.at(-1) !== wrong; i++) { await click('.r'); await click('.n'); }
    expect(me.root.querySelector('.got')!.textContent!.split(',').slice(4)).toContain(wrong);

    // A game without pickItems still gets items (random), and never asks the host.
    const { session: other } = newSession({ mode: 'solo', players: [{ id: 'me', name: 'Me' }] });
    const plain = play(other, 'me', def(false));
    await plain.game.ready;
    await wait(100);
    (plain.root.querySelector('.n') as HTMLButtonElement).click();
    await wait(80);
    expect(plain.root.querySelector('.got')!.textContent).toMatch(/^\S+$/);
    expect(JSON.parse(plain.root.querySelector('.queue')!.textContent!)).toEqual([]);
  });

  it('pickItems: the authority asks for the next items of a player, by progress and the answers of this game', async () => {
    const { session } = newSession({ shuffleSeed: null });
    const board = await bare(session, 'board');
    await board.hello({ ...handshake, protocol: '1.1', features: ['pick-items'] });
    const anna = await bare(session, 'anna');
    await anna.hello({ ...handshake, protocol: '1.1', features: ['pick-items'] });
    const ids = session.prepared.set.items.map((i) => i.id);
    const picked = await board.pickItems!({ playerId: 'anna', count: 2 });
    expect(picked).toHaveLength(2);
    expect(picked.every((id) => ids.includes(id))).toBe(true);
    expect(await board.pickItems!({ playerId: 'anna', count: 5, exclude: [ids[0]] })).toEqual([ids[1]]);
    await expect(anna.pickItems!({ playerId: 'anna', count: 1 })).rejects.toThrow(/NOT_AUTHORITY/);
    await expect(board.pickItems!({ playerId: 'nobody', count: 1 })).rejects.toThrow(/INVALID_ARGUMENT/);
    // A wrong answer comes back after three other answers.
    await board.recordAnswer({ itemId: ids[0], isCorrect: false, playerId: 'anna' });
    for (let i = 0; i < 3; i++) await board.recordAnswer({ itemId: ids[1], isCorrect: true, playerId: 'anna' });
    expect((await board.pickItems!({ playerId: 'anna', count: 1 }))[0]).toBe(ids[0]);
    // Without the feature in the handshake: not available.
    const other = newSession().session;
    const plain = await bare(other, 'board');
    await plain.hello({ ...handshake, protocol: '1.1' });
    await expect(plain.pickItems!({ playerId: 'anna', count: 1 })).rejects.toThrow(/UNKNOWN_METHOD/);
  });

  it('pickItems in a pass in order (pickOrderFor): the set as it is, a wrong answer not back', async () => {
    const { session } = newSession({ shuffleSeed: null, pickOrderFor: (playerId) => (playerId === 'anna' ? { order: 'sequence' } : undefined) });
    const board = await bare(session, 'board');
    await board.hello({ ...handshake, protocol: '1.1', features: ['pick-items'] });
    const ids = session.prepared.set.items.map((i) => i.id);
    expect(await board.pickItems!({ playerId: 'anna', count: 1 })).toEqual([ids[0]]);
    // the first is in the game's queue, not answered yet: the next one
    expect(await board.pickItems!({ playerId: 'anna', count: 1, exclude: [ids[0]] })).toEqual([ids[1]]);
    await board.recordAnswer({ itemId: ids[0], isCorrect: false, playerId: 'anna' });
    // the pass is over (both given): by progress again
    expect(await board.pickItems!({ playerId: 'anna', count: 1 })).toHaveLength(1);
  });

  it('a game whose onFinish does not end reports it', async () => {
    const { session, events } = newSession();
    play(session, 'board', { ...finishing, onFinish: () => {} });
    play(session, 'anna', finishing);
    play(session, 'ben', finishing);
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(100);
    expect(await session.requestFinish()).toBe(true);
    await wait(100);
    expect(events.some((e) => e.type === 'result')).toBe(false);
    expect(events.filter((e) => e.type === 'pluginError').map((e) => (e as { code: string }).code)).toContain('FINISH_WITHOUT_END');
  });
});

describe('services and permissions', () => {
  const withServices = (memizy: Record<string, unknown>) => {
    const m = { ...manifest, appSpecific: { memizy: { ...manifest.appSpecific.memizy, ...memizy } } };
    const html = `<!doctype html><html><head><script type="application/oqse-manifest+json">${JSON.stringify(m)}</script></head><body></body></html>`;
    const result = loadPluginFromHtml(html);
    if (!result.success) throw new Error(result.errors.join('\n'));
    return result.plugin;
  };

  it('a game calls a service the host offers; others are unavailable', async () => {
    const calls: unknown[] = [];
    const plugin = withServices({ services: ['demo.echo', 'ai.chat'] });
    const { session } = newSession({
      plugin,
      services: {
        'demo.echo': async (payload, context) => {
          calls.push({ payload, context });
          return { echo: payload, by: context.playerId };
        },
      },
    });
    expect(session.services).toEqual(['demo.echo']); // ai.chat is declared but not offered
    const def: Omit<GameDefinition<{ got: unknown; failed: string | null }>, 'root'> = {
      initialState: () => ({ got: null, failed: null }),
      actions: {
        got(state, payload) { state.got = payload; },
        failed(state, payload) { state.failed = String(payload); },
      },
      render: (state, ui) => `<p class="services">${ui.services.join(',')}</p><p class="got">${JSON.stringify(state.got)}</p><p class="failed">${state.failed ?? ''}</p>`,
      afterRender(_state, ui) {
        if (ui.view !== 'controller' || ui.self?.id !== 'anna' || ui.local.asked) return;
        ui.local.asked = true;
        ui.service('demo.echo', { level: 3 }).then((r) => ui.act('got', r));
        ui.service('ai.chat', {}).catch((e) => ui.act('failed', e.message));
      },
    };
    play(session, 'board', def);
    const anna = play(session, 'anna', def);
    play(session, 'ben', def);
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(250);
    expect(anna.root.querySelector('.services')!.textContent).toBe('demo.echo');
    expect(JSON.parse(anna.root.querySelector('.got')!.textContent!)).toEqual({ echo: { level: 3 }, by: 'anna' });
    expect(anna.root.querySelector('.failed')!.textContent).toMatch(/SERVICE_UNAVAILABLE/);
    expect(calls).toEqual([{ payload: { level: 3 }, context: expect.objectContaining({ playerId: 'anna', address: 'anna', pluginId: manifest.id }) }]);
  });

  it('rejects undeclared services, large requests and too many calls', async () => {
    const plugin = withServices({ services: ['demo.echo'] });
    const { session } = newSession({ plugin, services: { 'demo.echo': async (p) => p, 'secret.admin': async () => 'no' } });
    const anna = await bare(session, 'anna');
    await expect(anna.service('secret.admin', {})).rejects.toThrow(/\[SERVICE_UNAVAILABLE\]/);
    await expect(anna.service('demo.echo', 'x'.repeat(70_000))).rejects.toThrow(/\[MESSAGE_TOO_LARGE\]/);
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => anna.service('demo.echo', 1)));
    expect(results.filter((r) => r.status === 'rejected').length).toBeGreaterThan(0);
  });

  it('the iframe gets a content policy from the declared network and the declared devices', () => {
    const plugin = withServices({ permissions: { network: ['https://lichess.org'], devices: ['microphone'] } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const frame = createPluginFrame(plugin.html, 'x', {} as HostApi);
    frame.plugin.catch(() => {}); // no plugin runs in jsdom
    container.appendChild(frame.iframe);
    expect(frame.iframe.getAttribute('allow')).toBe('clipboard-write *; microphone *');
    expect(frame.iframe.srcdoc).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="[^"]*connect-src [^"]*https:\/\/lichess\.org/);
    const plain = createPluginFrame(pluginHtml, 'y', {} as HostApi);
    plain.plugin.catch(() => {});
    container.appendChild(plain.iframe);
    expect(plain.iframe.getAttribute('allow')).toBe('clipboard-write *'); // protocol 1.1: copying after a tap
    expect(plain.iframe.srcdoc).not.toContain('lichess');
    frame.destroy();
    plain.destroy();
    container.remove();
  });
});

describe('connecting', () => {
  it('an instance replaced while it connects resolves quietly (its connection was destroyed)', async () => {
    const { session } = newSession();
    let fail!: (error: Error) => void;
    const first = session.connect('anna', () => new Promise<PluginApi>((_, reject) => (fail = reject)), {
      onDispose: () => fail(new Error('[CONNECTION_DESTROYED] Connection destroyed')),
    });
    await bare(session, 'anna'); // replaces the first instance
    await expect(first).resolves.toMatchObject({ address: 'anna' });
    await expect(session.connect('ben', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await session.end();
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
    await expect(anna.recordAnswer({ itemId: id(1), isCorrect: true })).rejects.toThrow(/\[NOT_AUTHORITY\]/); // not even for herself
    await expect(anna.updateSettings({ values: {}, valid: true })).rejects.toThrow(/\[NOT_ALLOWED_IN_VIEW\]/);
    await expect(anna.getAsset('nope')).rejects.toThrow(/\[ASSET_NOT_FOUND\]/);
    await expect((anna as any).send({ to: 42 })).rejects.toThrow(/\[INVALID_ARGUMENT\] send:/);
    expect(events.filter((e) => e.type === 'rejected').length).toBe(10);

    await session.end();
    await expect(anna.send({ to: 'all', data: 1 })).rejects.toThrow(/\[SESSION_ENDED\]/);
  });

  it('records the answer given, skills, and generated items (statistics only)', async () => {
    const { session, events } = newSession();
    const board = await bare(session, 'board');
    const anna = { recordAnswer: (answer: Parameters<HostApi['recordAnswer']>[0]) => board.recordAnswer({ playerId: 'anna', ...answer }) };
    await expect(board.recordAnswer({ itemId: id(1), isCorrect: true })).rejects.toThrow(/needs a playerId on the board/);
    await anna.recordAnswer({ itemId: id(1), isCorrect: false, answer: 'x' });
    const generated = { id: 'lichess-00AbC', type: 'chess-puzzle', question: 'Mat 2', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', skills: ['chess.tactics.fork'], elo: 1450 };
    await anna.recordAnswer({ itemId: generated.id, isCorrect: true, answer: ['Qh5'], item: generated });
    await expect(anna.recordAnswer({ itemId: 'nope', isCorrect: true })).rejects.toThrow(/attach the item/);
    await expect(anna.recordAnswer({ itemId: 'other', isCorrect: true, item: generated })).rejects.toThrow(/item.id must equal itemId/);
    await expect(anna.recordAnswer({ itemId: id(1), isCorrect: true, answer: 'x'.repeat(5000) })).rejects.toThrow(/\[DATA_TOO_LARGE\]/);
    const answers = events.filter((e) => e.type === 'answer') as Extract<SessionEvent, { type: 'answer' }>[];
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({ playerId: 'anna', generated: false, skills: ['geo.capitals'], tags: ['eu'], answer: { answer: 'x' } });
    expect(answers[0].record).not.toBeNull();
    expect(answers[1]).toMatchObject({ generated: true, record: null, skills: ['chess.tactics.fork'], answer: { answer: ['Qh5'] } });
  });

  it('rate-limits messages', async () => {
    const { session } = newSession();
    await bare(session, 'board');
    const anna = await bare(session, 'anna');
    const results = await Promise.allSettled(Array.from({ length: 80 }, () => anna.send({ to: 'all', data: 1 })));
    expect(results.filter((r) => r.status === 'rejected').length).toBe(20);
  });

  it('accepts hello once per instance and only the first end(result)', async () => {
    const { session, events } = newSession();
    const board = await bare(session, 'board');
    await expect(board.hello({ ...handshake, protocol: '2.0' })).rejects.toThrow(/\[UNSUPPORTED_PROTOCOL\]/);
    await board.hello(handshake);
    await expect(board.hello(handshake)).rejects.toThrow(/\[INVALID_ARGUMENT\] hello may only be called once/);

    // A recreated instance says hello again; a recreated authority's end does not count twice.
    await board.end({ scores: { anna: 1 } });
    const reloaded = await session.reload('board');
    await expect(reloaded.hostApi.hello(handshake)).resolves.toMatchObject({ protocol: '1.0' });
    await expect(reloaded.hostApi.end({ scores: { anna: 2 } })).resolves.toBeUndefined();
    await reloaded.hostApi.end({ scores: { anna: 3 } });
    expect(events.filter((e) => e.type === 'result')).toEqual([{ type: 'result', result: { scores: { anna: 1 } } }]);
  });

  it('rate-limits answers (per player for the authority) and assets, drops extra error reports', async () => {
    const { session, events } = newSession();
    const board = await bare(session, 'board');
    const anna = await bare(session, 'anna');
    const rejected = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason.message));

    // Two players: the authority may record twice as many answers (its limit is per player).
    const forAll = rejected(
      await Promise.allSettled(Array.from({ length: 50 }, (_, i) => board.recordAnswer({ playerId: i % 2 ? 'anna' : 'ben', itemId: id(1), isCorrect: true }))),
    );
    expect(forAll).toHaveLength(10);

    const assets = rejected(await Promise.allSettled(Array.from({ length: 25 }, () => anna.getAsset('nope'))));
    expect(assets.filter((m) => m.startsWith('[ASSET_NOT_FOUND]'))).toHaveLength(20);
    expect(assets.filter((m) => m.startsWith('[RATE_LIMITED]'))).toHaveLength(5);

    const reports = await Promise.allSettled(Array.from({ length: 15 }, () => anna.reportError({ code: 'NOISY', message: 'again' })));
    expect(reports.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(events.filter((e) => e.type === 'pluginError' && e.code === 'NOISY')).toHaveLength(10);
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
  it('moves buckets up on correct answers and one down on mistakes (at least 1)', () => {
    const now = new Date('2026-10-04T10:00:00Z');
    const item = setFile.items[0];
    const first = leitner.apply(undefined, { itemId: 'x', isCorrect: true }, now, item);
    expect(first).toMatchObject({ bucket: 2, nextReviewAt: '2026-10-07T10:00:00.000Z', stats: { attempts: 1, incorrect: 0, streak: 1 } });
    const wrong = leitner.apply(first, { itemId: 'x', isCorrect: false, confidence: 1 }, now, item);
    expect(wrong).toMatchObject({ bucket: 1, stats: { attempts: 2, incorrect: 1, streak: 0 }, lastAnswer: { isCorrect: false, confidence: 1 } });
    const skipped = leitner.apply(wrong, { itemId: 'x', isCorrect: false, isSkipped: true }, now, item);
    expect(skipped.bucket).toBe(1);
    expect(skipped.stats.attempts).toBe(2);
  });

  it("keeps the learner's star and fields of a later OQSEP version, stores the answer", () => {
    const now = new Date('2026-10-04T10:00:00Z');
    const previous = { bucket: 2, starred: true, futureField: 1, stats: { attempts: 1, incorrect: 0, streak: 1, futureStat: 2 } } as any;
    const next = leitner.apply(previous, { itemId: 'x', isCorrect: false, answer: 'x', score: 0.5 }, now, setFile.items[0]) as any;
    expect(next).toMatchObject({ bucket: 1, starred: true, futureField: 1, stats: { attempts: 2, futureStat: 2 }, lastAnswer: { isCorrect: false, answer: 'x' } });
  });
});

describe('settings of a later protocol version', () => {
  it('are not shown, get their default and ignore sent values', async () => {
    const html = pluginHtml.replace(
      '"settings":[',
      '"settings":[{"id":"palette","type":"color","label":"Colour","default":{"r":1,"g":2,"b":3}},',
    );
    const loaded = loadPluginFromHtml(html);
    if (!loaded.success) throw new Error(loaded.errors.join('; '));
    expect(loaded.plugin.runtime.settings.map((s) => s.id)).toEqual(['rounds']);
    expect(loaded.plugin.runtime.unknownSettings.map((s) => s.id)).toEqual(['palette']);
    const session = new LocalSession({ plugin: loaded.plugin, set: setFile, mode: 'solo' });
    expect(session.settings).toEqual({ palette: { r: 1, g: 2, b: 3 }, rounds: 2 });
  });
});

describe('sandbox', () => {
  it('never allows the plugin to share the app origin', () => {
    expect(PLUGIN_SANDBOX).not.toContain('allow-same-origin');
    expect(PLUGIN_SANDBOX).not.toContain('allow-top-navigation');
    // Links open in a new tab that is a normal page (SPEC 8.4).
    expect(PLUGIN_SANDBOX.split(' ')).toEqual(expect.arrayContaining(['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-downloads']));
  });
});

describe('snapshots of finished games', () => {
  it('end(result) deletes the stored snapshot and ignores late saves; a reloaded authority still gets the last one', async () => {
    const storage = new MemoryStorage();
    const { session } = newSession({ sessionId: 'room-f', storage });
    const board = await bare(session, 'board');
    await board.saveSnapshot({ turn: 1 });
    await (session as any).flushSnapshot();
    expect(storage.snapshots.get('room-f')).toEqual({ turn: 1 });

    await board.end({ scores: {} });
    expect(storage.snapshots.has('room-f')).toBe(false);
    await board.saveSnapshot({ turn: 2, over: true }); // the SDK saves once more after the end
    await wait(700);
    expect(storage.snapshots.has('room-f')).toBe(false);

    const reloaded = await session.reload('board');
    const init = await reloaded.hostApi.hello(handshake);
    expect(init.snapshot).toEqual({ turn: 2, over: true });
    await session.end('closed');
    expect(storage.snapshots.has('room-f')).toBe(false);
  });

  it("end('finished') deletes the snapshot, end('closed') keeps it for continuing", async () => {
    const storage = new MemoryStorage();
    const closed = newSession({ sessionId: 'room-c', storage });
    await (await bare(closed.session, 'board')).saveSnapshot({ turn: 3 });
    await closed.session.end('closed');
    expect(storage.snapshots.get('room-c')).toEqual({ turn: 3 });

    const finished = newSession({ sessionId: 'room-c', storage });
    await (await bare(finished.session, 'board')).saveSnapshot({ turn: 4 });
    await finished.session.end('finished');
    expect(storage.snapshots.has('room-c')).toBe(false);
  });
});

describe('learning algorithm', () => {
  it('gets the answered item of the set (with its answers)', async () => {
    const apply = vi.fn<LearningAlgorithm['apply']>((previous, answer, now, item) => leitner.apply(previous, answer, now, item));
    const { session } = newSession({ algorithm: { id: 'custom', apply } });
    const board = await bare(session, 'board');
    await board.recordAnswer({ playerId: 'anna', itemId: id(1), isCorrect: true });
    expect(apply).toHaveBeenCalledTimes(1);
    const item = apply.mock.calls[0][3];
    expect(item).toMatchObject({ id: id(1), type: 'mcq-single' });
    expect(item).toHaveProperty('correctId');
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
    const second = newSession({ sessionId: 'room-1', storage, restore: true });
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
    const { session, events } = newSession({ sessionId: 'room-2', restore: true });
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

describe('changing the set of a running game (SPEC 7, protocol 1.1)', () => {
  const v2 = (title: string, items: object[]) =>
    loadOQSEFile({ version: '1.0', meta: { id: id(40), language: 'cs', title, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }, items }).data as OQSEFile;
  interface C { changes: { added: string[]; removed: string[]; changed: string[] }[] }
  const watcher: Omit<GameDefinition<C>, 'root'> = {
    initialState: () => ({ changes: [] }),
    actions: {},
    itemsChanged(state, ctx, change) {
      state.changes.push({ ...change, added: [...change.added], removed: [...change.removed] });
      expect(ctx.items.map((i) => i.id)).not.toContain(id(2));
    },
    render: (state, ui) =>
      `<p class="items">${ui.items.map((i: any) => `${i.question}${i.answerHidden ? '' : `=${i.correctId}`}`).join(',')}</p><p class="changes">${JSON.stringify(state.changes)}</p><p class="level">${ui.progress[id(41)]?.bucket ?? '-'}</p><p class="can">${ui.canChooseSet}</p>`,
  };

  it('the teacher reloads the set with edits: everyone gets the new items, the authority with answers, players with their progress', async () => {
    const storage = new MemoryStorage();
    await storage.saveProgress('anna', id(40), { [id(41)]: { bucket: 3, stats: { attempts: 2, incorrect: 0, streak: 2 } } });
    const { session, events } = newSession({ storage });
    const board = play(session, 'board', watcher);
    const anna = play(session, 'anna', watcher);
    const ben = play(session, 'ben', watcher);
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(150);
    expect(session.canChangeSet).toBe(true);

    const edited = v2('Set (edited)', [
      { id: id(1), type: 'mcq-single', question: 'A – better?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y' },
      { id: id(41), type: 'mcq-single', question: 'New?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'x' },
    ]);
    expect(await session.changeSet(edited)).toBe(true);
    await wait(150);
    expect(board.root.querySelector('.items')!.textContent).toBe('A – better?=y,New?=x');
    expect(anna.root.querySelector('.items')!.textContent).toBe('A – better?,New?'); // no answers on a player's device
    expect(JSON.parse(board.root.querySelector('.changes')!.textContent!)).toEqual([{ added: [id(41)], removed: [id(2)], changed: [id(1)] }]);
    expect(anna.root.querySelector('.level')!.textContent).toBe('3'); // Anna's progress in the new set
    expect(ben.root.querySelector('.level')!.textContent).toBe('-');
    expect(events.find((e) => e.type === 'setChanged')).toMatchObject({ setId: id(40), title: 'Set (edited)' });
    expect(session.prepared.set.meta.title).toBe('Set (edited)');
  });

  it('chooseSet: the board opens the app’s set picker; players may not; cancelling changes nothing', async () => {
    const picked: (OQSEFile | null)[] = [v2('Picked', [{ id: id(41), type: 'mcq-single', question: 'New?', options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'x' }]), null];
    const { session } = newSession({ chooseSet: async () => picked.shift() ?? null });
    let boardUi: any;
    let annaUi: any;
    const board = play(session, 'board', { ...watcher, render: (s, ui) => ((boardUi = ui), watcher.render(s, ui)) });
    play(session, 'anna', { ...watcher, render: (s, ui) => ((annaUi = ui), watcher.render(s, ui)) });
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(150);
    expect(boardUi.canChooseSet).toBe(true);
    expect(annaUi.canChooseSet).toBe(false);
    expect(await annaUi.chooseSet()).toBe(false);
    expect(await boardUi.chooseSet()).toBe(true);
    await wait(150);
    expect(board.root.querySelector('.items')!.textContent).toBe('New?=x');
    expect(await boardUi.chooseSet()).toBe(false); // cancelled
    expect(session.prepared.set.meta.title).toBe('Picked');
  });

  it('not with personal sets, and not without a game that supports it (an SDK 1.0 game)', async () => {
    const personal = newSession({ sets: 'personal' }).session;
    play(personal, 'board', watcher);
    await wait(100);
    expect(personal.canChangeSet).toBe(false);
    expect(await personal.changeSet(setFile)).toBe(false);

    const old = newSession().session;
    const host = await bare(old, 'board');
    await host.hello({ ...handshake, protocol: '1.0', features: ['set-changes'] });
    expect(old.canChangeSet).toBe(false); // 1.0: no features

    const { session } = newSession();
    play(session, 'board', watcher);
    await wait(100);
    expect(await session.changeSet(v2('Notes only', [{ id: id(42), type: 'note', content: 'x' }]))).toBe(false); // nothing this game plays
    expect(session.prepared.set.meta.title).toBe('Set');
  });
});
