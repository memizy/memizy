import { describe, it, expect } from 'vitest';
import { FakeSession } from '../test/fakeHost';
import { SeededRandom } from './random';
import type { GameDefinition } from '../types';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A game that shuffles a deck in initialState (the classic secret of a card game). */
const deck: GameDefinition<{ deck: number[] }> = {
  initialState: (ctx) => ({ deck: ctx.shuffle(Array.from({ length: 20 }, (_, i) => i)) }),
  actions: {},
  render: () => '',
};

async function deckOf(options: { rulesSeed?: string } = {}) {
  const session = new FakeSession(deck, options);
  session.start();
  await tick();
  return session.get('board').state!.deck;
}

describe('random numbers of the game rules', () => {
  it('come from the secret seed of the authority, not from the session id that every device knows', async () => {
    const a = await deckOf({ rulesSeed: '0123456789abcdef0123456789abcdef' });
    const b = await deckOf({ rulesSeed: 'fedcba9876543210fedcba9876543210' });
    expect(a).not.toEqual(b); // same session id, different seeds
    expect(await deckOf({ rulesSeed: '0123456789abcdef0123456789abcdef' })).toEqual(a); // deterministic (replay)
    expect(await deckOf()).toEqual(await deckOf()); // an older host without a seed: the session id
  });

  it('a resumed game continues the sequence; a snapshot of the release candidates still loads', () => {
    const rng = new SeededRandom('seed');
    rng.next();
    const saved = [...rng.state];
    const expected = [rng.next(), rng.next()];
    const resumed = new SeededRandom('other');
    resumed.restore(saved);
    expect([resumed.next(), resumed.next()]).toEqual(expected);
    const legacy = new SeededRandom('x');
    legacy.restore(123456789); // the 32-bit state of RC snapshots
    expect(legacy.next()).toBeGreaterThanOrEqual(0);
    expect(legacy.state).toHaveLength(4);
  });

  it('spreads values evenly', () => {
    const rng = new SeededRandom('uniform');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(rng.next() * 10)]++;
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });
});
