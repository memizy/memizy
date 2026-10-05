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
import { loadPluginFromHtml, type LoadedPlugin } from '../plugin';
import { RelayHost } from './host';
import { RelayPlayer, type FrameFactory, type RelayPlayerEvent } from './player';

const PORT = 18_787;
const serverUrl = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
// jsdom's Event class breaks Node's built-in WebSocket: use `ws`.
const WebSocketImpl = NodeWebSocket as unknown as typeof WebSocket;

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6b${String(n).padStart(2, '0')}`;
const manifest = {
  version: '0.2',
  id: 'https://example.com/plugins/relay-race',
  appName: 'Relay Race',
  pluginVersion: '1.0.0',
  capabilities: { actions: ['render'], types: ['mcq-single'] },
  appSpecific: { memizy: { protocol: '1.0', modes: { multiplayer: { players: { min: 1, max: 8 }, hostAs: ['presenter'], lateJoin: true } } } },
};
const pluginHtml = `<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script>`;
const setFile = loadOQSEFile({
  version: '0.2',
  meta: { id: id(0), language: 'cs', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [{ id: id(1), type: 'mcq-single', question: 'Who barks?', options: ['cat', 'dog'], correctIndex: 1 }],
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
      : `<h1 class="q">${ui.escape(ui.items[0]?.type === 'mcq-single' ? (ui.items[0] as any).question : '?')}</h1><button data-act="answer">go</button><p class="score">${state.scores[ui.self!.id] ?? 0}</p><p class="clock">${Math.abs(ui.now() - Date.now()) < 5000 ? 'ok' : 'skewed'}</p><p class="loc">${ui.locale}</p>`,
};

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
function sdkFrames(): { factory: FrameFactory; roots: HTMLElement[] } {
  const roots: HTMLElement[] = [];
  const factory: FrameFactory = (_html, _title, hostApi: HostApi) => {
    const root = document.createElement('div');
    roots.push(root);
    let resolvePlugin!: (api: PluginApi) => void;
    const plugin = new Promise<PluginApi>((r) => (resolvePlugin = r));
    const game = startGame({ ...race, root }, {
      connector: async (pluginApi, handshake) => {
        resolvePlugin(pluginApi);
        await wait(0); // like Penpal: the host learns about the connection first
        const init = await hostApi.hello(handshake);
        return { host: hostApi, init, standalone: false, destroy: () => {} };
      },
    });
    games.push(game);
    return { iframe: root, plugin, destroy: () => game.destroy() };
  };
  return { factory, roots };
}

function joinPlayer(pin: string, name: string, token?: string, locale?: string) {
  const frames = sdkFrames();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const events: RelayPlayerEvent[] = [];
  const player = new RelayPlayer({ serverUrl, WebSocket: WebSocketImpl, pin, name, token, container: () => container, createFrame: frames.factory, config: locale ? () => ({ locale }) : undefined });
  player.on((e) => events.push(e));
  const root = () => frames.roots.at(-1);
  return { player, events, root, container };
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
    });
    const events: SessionEvent[] = [];
    session.on((e) => events.push(e));
    await host.uploadBundle(plugin.html, session.prepared.set);
    host.attach(session);

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
    expect(anna.root()!.querySelector('.clock')!.textContent).toBe('ok');
    // Each device uses its own language (Ben's app is in English, the host's in Czech).
    expect(anna.root()!.querySelector('.loc')!.textContent).toBe('cs');
    expect(ben.root()!.querySelector('.loc')!.textContent).toBe('en');

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

    // The host removes Ben.
    host.kick(ben.player.playerId!);
    await until(() => ben.events.some((e) => e.type === 'closed' && e.reason === 'kicked'));
    await until(() => session.players.length === 2);

    // The host closes the room.
    host.close();
    await until(() => anna2.events.some((e) => e.type === 'closed' && e.reason === 'host'));
    cyril.player.leave();
  }, 30_000);

  it('rejects a wrong PIN', async () => {
    const lost = joinPlayer('999999', 'Lost');
    await until(() => lost.events.some((e) => e.type === 'error'));
    expect(lost.events.find((e) => e.type === 'error')).toMatchObject({ code: 'ROOM_NOT_FOUND', fatal: true });
    await until(() => lost.player.status === 'closed');
  });
});
