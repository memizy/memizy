/**
 * End-to-end: the real multiplayer server (spawned with Bun), a RelayHost with
 * a LocalSession and RelayPlayers running the real plugin SDK.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import NodeWebSocket from 'ws';
import { resolve } from 'node:path';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import type { HostApi, PluginApi } from '@memizy/protocol';
import { startGame, type GameHandle } from '../../../plugin-sdk/src/game/defineGame';
import type { GameDefinition } from '../../../plugin-sdk/src/types';
import { LocalSession, type SessionEvent } from '../session';
import { MemoryStorage } from '../storage';
import { loadPluginFromHtml, type LoadedPlugin } from '../plugin';
import { RelayHost, type HostSeat } from './host';
import { RelayPlayer, type FrameFactory, type RelayPlayerEvent } from './player';
import { RELAY_APP_VERSION } from './messages';
import { RELAY_SOCKET_TIMING } from './socket';
import type { PersonalSet } from '../personal';
import { LIMITS, RELAY_PROTOCOL } from '@memizy/protocol';

const PORT = 18_787;
const serverUrl = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
// jsdom's Event class breaks Node's built-in WebSocket: use `ws`.
const WebSocketImpl = NodeWebSocket as unknown as typeof WebSocket;

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6b${String(n).padStart(2, '0')}`;
const manifest = {
  version: '1.0',
  id: 'https://example.com/plugins/relay-race',
  appName: 'Relay Race',
  pluginVersion: '1.0.0',
  capabilities: { actions: ['render'], types: ['mcq-single'] },
  appSpecific: { memizy: { protocol: '1.0', modes: { multiplayer: { players: { min: 1, max: 8 }, hostAs: ['presenter'], lateJoin: true } } } },
};
const pluginHtml = `<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`;
const setFile = loadOQSEFile({
  version: '1.0',
  meta: {
    id: id(0), language: 'cs', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    description: 'Pictures: <asset:max /> <asset:huge />', // public media (used by the public content)
    assets: {
      max: { type: 'image', value: 'https://example.com/max.png', altText: 'The largest guaranteed asset' },
      huge: { type: 'image', value: 'https://example.com/huge.png', altText: 'Too large for the relay' },
    },
  },
  items: [{ id: id(1), type: 'mcq-single', question: 'Who barks?', options: [{ id: 'cat', text: 'cat' }, { id: 'dog', text: 'dog' }], correctId: 'dog' }],
}).data as OQSEFile;

interface State { scores: Record<string, number> }
const race: Omit<GameDefinition<State>, 'root'> = {
  initialState: () => ({ scores: {} }),
  actions: {
    answer(state, _payload, ctx) {
      if (!ctx.playerId) return;
      state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 1;
      ctx.recordAnswer(ctx.items[0].id, true);
    },
  },
  render: (state, ui) =>
    ui.view === 'board'
      ? `<p class="total">${Object.values(state.scores).reduce((a, b) => a + b, 0)}</p>`
      : `<h1 class="q">${ui.html`${ui.items[0]?.type === 'mcq-single' ? (ui.items[0] as any).question : '?'}`}</h1><p class="hidden">${(ui.items[0] as any)?.answerHidden ? 'yes' : 'no'}</p><button data-act="answer">go</button><p class="score">${state.scores[ui.self!.id] ?? 0}</p><p class="clock">${Math.abs(ui.now - Date.now()) < 5000 ? 'ok' : 'skewed'}</p><p class="loc">${ui.locale}</p>`,
};

/**
 * A WebSocket whose network can be cut without a close (a half-open connection: a phone that
 * slept, a switched Wi-Fi). A cut socket sends nothing and hears nothing, not even its close;
 * sockets opened after the cut work (the network is back).
 */
const cutSockets = new WeakSet<object>();
class FlakyWebSocket extends NodeWebSocket {
  static open: FlakyWebSocket[] = [];
  constructor(url: string) {
    super(url);
    FlakyWebSocket.open.push(this);
  }
  override send(data: unknown, ...rest: unknown[]): void {
    if (!cutSockets.has(this)) (super.send as (...a: unknown[]) => void)(data, ...rest);
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (cutSockets.has(this) && (event === 'message' || event === 'close' || event === 'error')) return false;
    return super.emit(event, ...args);
  }
  /** Cuts the network of every socket opened so far. */
  static cut(): void {
    for (const socket of FlakyWebSocket.open.splice(0)) cutSockets.add(socket);
  }
}

const games: GameHandle[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await wait(25);
  }
}

/** The SDK connected directly to the RelayPlayer's host API (no iframe in jsdom). */
function sdkFrames(def: Omit<GameDefinition<any>, 'root'> = race): { factory: FrameFactory; roots: HTMLElement[]; ended: string[]; hosts: HostApi[] } {
  const roots: HTMLElement[] = [];
  const hosts: HostApi[] = []; // the host API each game got
  const ended: string[] = []; // sessionEnded reasons the games of this device got
  const factory: FrameFactory = (_html, _title, hostApi: HostApi) => {
    hosts.push(hostApi);
    const root = document.createElement('div');
    roots.push(root);
    let resolvePlugin!: (api: PluginApi) => void;
    const plugin = new Promise<PluginApi>((r) => (resolvePlugin = r));
    const game = startGame({ ...def, root }, {
      connector: async (pluginApi, handshake) => {
        resolvePlugin({ ...pluginApi, sessionEnded: async (reason) => { ended.push(reason); return pluginApi.sessionEnded(reason); } });
        await wait(0); // like Penpal: the host learns about the connection first
        const init = await hostApi.hello(handshake);
        return { host: hostApi, init, standalone: false, destroy: () => {} };
      },
    });
    games.push(game);
    return { iframe: root, plugin, destroy: () => game.destroy() };
  };
  return { factory, roots, ended, hosts };
}

/** The board of a session in this page, connected directly. */
function playBoard(session: LocalSession, def: Omit<GameDefinition<any>, 'root'> = race): HTMLElement {
  const boardRoot = document.createElement('div');
  document.body.appendChild(boardRoot);
  games.push(
    startGame({ ...def, root: boardRoot }, {
      connector: async (pluginApi, handshake) => {
        const instance = await session.connect('board', () => pluginApi);
        return { host: instance.hostApi, init: await instance.hostApi.hello(handshake), standalone: false, destroy: () => {} };
      },
    }),
  );
  return boardRoot;
}

function joinPlayer(pin: string, name: string, token?: string, locale?: string, auth?: string, WebSocket: typeof globalThis.WebSocket = WebSocketImpl, extra: { def?: Omit<GameDefinition<any>, 'root'>; personal?: () => PersonalSet | null } = {}) {
  const frames = sdkFrames(extra.def);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const events: RelayPlayerEvent[] = [];
  const player = new RelayPlayer({ serverUrl, WebSocket, pin, name, token, auth, container: () => container, createFrame: frames.factory, config: locale ? () => ({ locale }) : undefined, ...(extra.personal && { personal: extra.personal }) });
  player.on((e) => events.push(e));
  const root = () => frames.roots.at(-1);
  return { player, events, root, container, ended: frames.ended, hosts: frames.hosts };
}

let plugin: LoadedPlugin;

beforeAll(async () => {
  const loaded = loadPluginFromHtml(pluginHtml);
  if (!loaded.success) throw new Error(loaded.errors.join('; '));
  plugin = loaded.plugin;
  const script = document.createElement('script');
  script.type = 'application/oqse-manifest+json';
  script.textContent = JSON.stringify(manifest);
  document.head.appendChild(script);

  server = spawn('bun', [resolve(import.meta.dirname, '../../../../services/multiplayer-server/src/main.ts')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ALLOWED_ORIGINS: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolveStart, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not start')), 10_000);
    server.stdout!.on('data', (chunk: Buffer) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        resolveStart();
      }
    });
    server.on('exit', (code) => reject(new Error(`The server exited (${code})`)));
  });
}, 20_000);

afterAll(() => {
  games.forEach((g) => g.destroy());
  server?.kill();
});

describe('relayed multiplayer', () => {
  it('plays a game across the relay: join, start, sync, late join, rejoin, kick, close', async () => {
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    expect(host.pin).toMatch(/^\d{6}$/);

    const anna = joinPlayer(host.pin, 'Anna');
    const ben = joinPlayer(host.pin, 'Ben', undefined, 'en');
    await until(() => host.players.length === 2 && host.players.every((p) => p.connected));
    await until(() => anna.player.state?.phase === 'lobby');

    // The host starts the game.
    const session = new LocalSession({
      plugin,
      set: setFile,
      mode: 'multiplayer',
      hostAs: 'presenter',
      players: host.players.map((p) => ({ id: p.id, name: p.name })),
      countdownMs: 0,
      locale: 'cs',
      loadAsset: async (key) => new Blob([new Uint8Array(key === 'max' ? LIMITS.assetBytes : LIMITS.assetBytes * 2)], { type: 'image/png' }),
    });
    const events: SessionEvent[] = [];
    session.on((e) => events.push(e));
    await host.uploadBundle(plugin.html, session.prepared);
    host.attach(session);
    // Anyone with the PIN can download the bundle: it has no answers (SPEC 4.4).
    const bundle = await (await fetch(`${serverUrl}/api/rooms/${host.pin}/bundle`)).json();
    expect(bundle.set.items[0]).toMatchObject({ answerHidden: true, question: 'Who barks?' });
    expect(bundle.set.items[0]).not.toHaveProperty('correctId');

    const boardRoot = document.createElement('div');
    document.body.appendChild(boardRoot);
    games.push(
      startGame({ ...race, root: boardRoot }, {
        connector: async (pluginApi, handshake) => {
          const instance = await session.connect('board', () => pluginApi);
          return { host: instance.hostApi, init: await instance.hostApi.hello(handshake), standalone: false, destroy: () => {} };
        },
      }),
    );
    await session.start();
    await until(() => anna.player.state?.phase === 'running');
    await until(() => !!anna.root()?.querySelector('button') && !!ben.root()?.querySelector('button'));

    // The set came from the bundle, the clock is synchronized.
    expect(anna.root()!.querySelector('.q')!.textContent).toBe('Who barks?');
    expect(anna.root()!.querySelector('.hidden')!.textContent).toBe('yes');
    expect(anna.root()!.querySelector('.clock')!.textContent).toBe('ok');
    // Each device uses its own language (Ben's app is in English, the host's in Czech).
    expect(anna.root()!.querySelector('.loc')!.textContent).toBe('cs');
    expect(ben.root()!.querySelector('.loc')!.textContent).toBe('en');

    // Assets travel through the relay: the guaranteed size arrives; a larger one is refused
    // (a frame above the relay limit would close the host's connection).
    const annaHost = anna.hosts.at(-1)!;
    expect((await annaHost.getAsset('max')).size).toBe(LIMITS.assetBytes);
    await expect(annaHost.getAsset('huge')).rejects.toThrow(/\[DATA_TOO_LARGE\]/);
    expect(host.status).toBe('online');

    // Actions travel player → relay → host → board, state comes back.
    (anna.root()!.querySelector('button') as HTMLButtonElement).click();
    (ben.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => boardRoot.querySelector('.total')?.textContent === '2');
    await until(() => anna.root()!.querySelector('.score')?.textContent === '1');
    expect(events.filter((e) => e.type === 'answer')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'rejected' || e.type === 'pluginError')).toEqual([]);

    // A late player joins the running game.
    const cyril = joinPlayer(host.pin, 'Cyril');
    await until(() => session.players.length === 3);
    await until(() => !!cyril.root()?.querySelector('button'));
    (cyril.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => boardRoot.querySelector('.total')?.textContent === '3');

    // Anna reloads her page: she rejoins with her token as the same player and gets the state.
    const annaId = anna.player.playerId!;
    const token = anna.player.token!;
    anna.player.leave();
    await until(() => session.players.find((p) => p.id === annaId)?.connected === false);
    const anna2 = joinPlayer(host.pin, 'whatever', token);
    await until(() => anna2.player.playerId === annaId);
    await until(() => anna2.root()?.querySelector('.score')?.textContent === '1');
    expect(session.players.find((p) => p.id === annaId)?.connected).toBe(true);

    // The host removes Ben: his game hears why before it is removed.
    host.kick(ben.player.playerId!);
    await until(() => ben.events.some((e) => e.type === 'closed' && e.reason === 'kicked'));
    await until(() => session.players.length === 2);
    expect(ben.ended).toEqual(['kicked']);

    // The host closes the room: the game is taken away (closed), once.
    host.close();
    await until(() => anna2.events.some((e) => e.type === 'closed' && e.reason === 'host'));
    expect(anna2.ended).toEqual(['closed']);
    cyril.player.leave();
  }, 30_000);

  it('a player comes back: a reload without a clean close, reloads in a row, a reload while the game loads', async () => {
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const anna = joinPlayer(host.pin, 'Anna');
    await until(() => host.players.length === 1 && host.players[0].connected);
    const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0 });
    await host.uploadBundle(plugin.html, session.prepared);
    host.attach(session);
    const board = playBoard(session);
    await session.start();
    await until(() => !!anna.root()?.querySelector('button'));
    (anna.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '1');
    const annaId = anna.player.playerId!;
    const token = anna.player.token!;

    // A phone reloads the page, but the old connection is not closed first (the browser kept
    // it, or the relay has not noticed): the new page takes the place, the old one steps aside.
    const anna2 = joinPlayer(host.pin, 'Anna', token);
    await until(() => anna2.player.playerId === annaId);
    await until(() => anna2.root()?.querySelector('.score')?.textContent === '1');
    await until(() => anna.player.status === 'replaced');
    (anna2.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '2');
    await until(() => anna2.root()!.querySelector('.score')?.textContent === '2');

    // Two reloads in a row (a double tap on reload): the last page plays.
    const anna3 = joinPlayer(host.pin, 'Anna', token);
    const anna4 = joinPlayer(host.pin, 'Anna', token);
    await until(() => anna4.root()?.querySelector('.score')?.textContent === '2');
    await until(() => anna2.player.status === 'replaced' && anna3.player.status === 'replaced');
    (anna4.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '3');

    // A late player reloads while the game is still loading on the device.
    const ben = joinPlayer(host.pin, 'Ben');
    await until(() => ben.events.some((e) => e.type === 'joined'));
    const benToken = ben.player.token!;
    ben.player.leave();
    const ben2 = joinPlayer(host.pin, 'Ben', benToken);
    await until(() => !!ben2.root()?.querySelector('button'));
    (ben2.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '4');
    expect(session.players.map((p) => p.connected)).toEqual([true, true]);

    host.close();
  }, 30_000);

  it('a player who was away when the game started gets into it on coming back', async () => {
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const anna = joinPlayer(host.pin, 'Anna');
    const ben = joinPlayer(host.pin, 'Ben');
    await until(() => host.players.length === 2 && host.players.every((p) => p.connected));
    const benId = ben.player.playerId!;
    const benToken = ben.player.token!;

    // Ben switches to another app in the lobby: his connection closes, he stays in the room.
    ben.player.leave();
    await until(() => host.players.find((p) => p.id === benId)?.connected === false);

    // The teacher starts: like Play, the game gets the players connected now (Anna only).
    const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name })), countdownMs: 0 });
    await host.uploadBundle(plugin.html, session.prepared);
    host.attach(session);
    const board = playBoard(session);
    await session.start();
    await until(() => !!anna.root()?.querySelector('button'));
    expect(session.players.map((p) => p.id)).toEqual([anna.player.playerId]);

    // Ben comes back to the page: the same room player, now in the running game.
    const ben2 = joinPlayer(host.pin, 'Ben', benToken);
    await until(() => ben2.player.playerId === benId);
    await until(() => !!ben2.root()?.querySelector('button'), 8000);
    (ben2.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '1');
    expect(session.players.find((p) => p.id === benId)).toMatchObject({ name: 'Ben', connected: true });

    // The same when only his connection drops and comes back (no new page).
    const cyril = joinPlayer(host.pin, 'Cyril', undefined, undefined, undefined, FlakyWebSocket as unknown as typeof WebSocket);
    await until(() => !!cyril.root()?.querySelector('button')); // a late join while it runs
    host.close();
  }, 30_000);

  it('the teacher changes the set of the running game: the phones get it through the server, not the relay (protocol 1.1)', async () => {
    const show: Omit<GameDefinition<{ changes: number }>, 'root'> = {
      initialState: () => ({ changes: 0 }),
      actions: {},
      itemsChanged(state) { state.changes += 1; },
      render: (state, ui) => `<p class="items">${ui.items.map((i: any) => i.question + (i.answerHidden ? '' : '=' + i.correctId)).join(',')}</p><p class="changes">${state.changes}</p>`,
    };
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const anna = joinPlayer(host.pin, 'Anna', undefined, undefined, undefined, WebSocketImpl, { def: show });
    await until(() => host.players.length === 1 && host.players[0].connected);
    const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0 });
    await host.uploadBundle(plugin.html, session.prepared);
    host.attach(session);
    const board = playBoard(session, show);
    await session.start();
    await until(() => !!anna.root()?.querySelector('.items'));
    const big = loadOQSEFile({
      version: '1.0',
      meta: { id: id(80), language: 'cs', title: 'Velká sada', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      // About 120 kB: more than one relay frame may carry.
      items: Array.from({ length: 60 }, (_, n) => ({ id: `0192f0c4-7a1e-7c3b-9a52-${String(n).padStart(12, '0')}`, type: 'mcq-single', question: `Q${n} ${'x'.repeat(2000)}`, options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correctId: 'b' })),
    }).data as OQSEFile;
    expect(await session.changeSet(big)).toBe(true);
    await until(() => (anna.root()!.querySelector('.items')?.textContent ?? '').startsWith('Q0'));
    const phone = anna.root()!.querySelector('.items')!.textContent!;
    expect(phone.split(',')).toHaveLength(60);
    expect(phone).not.toContain('=b'); // still no answers on a phone
    expect(board.querySelector('.items')!.textContent).toContain('=b');
    await until(() => board.querySelector('.changes')?.textContent === '1');
    host.close();
  }, 30_000);

  it('after a reveal a phone gets the picture of the explanation through the relay (protocol 1.1, revealItems)', async () => {
    const original = URL.createObjectURL;
    let n = 0;
    URL.createObjectURL = () => `blob:null/url-${++n}`; // jsdom has no object URLs
    try {
      const set = loadOQSEFile({
        version: '1.0',
        meta: { id: id(70), language: 'cs', title: 'Zvířata', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        items: [{
          id: id(71), type: 'mcq-single', question: 'Kdo štěká?', options: [{ id: 'x', text: 'kočka' }, { id: 'y', text: 'pes' }], correctId: 'y',
          explanation: 'Takhle: <asset:back />', assets: { back: { type: 'image', value: 'media/back.png', altText: 'Pes' } },
        }],
      }).data as OQSEFile;
      const show: Omit<GameDefinition<{ shown: boolean }>, 'root'> = {
        initialState: () => ({ shown: false }),
        actions: { show(state, _p, ctx) { state.shown = true; ctx.reveal(ctx.items[0].id, { to: ctx.playerId! }); } },
        render: (state, ui) => {
          const item = ui.item(ui.items[0].id) as any;
          return `<button class="show" data-act="show">s</button><p class="back">${item?.assets?.back?.value ?? '-'}</p><p class="answer">${item?.answerHidden ? 'hidden' : item?.correctId}</p><p class="shown">${state.shown}</p>`;
        },
      };
      const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
      await until(() => host.status === 'online');
      const anna = joinPlayer(host.pin, 'Anna', undefined, undefined, undefined, WebSocketImpl, { def: show });
      const ben = joinPlayer(host.pin, 'Ben', undefined, undefined, undefined, WebSocketImpl, { def: show });
      await until(() => host.players.length === 2 && host.players.every((p) => p.connected));
      const assets: string[] = [];
      const session = new LocalSession({ plugin, set, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0, loadAsset: async (key) => { assets.push(key); return new Blob([key], { type: 'image/png' }); } });
      await host.uploadBundle(plugin.html, session.prepared);
      host.attach(session);
      const board = playBoard(session, show);
      await session.start();
      await until(() => !!anna.root()?.querySelector('.show') && !!ben.root()?.querySelector('.show'));
      expect(anna.root()!.querySelector('.back')!.textContent).toBe('-'); // hidden media never reach a player
      expect(board.querySelector('.back')!.textContent).toMatch(/^blob:/);

      (anna.root()!.querySelector('.show') as HTMLButtonElement).click(); // revealed to Anna only
      await until(() => anna.root()!.querySelector('.answer')?.textContent === 'y');
      await until(() => /^blob:/.test(anna.root()!.querySelector('.back')?.textContent ?? ''));
      expect(anna.root()!.querySelector('.back')!.textContent).not.toBe(board.querySelector('.back')!.textContent); // her own URL
      await wait(300);
      expect(ben.root()!.querySelector('.answer')!.textContent).toBe('hidden');
      expect(ben.root()!.querySelector('.back')!.textContent).toBe('-');
      host.close();
    } finally {
      URL.createObjectURL = original;
    }
  }, 30_000);

  it('personal sets: every phone learns its own set, checks and records it there; the host sees outcomes and set titles', async () => {
    const own = (n: number, title: string, question: string, right: string, wrong: string) =>
      loadOQSEFile({
        version: '1.0',
        meta: { id: id(50 + n), language: 'cs', title, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        items: [{ id: id(60 + n), type: 'mcq-single', question, options: [{ id: 'r', text: right }, { id: 'w', text: wrong }], correctId: 'r' }],
      }).data as OQSEFile;
    interface P { cur: Record<string, string | null>; scores: Record<string, number> }
    const quiz: Omit<GameDefinition<P>, 'root'> = {
      initialState: () => ({ cur: {}, scores: {} }),
      actions: {
        next(state, _p, ctx) { state.cur[ctx.playerId!] = ctx.nextItem(ctx.playerId)?.id ?? null; },
        answer(state, payload: { correct?: boolean }, ctx) {
          if (!ctx.personal) return;
          if (payload.correct) state.scores[ctx.playerId!] = (state.scores[ctx.playerId!] ?? 0) + 1;
          ctx.recordAnswer(state.cur[ctx.playerId!]!, payload.correct === true); // nothing on the host: the phone recorded it
          state.cur[ctx.playerId!] = null;
        },
      },
      render: (state, ui) => {
        if (ui.view === 'board') return `<p class="total">${Object.values(state.scores).reduce((a, b) => a + b, 0)}</p><p class="sets">${ui.players.map((p) => p.set?.title ?? '-').join(',')}</p>`;
        const cur = state.cur[ui.self!.id];
        const item = cur ? ui.item(cur) : undefined;
        return `<button class="next" data-act="next">next</button><p class="personal">${ui.personal}</p>${item ? ui.question(item, { action: 'answer' }) : ''}<p class="score">${state.scores[ui.self!.id] ?? 0}</p>`;
      },
    };
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const setA = own(1, 'Španělština', 'Perro?', 'pes', 'kočka');
    const setB = own(2, 'Chemie', 'H2O?', 'voda', 'sůl');
    const storageA = new MemoryStorage();
    const anna = joinPlayer(host.pin, 'Anna', undefined, undefined, undefined, WebSocketImpl, { def: quiz, personal: () => ({ file: setA, storage: storageA, userKey: 'anna' }) });
    const ben = joinPlayer(host.pin, 'Ben', undefined, undefined, undefined, WebSocketImpl, { def: quiz, personal: () => ({ file: setB, storage: new MemoryStorage(), userKey: 'ben' }) });
    await until(() => host.players.length === 2 && host.players.every((p) => p.connected));
    host.setState({ sets: 'personal' });
    const storageHost = new MemoryStorage();
    const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0, sets: 'personal', storage: storageHost });
    await host.uploadBundle(plugin.html, session.prepared, { full: true });
    host.attach(session);
    const board = playBoard(session, quiz);
    await session.start();
    await until(() => !!anna.root()?.querySelector('.next') && !!ben.root()?.querySelector('.next'));
    expect(anna.root()!.querySelector('.personal')!.textContent).toBe('true');
    await until(() => board.querySelector('.sets')?.textContent === 'Španělština,Chemie' || board.querySelector('.sets')?.textContent === 'Chemie,Španělština');

    // Each phone gets a question of its own set (the authority never had them).
    await wait(300); // the phones send their first picks
    (anna.root()!.querySelector('.next') as HTMLButtonElement).click();
    (ben.root()!.querySelector('.next') as HTMLButtonElement).click();
    await until(() => anna.root()!.querySelector('.mz-q-question')?.textContent?.trim() === 'Perro?' && ben.root()!.querySelector('.mz-q-question')?.textContent?.trim() === 'H2O?');
    const option = (r: HTMLElement, text: string) => [...r.querySelectorAll('.mz-q-opt')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    option(anna.root()!, 'pes').click();
    option(ben.root()!, 'sůl').click();
    await until(() => board.querySelector('.total')?.textContent === '1');
    await until(() => anna.root()!.querySelector('.score')?.textContent === '1');
    expect(ben.root()!.querySelector('.score')!.textContent).toBe('0');
    // The progress stays on the phone; the host stored nothing of the personal sets.
    await wait(200);
    expect((await storageA.loadProgress('anna', setA.meta.id))[id(61)]).toMatchObject({ bucket: 2 });
    expect(await storageHost.loadProgress(anna.player.playerId!, setA.meta.id)).toEqual({});

    // Anna switches her set mid-game (e.g. her AI added questions): the score stays, questions come from the new one.
    const setC = own(3, 'Němčina', 'Hund?', 'pes', 'kočka');
    expect(await anna.player.changePersonalSet({ file: setC, storage: storageA, userKey: 'anna' })).toBe(true);
    await until(() => board.querySelector('.sets')?.textContent?.includes('Němčina') ?? false);
    await wait(400); // the phone sends picks of the new set
    (anna.root()!.querySelector('.next') as HTMLButtonElement).click();
    await until(() => anna.root()!.querySelector('.mz-q-question')?.textContent?.trim() === 'Hund?');
    option(anna.root()!, 'pes').click();
    await until(() => anna.root()!.querySelector('.score')?.textContent === '2');

    // …and back to the teacher's set (null), e.g. a late joiner who tried their own first.
    expect(await anna.player.changePersonalSet(null)).toBe(true);
    await until(() => {
      const titles = board.querySelector('.sets')?.textContent?.split(',') ?? [];
      return !titles.includes('Němčina') && titles.includes('Set');
    });
    host.close();
  }, 30_000);

  it('a player comes back after a dead connection (a phone that slept, a switched network)', async () => {
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const anna = joinPlayer(host.pin, 'Anna', undefined, undefined, undefined, FlakyWebSocket as unknown as typeof WebSocket);
    await until(() => host.players.length === 1 && host.players[0].connected);
    const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0 });
    await host.uploadBundle(plugin.html, session.prepared);
    host.attach(session);
    const board = playBoard(session);
    await session.start();
    await until(() => !!anna.root()?.querySelector('button'));
    const root = anna.root()!;

    // The page becomes visible again on a dead connection: the app checks it and reconnects.
    FlakyWebSocket.cut();
    anna.player.reconnectNow();
    await until(() => anna.events.some((e) => e.type === 'status' && e.status === 'offline'), 6000);
    await until(() => anna.player.status === 'online', 6000);
    (anna.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '1');
    expect(anna.root()).toBe(root); // the same game instance went on, no reload

    // Nobody looks: the heartbeat finds the dead connection by itself.
    const timing = { ...RELAY_SOCKET_TIMING };
    Object.assign(RELAY_SOCKET_TIMING, { pingMs: 200, deadMs: 500 });
    try {
      anna.player.reconnectNow(); // restarts the heartbeat with the short timing
      FlakyWebSocket.cut();
      const offline = anna.events.filter((e) => e.type === 'status' && e.status === 'offline').length;
      await until(() => anna.events.filter((e) => e.type === 'status' && e.status === 'offline').length > offline, 4000);
      await until(() => anna.player.status === 'online', 6000);
    } finally {
      Object.assign(RELAY_SOCKET_TIMING, timing);
    }
    (anna.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board.querySelector('.total')?.textContent === '2');
    await until(() => anna.root()!.querySelector('.score')?.textContent === '2');

    host.close();
  }, 30_000);

  it("the host's dead connection is found by its heartbeat; the game goes on", async () => {
    const timing = { ...RELAY_SOCKET_TIMING };
    Object.assign(RELAY_SOCKET_TIMING, { pingMs: 200, deadMs: 500 });
    try {
      const host = await RelayHost.create({ serverUrl, WebSocket: FlakyWebSocket as unknown as typeof WebSocket });
      await until(() => host.status === 'online');
      const anna = joinPlayer(host.pin, 'Anna');
      await until(() => host.players.length === 1 && host.players[0].connected);
      const session = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0 });
      await host.uploadBundle(plugin.html, session.prepared);
      host.attach(session);
      const board = playBoard(session);
      await session.start();
      await until(() => !!anna.root()?.querySelector('button'));
      const statuses: string[] = [];
      host.on((e) => e.type === 'status' && statuses.push(e.status));

      // The teacher's computer loses its connection without a close (the Wi-Fi switched).
      FlakyWebSocket.cut();
      await until(() => statuses.includes('offline'), 4000);
      await until(() => host.status === 'online', 6000);
      (anna.root()!.querySelector('button') as HTMLButtonElement).click();
      await until(() => board.querySelector('.total')?.textContent === '1');
      await until(() => anna.root()!.querySelector('.score')?.textContent === '1');
      expect(anna.player.status).toBe('online');
      host.close();
    } finally {
      Object.assign(RELAY_SOCKET_TIMING, timing);
    }
  }, 30_000);

  it('continues a saved game in a new room: devices take the earlier places, the host can change them', async () => {
    const storage = new MemoryStorage();
    const sessionId = 'saved-game-1';

    // The first lesson: Anna and Ben play, then the host saves the game for later.
    const host1 = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host1.status === 'online');
    const anna = joinPlayer(host1.pin, 'Anna');
    const ben = joinPlayer(host1.pin, 'Ben');
    await until(() => host1.players.length === 2 && host1.players.every((p) => p.connected));
    const first = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: host1.players.map((p) => ({ id: p.id, name: p.name })), countdownMs: 0, sessionId, storage, shuffleSeed: 'seed-1' });
    await host1.uploadBundle(plugin.html, first.prepared);
    host1.attach(first);
    const board1 = playBoard(first);
    await first.start();
    await until(() => !!anna.root()?.querySelector('button'));
    const annaId = anna.player.playerId!;
    const benId = ben.player.playerId!;
    (anna.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board1.querySelector('.total')?.textContent === '1');
    await until(() => JSON.stringify(storage.snapshots.get(sessionId) ?? null).includes(`"${annaId}":1`));
    first.pause();
    const saved = { players: first.players.map(({ id, name, isHost }) => ({ id, name, isHost })), clock: { pausedMs: first.clock.pausedMs ?? 0, pausedAt: first.clock.pausedAt ?? null } };
    await first.end('closed');
    host1.close();
    await until(() => anna.events.some((e) => e.type === 'closed'));

    // The next lesson: a new room, new devices with new nicknames.
    const host2 = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host2.status === 'online');
    const seatEvents: HostSeat[][] = [];
    host2.on((e) => e.type === 'seats' && seatEvents.push(e.seats));
    const dana = joinPlayer(host2.pin, 'Dana');
    const eva = joinPlayer(host2.pin, 'Eva');
    const filip = joinPlayer(host2.pin, 'Filip');
    await until(() => host2.players.length === 3 && host2.players.every((p) => p.connected));
    const second = new LocalSession({ plugin, set: setFile, mode: 'multiplayer', hostAs: 'presenter', players: saved.players, countdownMs: 0, sessionId, storage, shuffleSeed: 'seed-1', restore: true, clock: saved.clock });
    expect(second.paused).toBe(true); // continued games start paused
    await host2.uploadBundle(plugin.html, second.prepared);
    host2.attach(second, { seats: true });
    const board2 = playBoard(second);
    await until(() => board2.querySelector('.total')?.textContent === '1'); // resumed from the snapshot
    expect(second.players.every((p) => !p.connected)).toBe(true); // nobody sits yet

    // Devices see the places (the earlier nicknames) and choose.
    await until(() => dana.player.state?.seats?.length === 2 && dana.player.seat === null);
    expect(dana.player.state!.seats!.map((s) => s.name).sort()).toEqual(['Anna', 'Ben']);
    expect(dana.player.state!.newPlayers).toBe(true);
    dana.player.claimSeat(annaId);
    await until(() => dana.player.seat === annaId);
    expect(dana.player.name).toBe('Anna'); // the place keeps its nickname
    await until(() => dana.root()?.querySelector('.score')?.textContent === '1'); // Anna's score
    expect(second.players.find((p) => p.id === annaId)).toMatchObject({ name: 'Anna', connected: true });

    // Eva tries the same place (taken), then joins as a new player.
    eva.player.claimSeat(annaId);
    await until(() => eva.events.filter((e) => e.type === 'seat').length >= 2);
    expect(eva.player.seat).toBeNull();
    eva.player.claimSeat(null);
    await until(() => typeof eva.player.seat === 'string');
    expect(eva.player.seat).toBe(eva.player.playerId);
    expect(second.players).toHaveLength(3);

    // The teacher puts Filip on Ben's place, then changes their mind.
    host2.assignSeat(filip.player.playerId!, benId);
    await until(() => filip.player.seat === benId && filip.player.name === 'Ben');
    await until(() => !!filip.root()?.querySelector('button'));
    expect(host2.seats.find((s) => s.id === benId)?.roomPlayerId).toBe(filip.player.playerId);
    expect(host2.seatAssignments).toMatchObject({ [dana.player.playerId!]: annaId, [filip.player.playerId!]: benId });

    // Paused: nothing happens. The teacher continues, and Anna's place plays on.
    (dana.root()!.querySelector('button') as HTMLButtonElement).click();
    await wait(300);
    expect(board2.querySelector('.total')?.textContent).toBe('1');
    second.resume();
    await wait(500); // the resume reaches the devices through the relay
    (dana.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board2.querySelector('.total')?.textContent === '2');
    await until(() => dana.root()!.querySelector('.score')?.textContent === '2');

    // The host page reloads: the places are attached again from the saved assignments.
    host2.attach(second, { seats: true, taken: host2.seatAssignments });
    await until(() => dana.player.seat === annaId && !!dana.root()?.querySelector('button'));
    await wait(300);
    (dana.root()!.querySelector('button') as HTMLButtonElement).click();
    await until(() => board2.querySelector('.total')?.textContent === '3');

    host2.assignSeat(filip.player.playerId!, null);
    await until(() => filip.player.seat === null);
    expect(second.players.find((p) => p.id === benId)?.connected).toBe(false);
    expect(seatEvents.at(-1)!.find((s) => s.id === benId)?.roomPlayerId).toBeNull();

    host2.close();
    for (const p of [ben, dana, eva, filip]) p.player.leave();
  }, 30_000);

  it('app versions, unknown methods and auth between the host and player apps', async () => {
    const host = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => host.status === 'online');
    const anna = joinPlayer(host.pin, 'Anna', undefined, undefined, 'signed-anna');
    await until(() => anna.player.playerId !== null && host.appVersionOf(anna.player.playerId) !== null);
    expect(host.appVersionOf(anna.player.playerId!)).toBe(RELAY_APP_VERSION);
    expect(host.players.find((p) => p.id === anna.player.playerId)?.auth).toBe('signed-anna');

    // An older player app (no version) and a call of a method this host does not know.
    const raw = new NodeWebSocket(serverUrl.replace('http', 'ws') + '/ws');
    const received: any[] = [];
    raw.on('message', (data) => received.push(JSON.parse(String(data))));
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ t: 'join', protocol: RELAY_PROTOCOL, pin: host.pin, name: 'Old' }));
    await until(() => received.some((m) => m.t === 'joined'));
    const oldId = received.find((m) => m.t === 'joined').playerId;
    raw.send(JSON.stringify({ t: 'up', data: { k: 'hello', gen: 0 } }));
    await until(() => host.appVersionOf(oldId) !== null);
    expect(host.appVersionOf(oldId)).toBe(0);
    raw.send(JSON.stringify({ t: 'up', data: { k: 'call', id: 7, gen: 0, method: 'shinyNewMethod', args: [] } }));
    await until(() => received.some((m) => m.t === 'data' && m.data.k === 'result' && m.data.id === 7));
    const result = received.find((m) => m.t === 'data' && m.data.k === 'result' && m.data.id === 7).data;
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^\[UNKNOWN_METHOD\]/) } });
    raw.send(JSON.stringify({ t: 'up', data: { k: 'call', id: 8, gen: 0, method: 'send', args: [] } }));
    await until(() => received.some((m) => m.t === 'data' && m.data.k === 'result' && m.data.id === 8));
    expect(received.find((m) => m.t === 'data' && m.data.id === 8).data.error.message).toMatch(/^\[SESSION_ENDED\]/); // a known method, no instance

    raw.close();
    anna.player.leave();
    host.close();
  });

  it('a second host connection takes the room over without a reconnect fight', async () => {
    const first = await RelayHost.create({ serverUrl, WebSocket: WebSocketImpl });
    await until(() => first.status === 'online');
    const statuses: string[] = [];
    first.on((e) => e.type === 'status' && statuses.push(e.status));
    // e.g. the host page opened again in another tab (the room is resumed from sessionStorage)
    const second = RelayHost.rejoin({ serverUrl, WebSocket: WebSocketImpl }, { pin: first.pin, hostToken: first.hostToken });
    await until(() => second.status === 'online');
    await until(() => first.status === 'replaced');
    await wait(2000); // the old one must not reconnect and push the new one out
    expect(second.status).toBe('online');
    expect(first.status).toBe('replaced');
    expect(statuses.filter((s) => s === 'online')).toEqual([]);
    second.close();
  });

  it('rejects a wrong PIN', async () => {
    const lost = joinPlayer('999999', 'Lost');
    await until(() => lost.events.some((e) => e.type === 'error'));
    expect(lost.events.find((e) => e.type === 'error')).toMatchObject({ code: 'ROOM_NOT_FOUND', fatal: true });
    await until(() => lost.player.status === 'closed');
  });
});
