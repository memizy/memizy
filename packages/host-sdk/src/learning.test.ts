import { describe, expect, it } from 'vitest';
import type { OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import { daysUntilExam, dueAt, isDue, isNew, leitner, newPerDay, reviewIntervals } from './learning';

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

  it('new items per day: spread over the days left, 20 without an exam', () => {
    expect(newPerDay(100, { mode: 'long', examDate: '2026-11-25' }, now)).toBe(20);
    expect(newPerDay(12, { mode: 'long', examDate: '2026-11-25' }, now)).toBe(3);
    expect(newPerDay(500, { mode: 'long' }, now)).toBe(20);
  });
});
