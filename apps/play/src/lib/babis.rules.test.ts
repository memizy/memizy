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
    : { id: `m${i}`, type: 'mcq-single', question: `M${i}?`, options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id })), correctId: 'abcd'[i % 4] }) as OQSEAnyItem,
);
const correctOf = (id: string) => {
  const item = items.find((i) => i.id === id)! as any;
  return item.type === 'true-false' ? item.correctAnswer : item.correctId;
};
const wrongOf = (id: string) => {
  const c = correctOf(id);
  return typeof c === 'boolean' ? !c : c === 'a' ? 'b' : 'a';
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

function currentItem(state: any): string {
  return state.stage === 'quiz' ? state.quizIds[state.quizRound] : state.battleIds[state.battleRound % state.battleIds.length];
}

/** What ui.question sends: the item id and the answer, from the screen of phase `seen` (default: the current one). */
function answer(session: FakeSession<any>, player: string, value: unknown, seen?: number, itemId?: string) {
  const s = session.get('board')?.state ?? session.get(player).state;
  session.get(player).dispatch('answer', { itemId: itemId ?? currentItem(s), answer: value }, seen ?? s.phaseSeq);
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
        for (const p of ['anna', 'ben', 'cyril']) answer(session, p, correctOf(id));
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

  it('nobody sees the answers of others before the reveal (playerView)', async () => {
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben'], items });
    session.start();
    await tick();
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'alzak' });
    await tick(2600);
    const s = session.get('board').state;
    expect(s.phase).toBe('question');
    answer(session, 'anna', correctOf(currentItem(s)));
    await tick();
    expect(session.get('ben').state.answers.anna).toEqual({ answered: true });
    expect(session.get('anna').state.answers.anna.answer).toBe(correctOf(currentItem(s)));
  });

  it('players get the answer at the reveal, and lose it when the question comes again', async () => {
    const two = items.slice(0, 2); // battle questions repeat the campaign ones
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben'], items: two, settings: { questionCount: 2, battleRounds: 4 } });
    session.start();
    await tick();
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'alzak' });
    await tick(2600);
    const board = () => session.get('board').state;
    const first = currentItem(board());
    const answerOf = (address: string) => {
      const item = session.get(address).item(first) as any;
      return item.type === 'true-false' ? item.correctAnswer : item.correctId;
    };
    expect(answerOf('ben')).toBeUndefined(); // a public item during the question
    for (const p of ['anna', 'ben']) answer(session, p, correctOf(first));
    await tick();
    expect(board().phase).toBe('reveal');
    expect(answerOf('ben')).toBe(correctOf(first));

    let guard = 0;
    while (!(board().phase === 'question' && currentItem(board()) === first) && guard++ < 50) {
      const s = board();
      if (s.phase === 'question') {
        for (const p of ['anna', 'ben']) answer(session, p, correctOf(currentItem(s)));
        await tick();
      } else if (s.phase === 'shop') {
        for (const p of ['anna', 'ben']) session.get(p).dispatch('shopDone', null);
        await tick();
      } else await tick(5000);
    }
    expect(board().stage).toBe('battle');
    expect(answerOf('ben')).toBeUndefined(); // hidden again for the repeat
    expect(session.errors).toEqual([]);
  });

  it('points for speed count the tap, not the arrival (fair on a slow network)', async () => {
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben'], items, settings: { questionTime: 10 } });
    session.start();
    await tick();
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'alzak' });
    await tick(2600);
    await tick(3000); // 3 s into the question (the speed is below the maximum)
    const board = session.get('board');
    const s = board.state;
    const id = currentItem(s);
    // Both answers arrive now; Ben tapped 300 ms earlier (his network is slow).
    const send = (from: string, at: number) => board.receive({ from, data: { t: 'act', n: 'answer', p: { itemId: id, answer: correctOf(id) }, i: 1, ph: s.phaseSeq, at }, sentAt: Date.now() });
    send('anna', board.now());
    send('ben', board.now() - 300);
    await tick(); // everyone answered: the reveal
    const results = board.state.reveal.results;
    expect(results.ben.earned).toBeGreaterThan(results.anna.earned);
  });

  it('ignores late taps (SDK), answers to another question and invalid answers', async () => {
    const session = new FakeSession<any>(definition(), { players: ['anna', 'ben'], items });
    session.start();
    await tick();
    session.get('anna').dispatch('chooseTeam', { team: 'babis' });
    session.get('ben').dispatch('chooseTeam', { team: 'alzak' });
    await tick(2600);
    const s = session.get('board').state;
    answer(session, 'anna', 99); // not an option
    answer(session, 'ben', correctOf(currentItem(s)), s.phaseSeq - 1); // from the previous question's screen
    answer(session, 'ben', correctOf(currentItem(s)), s.phaseSeq, 'm999'); // another question's id
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
        answer(session, 'me', s.stage === 'battle' ? wrongOf(currentItem(s)) : correctOf(currentItem(s)));
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

  it('solo enemySkill: hard mode gives AI boost and higher shop shields', async () => {
    const session = new FakeSession<any>(definition(), { mode: 'solo', items, settings: { questionTime: 8, questionCount: 2, battleRounds: 2, enemySkill: 'hard' } });
    session.start();
    await tick();
    const me = () => session.get('me').state;
    session.get('me').dispatch('chooseTeam', { team: 'babis' });
    await tick();
    expect(me().ai).toBe('alzak');
    // Answer question 1
    answer(session, 'me', correctOf(currentItem(me())));
    await tick();
    await tick(5000); // reveal 1 -> question 2
    // Answer question 2
    answer(session, 'me', correctOf(currentItem(me())));
    await tick();
    await tick(5000); // reveal 2 -> shop
    expect(me().phase).toBe('shop');
    expect(me().shield.alzak).toBe(50); // hard AI shield
    expect(me().boost.alzak).toBe(true); // hard AI boost
    expect(me().dialogue.lines.length).toBe(2); // both characters speak in shop
  });
});
