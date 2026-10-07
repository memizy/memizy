import { afterEach, describe, expect, it } from 'vitest';
import { LocalSession, loadPluginFromHtml, type SessionEvent } from '@memizy/host-sdk';
import { loadOQSEFile, type OQSEFile } from '@memizy/oqse';
import { startGame, type GameHandle } from '../../../../packages/plugin-sdk/src/game/defineGame';
import type { GameDefinition } from '../../../../packages/plugin-sdk/src/types';
import { actionNames, runChaosPlayer } from './chaosPlayer';

const games: GameHandle[] = [];
afterEach(() => {
  games.splice(0).forEach((g) => g.destroy());
  document.body.innerHTML = '';
});

const manifest = {
  version: '0.2',
  id: 'https://example.com/plugins/chaos-test',
  appName: 'Chaos test',
  capabilities: { actions: ['render'], types: ['mcq-single'] },
  appSpecific: { memizy: { protocol: '1.0', modes: { multiplayer: { players: { min: 1, max: 4 }, hostAs: ['presenter'] } } } },
};
const set = loadOQSEFile({
  version: '0.3',
  meta: { id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6c00', language: 'cs', title: 'S', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  items: [{ id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6c01', type: 'mcq-single', question: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctId: 'b' }],
}).data as OQSEFile;

type S = { phase: string; answers: Record<string, string>; round: number };

/** A careful game: validates everything. */
const careful: Omit<GameDefinition<S>, 'root'> = {
  initialState: () => ({ phase: 'question', answers: {}, round: 0 }),
  actions: {
    answer(state, payload, ctx) {
      if (state.phase !== 'question' || !ctx.playerId || state.answers[ctx.playerId]) return;
      if (payload?.answer !== 'a' && payload?.answer !== 'b') return;
      state.answers[ctx.playerId] = payload.answer;
    },
    next(state, _p, ctx) {
      if (!ctx.fromHost) return;
      state.round += 1;
    },
  },
  render: () => '<button data-act="answer">a</button><button data-act="next">n</button>',
};

/** A sloppy game: trusts payloads and lets anybody press "next". */
const sloppy: Omit<GameDefinition<S>, 'root'> = {
  initialState: () => ({ phase: 'question', answers: {}, round: 0 }),
  actions: {
    answer(state, payload, ctx) {
      state.answers[ctx.playerId!] = payload.answer.toUpperCase(); // crashes on bad payloads
    },
    next(state) {
      state.round += 1;
    },
  },
  render: () => '<button data-act="answer">a</button><button data-act="next">n</button>',
};

async function chaos(def: Omit<GameDefinition<S>, 'root'>) {
  const html = `<!doctype html><script type="application/oqse-manifest+json">${JSON.stringify(manifest)}</script><button data-act="answer"></button><button data-act="next"></button>`;
  const loaded = loadPluginFromHtml(html);
  if (!loaded.success) throw new Error(loaded.errors.join());
  const session = new LocalSession({ plugin: loaded.plugin, set, mode: 'multiplayer', hostAs: 'presenter', players: [{ id: 'chaos', name: 'Nick' }], countdownMs: 0 });
  const events: SessionEvent[] = [];
  session.on((e) => events.push(e));
  const root = document.createElement('div');
  document.body.appendChild(root);
  games.push(
    startGame({ ...def, root }, {
      connector: async (pluginApi, handshake) => {
        const instance = await session.connect('board', () => pluginApi);
        return { host: instance.hostApi, init: await instance.hostApi.hello(handshake), standalone: false, destroy: () => {} };
      },
    }),
  );
  await games[0].ready;
  const started = session.start();
  const problems = () => events.flatMap((e) => (e.type === 'pluginError' ? [`${e.address}: ${e.code}: ${e.message}`] : []));
  const report = await runChaosPlayer(session, 'chaos', html, problems);
  await started;
  await session.end();
  return report;
}

describe('the naughty player', () => {
  it('finds the actions in the HTML', () => {
    expect(actionNames(`<button data-act="answer"></button><b data-act='buy'></b> ui.act('fire', {}); game.act("aim")`)).toEqual(['answer', 'buy', 'fire', 'aim']);
  });

  it('a careful game passes', async () => {
    const report = await chaos(careful);
    expect(report).toMatchObject({ crashes: [], changed: [], teacher: [] });
  }, 30_000);

  it('a sloppy game: crashes, changed state and a teacher action from a player', async () => {
    const report = await chaos(sloppy);
    expect(report.crashes.join()).toMatch(/"answer"/);
    expect(report.teacher.join()).toMatch(/"next"/);
  }, 30_000);
});
