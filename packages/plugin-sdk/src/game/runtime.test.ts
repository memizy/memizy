import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeSession } from '../test/fakeHost';
import type { GameDefinition } from '../types';

interface QuizState {
  phase: 'question' | 'reveal' | 'end';
  round: number;
  questions: string[];
  answers: Record<string, number>;
  scores: Record<string, number>;
  joined: string[];
  deadline: number;
}

const quiz: GameDefinition<QuizState> = {
  initialState(ctx) {
    const state: QuizState = {
      phase: 'question',
      round: 0,
      questions: ctx.items.map((i) => i.id),
      answers: {},
      scores: {},
      joined: [],
      deadline: ctx.now + 10_000,
    };
    ctx.after(10_000, 'timeUp', { round: 0 }, { key: 'q' });
    return state;
  },
  actions: {
    answer(state, payload, ctx) {
      if (state.phase !== 'question' || !ctx.playerId || ctx.playerId in state.answers) return;
      if (typeof payload?.answer !== 'number') return;
      state.answers[ctx.playerId] = payload.answer;
      const correct = payload.answer === 1;
      if (correct) state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 100;
      ctx.recordAnswer(state.questions[state.round], correct);
    },
    timeUp(state, payload, ctx) {
      if (state.phase !== 'question' || payload.round !== state.round) return;
      state.phase = 'reveal';
      ctx.after(2000, 'next', { round: state.round });
    },
    next(state, payload, ctx) {
      if (state.phase !== 'reveal' || payload.round !== state.round) return;
      if (state.round + 1 >= state.questions.length) {
        state.phase = 'end';
        ctx.end({ scores: state.scores });
        return;
      }
      state.round += 1;
      state.phase = 'question';
      state.answers = {};
      ctx.after(10_000, 'timeUp', { round: state.round }, { key: 'q' });
    },
    replace(_state, payload) {
      return { ...(payload as QuizState) };
    },
    broken() {
      throw new Error('boom');
    },
    putDate(state) {
      (state as any).when = new Date();
    },
    shuffle(state, _payload, ctx) {
      state.questions = ctx.shuffle(state.questions);
    },
    skip(state, _payload, ctx) {
      if (!ctx.fromHost) return; // teacher-only control
      state.round += 1;
    },
    scheduleSkip(_state, _payload, ctx) {
      ctx.after(100, 'skip');
    },
  },
  playerJoined(state, player) {
    state.joined.push(player.id);
  },
  render: () => '',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

describe('multiplayer with a presenter board', () => {
  it('synchronizes state, runs actions on the authority and records answers', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();

    for (const address of ['board', 'anna', 'ben']) {
      expect(session.get(address).state?.phase).toBe('question');
    }

    session.get('anna').dispatch('answer', { answer: 1 });
    session.get('ben').dispatch('answer', { answer: 0 });
    session.get('ben').dispatch('answer', { answer: 1 }); // duplicate – ignored
    await tick();

    expect(session.get('board').state?.scores).toEqual({ anna: 100 });
    expect(session.get('ben').state?.answers).toEqual({ anna: 1, ben: 0 });
    expect(session.records).toEqual([
      { playerId: 'anna', itemId: 'q1', isCorrect: true },
      { playerId: 'ben', itemId: 'q1', isCorrect: false },
    ]);
  });

  it('batches state updates into few messages', async () => {
    const players = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const session = new FakeSession(quiz, { players });
    session.start();
    await tick();
    session.sent.length = 0;
    for (const id of players) session.get(id).dispatch('answer', { answer: 1 });
    await tick(200);
    const fromBoard = session.sent.filter((m) => m.from === 'board');
    expect(fromBoard.length).toBeLessThanOrEqual(3);
    expect(Object.keys(session.get('p39').state!.scores)).toHaveLength(40);
  });

  it('runs timers and ends the game', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick(10_100); // timeUp (+ the batching delay before the update reaches players)
    expect(session.get('anna').state?.phase).toBe('reveal');
    await tick(2000); // next
    expect(session.get('anna').state?.round).toBe(1);
    await tick(12_000);
    await tick(12_000);
    expect(session.get('board').state?.phase).toBe('end');
    expect(session.results).toHaveLength(1);
    session.get('anna').dispatch('answer', { answer: 1 });
    await tick();
    expect(session.records).toHaveLength(0); // no actions after the end
  });

  it('calls playerJoined and lets a late joiner synchronize', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.setPlayers([...session.players, { id: 'cyril', name: 'Cyril', isHost: false, connected: true }]);
    const cyril = session.open('cyril', true);
    await tick();
    expect(session.get('board').state?.joined).toEqual(['cyril']);
    expect(cyril.state?.joined).toEqual(['cyril']);
    expect(cyril.version).toBe(session.get('board').version);
  });

  it('resumes the authority from its snapshot, including timers', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.get('anna').dispatch('answer', { answer: 1 });
    await tick(1000); // snapshot saved
    expect(session.snapshot).not.toBeNull();

    session.open('board'); // the teacher reloads the board
    await tick();
    expect(session.get('board').state?.scores).toEqual({ anna: 100 });
    await tick(9000); // the original 10 s timer still fires
    expect(session.get('ben').state?.phase).toBe('reveal');
  });

  it('a follower that misses an update asks for the full state', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.disconnected.add('ben');
    session.get('anna').dispatch('answer', { answer: 1 });
    await tick();
    session.disconnected.delete('ben');
    session.get('anna').dispatch('answer', { answer: 2 }); // duplicate, no change
    session.get('board').dispatch('shuffle', null);
    await tick();
    expect(session.get('ben').state).toEqual(session.get('board').state);
  });

  it('ignores state sent by another player (only the authority is trusted)', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    const before = structuredClone(session.get('anna').state);
    const fake = { ...before!, scores: { ben: 9999 } };
    session.get('anna').receive({ from: 'ben', data: { t: 'state', v: 999, s: fake }, sentAt: Date.now() });
    session.get('anna').receive({ from: 'ben', data: { t: 'patch', b: session.get('anna').version, v: 1000, p: [{ op: 'replace', path: ['scores'], value: { ben: 9999 } }] }, sentAt: Date.now() });
    expect(session.get('anna').state).toEqual(before);
    session.get('anna').dispatch('answer', { answer: 1 });
    await tick();
    expect(session.get('anna').state!.scores).toEqual({ anna: 100 });
  });

  it('does not send actions while the authority is unavailable', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.disconnected.add('board');
    session.get('anna').setAuthorityConnected(false);
    session.get('anna').dispatch('answer', { answer: 1 });
    await tick();
    expect(session.sent.filter((m) => m.from === 'anna' && (m.data as any).t === 'act')).toHaveLength(0);
  });
});

describe('host plays along (hostAs: player)', () => {
  it('the host controller is the authority and its own actions have its player id', async () => {
    const session = new FakeSession(quiz, { hostAs: 'player' });
    expect(session.authority).toBe('anna');
    session.start();
    await tick();
    session.get('anna').dispatch('answer', { answer: 1 });
    session.get('ben').dispatch('answer', { answer: 1 });
    await tick();
    expect(session.get('ben').state?.scores).toEqual({ anna: 100, ben: 100 });
  });
});

describe('solo', () => {
  it('runs locally without messages and records answers for the player', async () => {
    const session = new FakeSession(quiz, { mode: 'solo' });
    session.start();
    session.get('me').dispatch('answer', { answer: 1 });
    await tick(1000);
    expect(session.get('me').state?.scores).toEqual({ me: 100 });
    expect(session.sent).toHaveLength(0);
    expect(session.records[0].playerId).toBe('me');
    expect(session.snapshot).not.toBeNull();
  });
});

describe('plugin mistakes', () => {
  it('reports throwing actions, unknown actions and non-JSON state, and keeps the state', async () => {
    const session = new FakeSession(quiz, { mode: 'solo' });
    session.start();
    const before = session.get('me').state;
    session.get('me').dispatch('broken', null);
    session.get('me').dispatch('missing', null);
    session.get('me').dispatch('putDate', null);
    expect(session.get('me').state).toBe(before);
    expect(session.errors).toEqual([
      'ACTION_FAILED: broken threw: boom',
      'UNKNOWN_ACTION: Action "missing" is not defined in actions.',
      expect.stringMatching(/^INVALID_STATE: putDate put a non-JSON value into the state: state\.when is not a plain object/),
    ]);
  });

  it('accepts an action that returns a new state instead of mutating', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    const replaced = { ...session.get('board').state!, round: 2 };
    session.get('board').dispatch('replace', replaced);
    await tick();
    expect(session.get('anna').state?.round).toBe(2);
  });
});

describe('determinism', () => {
  it('random and shuffle depend only on the session and continue after resume', async () => {
    const a = new FakeSession(quiz, { mode: 'solo', items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, type: 'note', content: 'x' })) as any });
    const b = new FakeSession(quiz, { mode: 'solo', items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, type: 'note', content: 'x' })) as any });
    a.start();
    b.start();
    a.get('me').dispatch('shuffle', null);
    b.get('me').dispatch('shuffle', null);
    expect(a.get('me').state?.questions).toEqual(b.get('me').state?.questions);
    expect(a.get('me').state?.questions).not.toEqual(Array.from({ length: 10 }, (_, i) => `i${i}`));
  });
});

describe('host-only actions (ctx.fromHost)', () => {
  it('presenter: the board may skip, players may not; timers may', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.get('anna').dispatch('skip', null);
    await tick();
    expect(session.get('board').state?.round).toBe(0);
    session.get('board').dispatch('skip', null);
    await tick();
    expect(session.get('anna').state?.round).toBe(1);
    session.get('board').dispatch('scheduleSkip', null);
    await tick(200);
    expect(session.get('anna').state?.round).toBe(2);
  });

  it('host plays along: the host player may skip, others may not', async () => {
    const session = new FakeSession(quiz, { hostAs: 'player' });
    session.start();
    await tick();
    session.get('ben').dispatch('skip', null);
    await tick();
    expect(session.get('anna').state?.round).toBe(0);
    session.get('anna').dispatch('skip', null);
    await tick();
    expect(session.get('ben').state?.round).toBe(1);
  });
});

describe('hidden answers (ctx.reveal)', () => {
  it('followers get items without answers until the authority reveals them', async () => {
    const def: GameDefinition<{ n: number }> = {
      initialState: () => ({ n: 0 }),
      actions: {
        all(state, _p, ctx) { state.n += 1; ctx.reveal('q1'); },
        mine(state, _p, ctx) { state.n += 1; ctx.reveal(['q2'], { to: ctx.playerId! }); },
      },
      render: () => '',
    };
    const session = new FakeSession(def);
    session.start();
    await tick();
    expect(session.get('board').item('q1')).toHaveProperty('correctId', 'b');
    expect(session.get('anna').item('q1')).toMatchObject({ answerHidden: true });
    expect(session.get('anna').item('q1')).not.toHaveProperty('correctId');
    session.get('anna').dispatch('mine', null);
    await tick();
    expect(session.get('anna').item('q2')).toHaveProperty('correctAnswer', true);
    expect(session.get('ben').item('q2')).not.toHaveProperty('correctAnswer');
    session.get('ben').dispatch('all', null);
    await tick();
    expect(session.get('anna').item('q1')).toHaveProperty('correctId', 'b');
    expect(session.get('ben').item('q1')).toHaveProperty('correctId', 'b');
    // A reloaded device and a resumed authority send the reveals again.
    session.open('ben');
    await tick();
    expect(session.get('ben').item('q1')).toHaveProperty('correctId', 'b');
    expect(session.get('ben').item('q2')).not.toHaveProperty('correctAnswer');
    await tick(600); // snapshot
    session.open('board');
    session.open('anna');
    await tick();
    expect(session.get('anna').item('q2')).toHaveProperty('correctAnswer', true);
  });
});

describe('pending actions (ui.pending)', () => {
  it('marks an action as pending until the authority has processed it', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    const anna = session.get('anna');
    anna.dispatch('answer', { answer: 1 });
    expect(anna.waitingActions.map((a) => a.name)).toEqual(['answer']);
    await tick(50);
    expect(anna.waitingActions).toEqual([]);
    // An action the rules ignore (already answered) is confirmed too.
    anna.dispatch('answer', { answer: 0 });
    expect(anna.waitingActions).toHaveLength(1);
    await tick(50);
    expect(anna.waitingActions).toEqual([]);
    expect(session.get('board').waitingActions).toEqual([]);
  });

  it('forgets an action the authority never confirms', async () => {
    const session = new FakeSession(quiz);
    session.start();
    await tick();
    session.disconnected.add('board'); // the message is lost
    const anna = session.get('anna');
    anna.dispatch('answer', { answer: 1 });
    expect(anna.waitingActions).toHaveLength(1);
    await tick(5100);
    expect(anna.waitingActions).toEqual([]);
  });
});
