/**
 * State sync between SDK instances: the authority sends the patches of its actions
 * (mutative, batched across actions) and followers apply them. These tests guard the
 * patch format of the mutative version in use: a follower must end with exactly the
 * authority's state, also after JSON transport (the relay) and for tricky mutations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, apply, type Patches } from 'mutative';
import { FakeSession } from '../test/fakeHost';
import type { GameDefinition } from '../types';

interface Tricky {
  list: { id: string; tags: string[]; nested: { n: number }[] }[];
  map: Record<string, { name: string; items: number[] }>;
  grid: number[][];
  log: string[];
  extra?: { deep: { value: number | null } };
}

const initial = (): Tricky => ({
  list: [
    { id: 'a', tags: ['x', 'y'], nested: [{ n: 1 }, { n: 2 }] },
    { id: 'b', tags: [], nested: [] },
    { id: 'c', tags: ['z'], nested: [{ n: 3 }] },
  ],
  map: { one: { name: 'One', items: [1, 2, 3] }, two: { name: 'Two', items: [] } },
  grid: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  log: [],
});

/** Mutations that stress the patch format: moves between keys, splices, reorders, deletes. */
const recipes: Record<string, (s: Tricky) => void> = {
  moveObjectBetweenKeys(s) {
    s.map.three = s.map.one; // the same draft under a new key…
    delete s.map.one; // …and removed from the old one
    s.map.three.items.push(4);
  },
  moveObjectInsideArray(s) {
    const [first] = s.list.splice(0, 1);
    first.tags.push('moved');
    s.list.push(first);
  },
  spliceInTheMiddle(s) {
    s.list.splice(1, 1, { id: 'd', tags: ['new'], nested: [{ n: 9 }] }, { id: 'e', tags: [], nested: [] });
  },
  reverseAndSort(s) {
    s.list.reverse();
    s.list[0].nested.sort((p, q) => q.n - p.n);
    s.grid.reverse();
  },
  nestedArrays(s) {
    s.grid[0].push(7);
    s.grid[1].splice(0, 2);
    s.grid.push([8]);
    s.grid.unshift([0, 0]);
  },
  shrinkArrays(s) {
    s.list.length = 1;
    s.grid[0].pop();
    s.log = [];
  },
  editAMovedNestedObject(s) {
    const moved = s.list[s.list.length - 1].nested;
    s.list[0].nested = moved;
    moved.push({ n: 42 });
    s.list[s.list.length - 1].nested = [];
  },
  addAndRemoveOptional(s) {
    s.extra = { deep: { value: 1 } };
    s.extra.deep.value = null;
  },
  deleteOptional(s) {
    delete s.extra;
    s.log.push('deleted');
  },
  replaceWholeBranches(s) {
    s.map = { fresh: { name: 'Fresh', items: [5] } };
    s.list = [...s.list].reverse();
  },
};

describe('mutative patches (the format followers apply)', () => {
  it('applied after JSON transport, they rebuild the authority state for every mutation', () => {
    for (const [name, recipe] of Object.entries(recipes)) {
      const before = initial();
      const [after, patches] = create(before, recipe, { enablePatches: true });
      const sent = JSON.parse(JSON.stringify(patches)) as Patches;
      const follower = apply(JSON.parse(JSON.stringify(before)), sent);
      expect(follower, name).toEqual(after);
    }
  });

  it('batched patches of several actions in a row apply in order', () => {
    // The runtime collects the patches of all actions since the last message and sends them together.
    let authority = initial();
    const batch: Patches = [];
    for (const recipe of Object.values(recipes)) {
      const [next, patches] = create(authority, recipe, { enablePatches: true });
      authority = next;
      batch.push(...patches);
    }
    const follower = apply(initial(), JSON.parse(JSON.stringify(batch)) as Patches);
    expect(follower).toEqual(authority);
  });
});

describe('state sync through the SDK runtime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const game: GameDefinition<Tricky> = {
    initialState: () => initial(),
    actions: Object.fromEntries(Object.entries(recipes).map(([name, recipe]) => [name, (state: Tricky) => recipe(state)])),
    render: () => '',
  };

  it('followers end with the authority state, by patches only (no full-state recovery)', async () => {
    const session = new FakeSession(game);
    session.start();
    await vi.advanceTimersByTimeAsync(100);
    session.sent.length = 0;

    // One by one (a message per action) and then all at once (one batch).
    for (const name of Object.keys(recipes).slice(0, 3)) {
      session.get('anna').dispatch(name, null);
      await vi.advanceTimersByTimeAsync(100);
      expect(session.get('ben').state, name).toEqual(session.get('board').state);
    }
    for (const name of Object.keys(recipes).slice(3)) session.get('board').dispatch(name, null);
    await vi.advanceTimersByTimeAsync(200);

    const board = session.get('board').state;
    expect(board?.map).toEqual({ fresh: { name: 'Fresh', items: [5] } });
    for (const address of ['anna', 'ben']) expect(session.get(address).state, address).toEqual(board);
    expect(session.sent.some((m) => m.from === 'board' && m.data?.t === 'patch')).toBe(true);
    expect(session.sent.filter((m) => m.data?.t === 'sync')).toEqual([]);
  });
});
