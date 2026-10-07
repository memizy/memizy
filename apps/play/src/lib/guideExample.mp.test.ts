import { afterEach, describe, expect, it } from 'vitest';
import { LocalSession, loadPluginFromHtml, type SessionEvent } from '@memizy/host-sdk';
import { checkAnswer } from '../../../../packages/plugin-sdk/src/checkAnswer';
import { startGame, type GameHandle } from '../../../../packages/plugin-sdk/src/game/defineGame';
import type { GameDefinition } from '../../../../packages/plugin-sdk/src/types';
import { EXAMPLE_PLUGINS } from './plugins';
import { BUILTIN_SETS } from './sets';

const games: GameHandle[] = [];
afterEach(() => {
  games.splice(0).forEach((g) => g.destroy());
  document.body.innerHTML = '';
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The guide example's game definition (its module script run with the real SDK pieces). */
function guideDefinition(html: string): GameDefinition<any> {
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1].replace(/^\s*import .*?;\s*$/m, 'const { defineGame, checkAnswer } = __sdk;');
  let def: GameDefinition<any> | null = null;
  new Function('__sdk', 'document', script)({ defineGame: (d: GameDefinition<any>) => { def = d; return { act() {} }; }, checkAnswer }, { getElementById: () => null });
  return def!;
}

describe('the AI guide example in multiplayer', () => {
  it('phases, ui.question, playerView and the reveal work across a board and two players', async () => {
    const example = EXAMPLE_PLUGINS.find((p) => p.key === 'quiz-race')!;
    const loaded = loadPluginFromHtml(example.html);
    if (!loaded.success) throw new Error(loaded.errors.join());
    const set = BUILTIN_SETS.find((s) => s.file.items.some((i) => i.type === 'mcq-single'))!.file;
    const onlyMcq = { ...set, items: set.items.filter((i) => i.type === 'mcq-single').slice(0, 3) };
    const session = new LocalSession({ plugin: loaded.plugin, set: onlyMcq, mode: 'multiplayer', hostAs: 'presenter', players: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }], countdownMs: 0, settings: { questionTime: 30, questionCount: 3 } });
    const events: SessionEvent[] = [];
    session.on((e) => events.push(e));
    const def = guideDefinition(example.html);
    // The SDK reads the manifest from its document (as in the real iframe).
    const island = document.createElement('script');
    island.type = 'application/oqse-manifest+json';
    island.textContent = JSON.stringify(loaded.plugin.manifest);
    document.head.appendChild(island);
    const roots: Record<string, HTMLElement> = {};
    for (const address of ['board', 'anna', 'ben']) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      roots[address] = root;
      games.push(
        startGame({ ...def, root }, {
          connector: async (pluginApi, handshake) => {
            const instance = await session.connect(address, () => pluginApi);
            return { host: instance.hostApi, init: await instance.hostApi.hello(handshake), standalone: false, destroy: () => {} };
          },
        }),
      );
    }
    await Promise.all(games.map((g) => g.ready));
    await session.start();
    await wait(200);
    expect(roots.board.textContent).toMatch(/Otázka 1 \/ 3/);
    expect(roots.board.textContent).toMatch(/Odpovědělo 0 \/ 2/);

    // Anna answers: Ben must not see her answer before the reveal.
    const annaOption = roots.anna.querySelector<HTMLButtonElement>('.mz-q-opt[data-act="answer"]')!;
    const annaAnswer = JSON.parse(annaOption.getAttribute('data-payload')!).answer;
    annaOption.click();
    await wait(200);
    expect(roots.board.textContent).toMatch(/Odpovědělo 1 \/ 2/);
    const toBen = events.filter((e) => e.type === 'traffic' && e.to === 'ben').map((e) => JSON.stringify((e as { data: unknown }).data)).join();
    expect(toBen).not.toContain(`"answer":${JSON.stringify(annaAnswer)}`);
    expect(toBen).toContain(`"answered":true`);
    expect(roots.anna.querySelector('.mz-q-chosen')).not.toBeNull();

    // Ben answers: everyone answered → the reveal, with the right option marked on the phones.
    roots.ben.querySelector<HTMLButtonElement>('.mz-q-opt[data-act="answer"]')!.click();
    await wait(300);
    expect(roots.anna.querySelector('.mz-q-right')).not.toBeNull();
    expect(roots.anna.textContent).toMatch(/Správně|Špatně/);
    expect(events.filter((e) => e.type === 'answer')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'pluginError' || e.type === 'rejected').map((e) => JSON.stringify(e))).toEqual([]);

    // The teacher's "next" works, a player's does not.
    roots.anna.querySelector<HTMLButtonElement>('button[data-act="next"]')?.click();
    roots.board.querySelector<HTMLButtonElement>('button[data-act="next"]')!.click();
    await wait(300);
    expect(roots.board.textContent).toMatch(/Otázka 2 \/ 3/);
  }, 20_000);
});
