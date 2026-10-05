/**
 * Load test: N bot players join a real room (production or local relay) and
 * play the AI guide's Quiz Race against a real host (Memizy Play in a browser).
 * Every bot runs the real plugin SDK and the real RelayPlayer (no iframe) and
 * clicks like a person: a random option 1–4 s after a question appears.
 *
 *   PIN=123456 RELAY_URL=https://mp.memizy.com ORIGIN=https://play.memizy.com BOTS=40 \
 *     bun x vitest run -c loadtest/vitest.config.ts
 *
 * Reports: join time, how fast the game reached every bot, and the answer
 * round trip (bot → relay → host board → relay → bot) per answer.
 */

import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import NodeWebSocket from 'ws';
import type { HostApi, PluginApi } from '@memizy/protocol';
import { startGame, type GameHandle } from '../../plugin-sdk/src/game/defineGame';
import { checkAnswer } from '../../plugin-sdk/src/checkAnswer';
import type { GameDefinition } from '../../plugin-sdk/src/types';
import { RelayPlayer, type FrameFactory } from '../src/relay/player';

const PIN = process.env.PIN ?? '';
const RELAY_URL = process.env.RELAY_URL ?? 'https://mp.memizy.com';
const ORIGIN = process.env.ORIGIN ?? 'https://play.memizy.com';
const BOTS = Number(process.env.BOTS ?? 40);

/** The relay only accepts the app's origin. */
class OriginWebSocket extends NodeWebSocket {
  constructor(url: string) {
    super(url, { origin: ORIGIN });
  }
}

/** Vitest hides console output of passing tests: the report also goes to REPORT (a file). */
function log(line: string): void {
  process.stdout.write(`${line}
`);
  if (process.env.REPORT) appendFileSync(process.env.REPORT, `${line}
`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]) : NaN;
};

/** Quiz Race's controller (rendering only; the actions run on the host's board). */
const quizRaceController: Omit<GameDefinition<any>, 'root'> = {
  initialState: () => ({}),
  actions: { answer() {}, timeUp() {}, next() {} },
  render(state, ui) {
    if (!state?.questions) return '<p>waiting</p>';
    if (state.phase === 'end') return '<p class="end">end</p>';
    const item = ui.item(state.questions[state.round]);
    if (!item) return '<p>waiting</p>';
    const options =
      item.type === 'true-false'
        ? [true, false]
        : (item as { options: unknown[] }).options.map((_: unknown, i: number) => i);
    const mine = ui.self ? state.answers[ui.self.id] : null;
    return `<div data-round="${state.round}" data-phase="${state.phase}">
      ${options.map((answer) => `<button ${mine || state.phase !== 'question' ? 'disabled' : ''} data-act="answer" data-payload='${JSON.stringify({ answer })}'>x</button>`).join('')}
      ${mine ? `<p class="sent">${checkAnswer(item, mine.answer) ? 'ok' : 'no'}</p>` : ''}
    </div>`;
  },
};

interface Bot {
  player: RelayPlayer;
  root: HTMLElement;
  game: GameHandle | null;
  joinedMs: number;
  firstStateAt: number | null;
  roundTrips: number[];
}

describe('load', () => {
  it(`${BOTS} bots play Quiz Race in room ${PIN}`, async () => {
    expect(PIN, 'Set PIN to the room shown by the host').toMatch(/^\d{6}$/);
    // The SDK reads the plugin manifest from its document.
    const manifest = document.createElement('script');
    manifest.type = 'application/oqse-manifest+json';
    const bundle = await (await fetch(new URL(`/api/rooms/${PIN}/bundle`, RELAY_URL))).json();
    manifest.textContent = /<script[^>]*application\/oqse-manifest\+json[^>]*>([\s\S]*?)<\/script>/.exec(bundle.pluginHtml)![1];
    document.head.appendChild(manifest);

    const bots: Bot[] = [];
    const t0 = performance.now();
    for (let i = 0; i < BOTS; i++) {
      // The "phone": RelayPlayer puts the plugin instance (the SDK root) into the container.
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = document.createElement('div');
      const bot: Bot = { player: null as unknown as RelayPlayer, root, game: null, joinedMs: 0, firstStateAt: null, roundTrips: [] };
      const createFrame: FrameFactory = (_html, _title, hostApi: HostApi) => {
        let resolvePlugin!: (api: PluginApi) => void;
        const plugin = new Promise<PluginApi>((r) => (resolvePlugin = r));
        bot.game?.destroy();
        bot.game = startGame({ ...quizRaceController, root }, {
          connector: async (pluginApi, handshake) => {
            resolvePlugin(pluginApi);
            await sleep(0);
            const init = await hostApi.hello(handshake);
            return { host: hostApi, init, standalone: false, destroy: () => {} };
          },
        });
        return { iframe: root, plugin, destroy: () => bot.game?.destroy() };
      };
      const started = performance.now();
      bot.player = new RelayPlayer({
        serverUrl: RELAY_URL,
        pin: PIN,
        name: `Bot ${String(i + 1).padStart(2, '0')}`,
        container: () => container,
        createFrame,
        WebSocket: OriginWebSocket as unknown as typeof WebSocket,
      });
      bot.player.on((e) => {
        if (e.type === 'joined') bot.joinedMs = performance.now() - started;
        if (e.type === 'error') log(`[load] bot ${i + 1}: ${e.code} ${e.message}`);
      });
      bots.push(bot);
      await sleep(50); // students do not join in the same millisecond
    }
    while (bots.some((b) => !b.joinedMs)) await sleep(100);
    log(`[load] ${BOTS} bots joined in ${Math.round(performance.now() - t0)} ms (join p50 ${percentile(bots.map((b) => b.joinedMs), 50)} ms, p95 ${percentile(bots.map((b) => b.joinedMs), 95)} ms)`);
    log('[load] waiting for the host to start the game…');

    // Play: answer every question like a person, measure the round trip.
    let startAt: number | null = null;
    const answered = new Map<Bot, string>();
    const pending = new Map<Bot, number>();
    const deadline = Date.now() + 14 * 60_000;
    while (Date.now() < deadline) {
      for (const bot of bots) {
        const view = bot.root.querySelector('[data-round]') as HTMLElement | null;
        if (view && bot.firstStateAt === null) {
          bot.firstStateAt = performance.now();
          startAt ??= bot.firstStateAt;
        }
        if (!view) continue;
        const key = `${view.dataset.round}`;
        const sentAt = pending.get(bot);
        if (sentAt !== undefined && bot.root.querySelector('.sent')) {
          bot.roundTrips.push(performance.now() - sentAt);
          pending.delete(bot);
        }
        if (view.dataset.phase === 'question' && answered.get(bot) !== key && !bot.root.querySelector('.sent')) {
          answered.set(bot, key);
          const buttons = [...bot.root.querySelectorAll('button:not([disabled])')] as HTMLButtonElement[];
          const choice = buttons[Math.floor(Math.random() * buttons.length)];
          setTimeout(() => {
            if (!choice.isConnected || choice.disabled) return;
            pending.set(bot, performance.now());
            choice.click();
          }, 1000 + Math.random() * 3000);
        }
      }
      if (bots.every((b) => b.root.querySelector('.end'))) break;
      await sleep(20);
    }

    const loaded = bots.filter((b) => b.firstStateAt !== null);
    const trips = bots.flatMap((b) => b.roundTrips);
    log(`[load] game reached ${loaded.length}/${BOTS} bots; spread of the first state ${startAt ? Math.round(Math.max(...loaded.map((b) => b.firstStateAt!)) - startAt) : NaN} ms`);
    log(`[load] answers: ${trips.length}; round trip p50 ${percentile(trips, 50)} ms, p95 ${percentile(trips, 95)} ms, max ${percentile(trips, 100)} ms`);
    log(`[load] finished: ${bots.filter((b) => b.root.querySelector('.end')).length}/${BOTS}`);
    bots.forEach((b) => b.player.leave());
    expect(loaded.length).toBe(BOTS);
  });
});
