import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { checkAnswer } from '../../../../packages/plugin-sdk/src/checkAnswer';
import { FakeSession } from '../../../../packages/plugin-sdk/src/test/fakeHost';
import type { GameDefinition } from '../../../../packages/plugin-sdk/src/types';
import html from '@/data/plugins/babis-vs-alzak.html?raw';

/** Runs the plugin's module script with a fake SDK and returns its game definition. */
function definition(): GameDefinition<any> {
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1].replace(/^\s*import .*?;\s*$/m, 'const { defineGame, checkAnswer } = __sdk;');
  let def: GameDefinition<any> | null = null;
  new Function('__sdk', script)({ defineGame: (d: GameDefinition<any>) => { def = d; return { act() {} }; }, checkAnswer });
  return def!;
}

const items: OQSEAnyItem[] = Array.from({ length: 16 }, (_, i) =>
  (i % 2
    ? { id: `t${i}`, type: 'true-false', question: `T${i}?`, correctAnswer: i % 4 === 1 }
    : { id: `m${i}`, type: 'mcq-single', question: `M${i}?`, options: ['a', 'b', 'c', 'd'], correctIndex: i % 4 }) as OQSEAnyItem,
);
const correctOf = (id: string) => {
  const item = items.find((i) => i.id === id)! as any;
  return item.type === 'true-false' ? item.correctAnswer : item.correctIndex;
};
const wrongOf = (id: string) => {
  const c = correctOf(id);
  return typeof c === 'boolean' ? !c : (c + 1) % 4;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

function currentItem(state: any): string {
  return state.stage === 'quiz' ? state.quizIds[state.quizRound] : state.battleIds[state.battleRound % state.battleIds.length];
}

describe('Babiš vs. Alzák rules', () => {
  it('a full multiplayer game: fair teams, shop, no repeated quote, an end', async () => {
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben', 'cyril'], items, settings: { questionTime: 10, questionCount: 3, battleRounds: 6 } });
    session.start();
    await tick();
    const board = () => session.get('board').state;
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'babis' });
    session.get('cyril').dispatch('chooseTeam', { team: 'alzak' });
    await tick();
    await tick(2600);
    expect(board().phase).toBe('question');
    expect(board().maxHp).toEqual({ babis: 340, alzak: 340 }); // from the bigger team

    const lines: string[] = [];
    const seen = new Set<number>();
    let guard = 0;
    while (board().phase !== 'end' && guard++ < 200) {
      const s = board();
      if (!seen.has(s.dialogue.id)) { seen.add(s.dialogue.id); lines.push(...s.dialogue.lines.map((l: any) => l.text)); }
      if (s.phase === 'question') {
        const id = currentItem(s);
        // Everyone right: the lone Alzák player must hit like the two Babiš players together.
        for (const p of ['anna', 'ben', 'cyril']) session.get(p).dispatch('answer', { answer: correctOf(id), round: s.timerKey });
        await tick();
        if (s.stage === 'battle') {
          const r = board().lastRound;
          expect(Math.abs(r.alzak.dmg - r.babis.dmg)).toBeLessThan(r.babis.dmg * 0.35);
        }
      } else if (s.phase === 'shop') {
        session.get('cyril').dispatch('buy', { item: 'koblizek' });
        await tick();
        for (const p of ['anna', 'ben', 'cyril']) session.get(p).dispatch('shopDone', null);
        await tick();
      } else {
        await tick(5000);
      }
    }
    expect(board().phase).toBe('end');
    expect(board().shopIdx).toBe(2); // the shop before the battle and the one halfway
    expect(board().dealt.cyril).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(8);
    expect(session.results).toHaveLength(1);
    expect(new Set(lines).size).toBe(lines.length);
    expect(session.errors).toEqual([]);
    // Wrong answers and coins: the quiz paid everyone something.
    expect(board().coins.anna).toBeGreaterThan(0);
  });

  it('ignores late taps, wrong rounds and invalid answers', async () => {
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben'], items });
    session.start();
    await tick();
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'alzak' });
    await tick(2600);
    const s = session.get('board').state;
    session.get('anna').dispatch('answer', { answer: 99, round: s.timerKey });
    session.get('ben').dispatch('answer', { answer: correctOf(currentItem(s)), round: s.timerKey - 1 });
    await tick();
    expect(session.get('board').state.answers).toEqual({});
  });

  it('solo: the computer plays the other team and the game ends', async () => {
    const session = new FakeSession<any>(definition(), { mode: 'solo', items, settings: { questionTime: 8, questionCount: 2, battleRounds: 4 } });
    session.start();
    await tick();
    const me = () => session.get('me').state;
    session.get('me').dispatch('chooseTeam', { team: 'alzak' });
    await tick();
    expect(me().ai).toBe('babis');
    let guard = 0;
    while (me().phase !== 'end' && guard++ < 100) {
      const s = me();
      if (s.phase === 'question') {
        session.get('me').dispatch('answer', { answer: s.stage === 'battle' ? wrongOf(currentItem(s)) : correctOf(currentItem(s)), round: s.timerKey });
        await tick();
      } else if (s.phase === 'shop') {
        session.get('me').dispatch('shopDone', null);
        await tick();
      } else await tick(5000);
    }
    expect(me().phase).toBe('end');
    expect(me().winner).toBe('babis'); // all wrong in battle: the computer wins
    expect(session.records.length).toBeGreaterThan(0);
  });
});
