import { describe, expect, it } from 'vitest';
import type { OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import { daysUntilExam, dueAt, isDue, isNew, leitner, newPerDay, pickItems, reviewIntervals, type PickHistoryEntry } from './learning';

const item = { id: 'q', type: 'mcq-single', question: 'Q', options: [{ id: 'a', text: 'A' }], correctId: 'a' } as OQSEAnyItem;
const note = { id: 'n', type: 'note', title: 'T', content: 'C' } as OQSEAnyItem;
const at = (iso: string) => new Date(iso);
const answer = (record: ProgressRecord | undefined, isCorrect: boolean, when: string, it = item) => leitner.apply(record, { itemId: it.id, isCorrect }, at(when), it);

describe('leitner (1.1 rules)', () => {
  it('a wrong answer moves one level down (at least 1) and comes back after a day', () => {
    let r: ProgressRecord | undefined;
    for (const day of ['01', '04', '11', '18']) r = answer(r, true, `2026-11-${day}T10:00:00Z`);
    expect(r!.bucket).toBe(4);
    r = answer(r, false, '2026-11-20T10:00:00Z');
    expect(r).toMatchObject({ bucket: 3, nextReviewAt: '2026-11-21T10:00:00.000Z', stats: { attempts: 5, incorrect: 1, streak: 0 } });
    r = answer(r, false, '2026-11-20T10:01:00Z');
    r = answer(r, false, '2026-11-20T10:02:00Z');
    r = answer(r, false, '2026-11-20T10:03:00Z');
    expect(r!.bucket).toBe(1); // never below 1
    expect(answer(undefined, false, '2026-11-20T10:00:00Z').bucket).toBe(1); // a new item answered wrong
  });

  it('every right answer moves one level up, also minutes apart (learn it fast)', () => {
    let r = answer(undefined, true, '2026-11-20T10:00:00Z');
    expect(r.bucket).toBe(2);
    r = answer(r, true, '2026-11-20T10:05:00Z');
    r = answer(r, true, '2026-11-20T10:10:00Z');
    expect(r.bucket).toBe(4);
  });

  it('a read note counts like a right answer, up to level 4', () => {
    let r: ProgressRecord | undefined;
    for (let i = 0; i < 4; i++) r = answer(r, true, `2026-11-2${i}T10:00:00Z`, note);
    expect(r!.bucket).toBe(4);
  });
});

describe('due items and study modes', () => {
  const now = at('2026-11-20T12:00:00');
  const rec = (bucket: number, answeredAt: string, isCorrect = true) => ({ bucket, stats: { attempts: 1, incorrect: 0, streak: 1 }, lastAnswer: { isCorrect, answeredAt } }) as ProgressRecord;

  it('new items are due; the rest after the interval of their level, a wrong one after a day', () => {
    expect(isNew(undefined)).toBe(true);
    expect(isDue(undefined, undefined, now)).toBe(true);
    expect(isDue(rec(3, '2026-11-14T12:00:00'), undefined, now)).toBe(false); // 6 of 7 days
    expect(isDue(rec(3, '2026-11-13T11:00:00'), undefined, now)).toBe(true);
    expect(isDue(rec(4, '2026-11-19T11:00:00', false), undefined, now)).toBe(true); // wrong yesterday
    expect(isDue(rec(4, '2026-11-20T11:00:00', false), undefined, now)).toBe(false); // wrong an hour ago
    // A record from elsewhere without a last answer uses its nextReviewAt.
    expect(isDue({ bucket: 2, nextReviewAt: '2026-11-21T00:00:00Z' } as ProgressRecord, undefined, now)).toBe(false);
  });

  it('an exam date shrinks the intervals; the day before it everything is due', () => {
    const exam = { mode: 'long' as const, examDate: '2026-11-25' };
    expect(daysUntilExam(exam, now)).toBe(5);
    expect(reviewIntervals(exam, now)).toEqual([0, 0.5, 1, 2, 3]);
    expect(reviewIntervals({ mode: 'long', examDate: '2026-12-31' }, now)).toEqual([0, 1, 3, 7, 21]);
    expect(reviewIntervals({ mode: 'fast', examDate: '2026-11-25' }, now)).toEqual([0, 1, 3, 7, 21]); // only the long-term mode uses it
    // Level 4 answered today: normally in 21 days – before the exam it is due the day before.
    const mastered = rec(4, '2026-11-20T10:00:00');
    expect(dueAt(mastered, undefined, now)!.toISOString()).toBe(at('2026-12-11T10:00:00').toISOString());
    expect(isDue(mastered, exam, now)).toBe(false);
    expect(isDue(mastered, exam, at('2026-11-23T12:00:00'))).toBe(true); // 3 days for level 4
    expect(isDue(rec(4, '2026-11-24T08:00:00'), exam, at('2026-11-24T09:00:00'))).toBe(false); // answered on the last day
    // After the exam the normal intervals return.
    expect(daysUntilExam(exam, at('2026-11-26T12:00:00'))).toBeNull();
  });

  it('new items per day: spread over the days left but the day before the exam (the review day), 20 without an exam', () => {
    const exam = { mode: 'long' as const, examDate: '2026-11-25' }; // 5 days: 4 with new items
    expect(newPerDay(100, exam, now)).toBe(25);
    expect(newPerDay(12, exam, now)).toBe(3);
    expect(newPerDay(500, { mode: 'long' }, now)).toBe(20);
    // 30 items, the exam in 3 days: 15 today, 15 tomorrow, the third day only reviews
    const inThree = { mode: 'long' as const, examDate: '2026-11-23' };
    expect(newPerDay(30, inThree, now)).toBe(15);
    expect(newPerDay(15, inThree, at('2026-11-21T12:00:00'))).toBe(15);
    // the exam tomorrow or the day after: everything now
    expect(newPerDay(30, { mode: 'long', examDate: '2026-11-22' }, now)).toBe(30);
    expect(newPerDay(30, { mode: 'long', examDate: '2026-11-21' }, now)).toBe(30);
  });
});

describe('pickItems: the next items of a player', () => {
  const now = at('2026-11-20T12:00:00Z');
  const mk = (id: string, type = 'flashcard') => ({ id, type, front: id, back: id }) as unknown as OQSEAnyItem;
  const set = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => mk(id));
  const known = (bucket: number, daysAgo = 0.01, ok = true) => ({ bucket, stats: { attempts: 1, incorrect: ok ? 0 : 1, streak: ok ? 1 : 0 }, lastAnswer: { isCorrect: ok, answeredAt: new Date(now.getTime() - daysAgo * 864e5).toISOString() } }) as ProgressRecord;
  /** A fixed sequence of "random" numbers. */
  const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
  const many = (progress: Record<string, ProgressRecord>, history: PickHistoryEntry[] = [], runs = 4000) => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < runs; i++) for (const id of pickItems(set, progress, { count: 1, now, random: Math.random, history })) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  };

  it('by the weights 1 / 1 / 0.7 / 0.4 / 0.1: mastered items come rarely', () => {
    const progress = { a: known(1), b: known(2), c: known(3), d: known(4), e: known(4), f: known(4) };
    const counts = many(progress);
    const share = (id: string) => (counts[id] ?? 0) / 4000;
    expect(share('a')).toBeGreaterThan(0.3); // 1 of 1 + 0.7 + 0.4 + 3 × 0.1 = 2.4 → 42 %
    expect(share('d') + share('e') + share('f')).toBeLessThan(0.18); // 0.3 / 2.4 = 12.5 %
    expect(share('b')).toBeGreaterThan(share('c'));
  });

  it('a pass in order: each item once in the order of the set, wrong ones not back, then by progress', () => {
    const h = (...ids: [string, boolean][]) => ids.map(([itemId, correct]) => ({ itemId, correct, wasNew: false }));
    const order = { order: 'sequence' as const };
    expect(pickItems(set, {}, { count: 2, now, random: Math.random, order })).toEqual(['a', 'b']);
    // a and b answered (b wrong): c and d next, b does not come back in the pass
    expect(pickItems(set, {}, { count: 2, now, random: Math.random, order, history: h(['a', true], ['b', false]) })).toEqual(['c', 'd']);
    // given to the game's queue earlier in the pass (not answered yet): not again
    expect(pickItems(set, {}, { count: 2, now, random: Math.random, order, given: ['a', 'b'] })).toEqual(['c', 'd']);
    // what is in the game's queue already is left out; only some types
    expect(pickItems(set, {}, { count: 2, now, random: Math.random, order, exclude: ['a'] })).toEqual(['b', 'c']);
    // since the pass started (a reload: no history), by the answers in the progress
    const since = new Date(now.getTime() - 3600_000).toISOString();
    const progress = { a: known(2, 0.01), b: known(1, 0.01, false), c: known(3, 5) }; // c answered before the pass
    expect(pickItems(set, progress, { count: 2, now, random: Math.random, order: { order: 'sequence', since } })).toEqual(['c', 'd']);
    // the pass over: by progress, the wrong one (level 1) the likeliest
    const all = h(['a', true], ['b', false], ['c', true], ['d', true], ['e', true], ['f', true]);
    const after = pickItems(set, { a: known(4), b: known(1, 0.01, false), c: known(4), d: known(4), e: known(4), f: known(4) }, { count: 1, now, random: seq(0.01), order, history: all });
    expect(after).toHaveLength(1);
    expect(after).toEqual(['b']);
  });

  it('a wrong answer comes back after three others, at most twice; the last ones not again', () => {
    const progress = { a: known(1, 0.01, false), b: known(2), c: known(2), d: known(2), e: known(2), f: known(2) };
    const h = (...ids: [string, boolean][]) => ids.map(([itemId, correct]) => ({ itemId, correct, wasNew: false }));
    expect(pickItems(set, progress, { count: 1, now, random: seq(0.99), history: h(['a', false], ['b', true], ['c', true]) })).not.toEqual(['a']); // only two since
    expect(pickItems(set, progress, { count: 1, now, random: seq(0.99), history: h(['a', false], ['b', true], ['c', true], ['d', true]) })).toEqual(['a']);
    // Wrong a third time: no more coming back first.
    const third = h(['a', false], ['b', true], ['c', true], ['d', true], ['a', false], ['b', true], ['c', true], ['d', true], ['a', false], ['e', true], ['f', true], ['b', true]);
    const thirdCounts = many(progress, third, 2000);
    expect((thirdCounts.a ?? 0) / 2000).toBeLessThan(0.6); // only by its weight now (≈ 42 %), not always first
    // The last three answered are not picked again while others are left.
    const counts = many(progress, h(['d', true], ['e', true], ['f', true]));
    expect(counts.d ?? 0).toBe(0);
    expect(counts.e ?? 0).toBe(0);
  });

  it('a new item at most every third question while known ones wait', () => {
    const progress = { a: known(2), b: known(2), c: known(2) };
    const justNew = [{ itemId: 'd', correct: true, wasNew: true }];
    const counts = many(progress, justNew, 500);
    expect((counts.e ?? 0) + (counts.f ?? 0)).toBe(0); // e, f are new
    const twoAgo = [{ itemId: 'd', correct: true, wasNew: true }, { itemId: 'a', correct: true, wasNew: false }, { itemId: 'b', correct: true, wasNew: false }];
    expect((many(progress, twoAgo, 2000).e ?? 0)).toBeGreaterThan(0);
    // Only new items left: they come.
    expect(pickItems(set, {}, { count: 3, now, random: Math.random, history: justNew })).toHaveLength(3);
  });

  it('long-term mode: only due and new at the pace; when none is left, the weakest', () => {
    const long = { mode: 'long' as const };
    const progress = { a: known(4, 1), b: known(2, 5), c: known(3, 1), d: known(1, 2), e: known(2, 1), f: known(3, 2) };
    const picked = pickItems(set, progress, { count: 6, now, random: Math.random, mode: long });
    expect(picked.sort()).toEqual(['b', 'd']); // b: 3 days passed, d: 1 day passed
    const none = { a: known(4, 0.1), b: known(2, 0.1), c: known(3, 0.1), d: known(1, 0.1), e: known(2, 0.1), f: known(3, 0.1) };
    expect(pickItems(set, none, { count: 1, now, random: seq(0), mode: long })[0]).toBe('d'); // nothing due: the weakest
  });

  it('types and exclusions; every item type alike (notes too)', () => {
    const mixed = [mk('n', 'note'), mk('q', 'mcq-single'), mk('c')];
    expect(pickItems(mixed, {}, { count: 5, now, random: Math.random, types: ['note', 'flashcard'] }).sort()).toEqual(['c', 'n']);
    expect(pickItems(mixed, {}, { count: 5, now, random: Math.random, exclude: ['q'] }).sort()).toEqual(['c', 'n']);
  });
});
