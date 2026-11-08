/**
 * Learning algorithms: how a reported answer (`recordAnswer`) changes the
 * learning progress (OQSEP record) of a player. The host owns this decision
 * (SPEC 5.1); apps can plug in their own (e.g. FSRS).
 *
 * Also when an item is due for review: computed from its level and its last answer with
 * the intervals of the study mode (an exam date shrinks them), so the stored records stay
 * the same whatever mode the person chooses.
 */

import type { OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import type { AnswerRecord } from '@memizy/protocol';

export interface LearningAlgorithm {
  /** OQSEP `meta.algorithm` identifier. */
  id: string;
  /**
   * The new progress record of the answered item. `item` is the item of the set with its
   * answers (type, difficulty, skills… for algorithms like FSRS); it may be ignored.
   * Build it from `previous`: the learner's `starred` and fields of a later OQSEP version
   * MUST stay (OQSEP "On unknown keys"); store `answer.answer` as `lastAnswer.answer`.
   */
  apply(previous: ProgressRecord | undefined, answer: AnswerRecord, now: Date, item: OQSEAnyItem): ProgressRecord;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until the next review per Leitner bucket (index = bucket). */
export const LEITNER_INTERVAL_DAYS = [0, 1, 3, 7, 21] as const;

/** Days until an item answered wrong is due again, whatever its level. */
export const RELEARN_DAYS = 1;

/**
 * Leitner boxes: a correct answer moves the item one bucket up (max 4; a new item goes
 * straight to 2), a wrong answer one bucket down (at least 1) and makes it due again
 * after `RELEARN_DAYS`. Every item type alike – a read note is a correct answer.
 * Skipped answers do not change the bucket.
 */
export const leitner: LearningAlgorithm = {
  id: 'leitner',
  apply(previous, answer, now) {
    const stats = previous?.stats ?? { attempts: 0, incorrect: 0, streak: 0 };
    const lastAnswer = {
      isCorrect: answer.isSkipped ? false : answer.isCorrect,
      answeredAt: now.toISOString(),
      ...(answer.confidence !== undefined && { confidence: answer.confidence }),
      ...(answer.timeSpentMs !== undefined && { timeSpent: answer.timeSpentMs }),
      ...(answer.hintsUsed !== undefined && { hintsUsed: answer.hintsUsed }),
      ...(answer.isSkipped && { isSkipped: true }),
      ...(answer.answer !== undefined && { answer: answer.answer }),
    };
    if (answer.isSkipped) {
      return { ...(previous ?? { bucket: 0 }), stats, lastAnswer } as ProgressRecord;
    }
    const was = previous?.bucket ?? 0;
    const bucket = (answer.isCorrect ? Math.min(4, Math.max(1, was) + 1) : Math.max(1, was - 1)) as ProgressRecord['bucket'];
    const days = answer.isCorrect ? LEITNER_INTERVAL_DAYS[bucket] : RELEARN_DAYS;
    return {
      ...previous,
      bucket,
      nextReviewAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
      stats: {
        ...stats, // fields of a later OQSEP version stay
        attempts: stats.attempts + 1,
        incorrect: stats.incorrect + (answer.isCorrect ? 0 : 1),
        streak: answer.isCorrect ? stats.streak + 1 : 0,
      },
      lastAnswer,
    };
  },
};

// ============================================================================
// Study modes and due items
// ============================================================================

/**
 * How a person studies a set, a folder or a course (their own setting, not in OQSE):
 * - `fast` – learn it fast (cramming before an exam): questions by their level;
 * - `long` – remember it long-term: only items that are due, new ones at a pace;
 *   `examDate` (an ISO date) shrinks the review intervals to the days left.
 */
export interface StudyMode {
  mode: 'fast' | 'long';
  /** The exam day (`YYYY-MM-DD` or an ISO time), only with `long`. */
  examDate?: string;
}

/** Fractions of the days left before an exam that the intervals may take, per bucket. */
const EXAM_FRACTIONS = [0, 0.1, 0.2, 0.4, 0.6] as const;

/** The exam as the start of its day (local time), or `null` without one or when it is over. */
export function examStart(mode: StudyMode | undefined, now: Date): Date | null {
  if (mode?.mode !== 'long' || !mode.examDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(mode.examDate);
  if (!m) return null;
  const exam = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return exam.getTime() > now.getTime() ? exam : null;
}

/** Whole days until the exam (1 = the exam is tomorrow), `null` without one. */
export function daysUntilExam(mode: StudyMode | undefined, now: Date): number | null {
  const exam = examStart(mode, now);
  return exam ? Math.max(1, Math.ceil((exam.getTime() - now.getTime()) / DAY_MS)) : null;
}

/**
 * Review intervals in days per bucket: the Leitner ones, shrunk to fit the days before an
 * exam (5 days left: 0, ½, 1, 2, 3).
 */
export function reviewIntervals(mode: StudyMode | undefined, now: Date): number[] {
  const daysLeft = daysUntilExam(mode, now);
  if (daysLeft === null) return [...LEITNER_INTERVAL_DAYS];
  return LEITNER_INTERVAL_DAYS.map((days, bucket) => Math.min(days, Math.round(daysLeft * EXAM_FRACTIONS[bucket] * 2) / 2));
}

/**
 * When an item is due: never answered – now (`null`); answered wrong – `RELEARN_DAYS` after
 * that answer; otherwise the interval of its bucket after its last answer. Before an exam
 * nothing is due later than the day before it, and on that day everything answered before
 * it is due. Records without a last answer use their `nextReviewAt`.
 */
export function dueAt(record: ProgressRecord | undefined, mode: StudyMode | undefined, now: Date): Date | null {
  if (!record || isNew(record)) return null;
  const answered = record.lastAnswer && !record.lastAnswer.isSkipped ? Date.parse(record.lastAnswer.answeredAt) : NaN;
  let due: number;
  if (Number.isFinite(answered)) {
    const intervals = reviewIntervals(mode, now);
    const days = record.lastAnswer!.isCorrect === false ? Math.min(RELEARN_DAYS, intervals[1]) : intervals[record.bucket ?? 0] ?? 0;
    due = answered + days * DAY_MS;
  } else if (record.nextReviewAt && Number.isFinite(Date.parse(record.nextReviewAt))) {
    due = Date.parse(record.nextReviewAt);
  } else {
    return null;
  }
  const exam = examStart(mode, now);
  if (exam) {
    const lastDay = exam.getTime() - DAY_MS;
    if (due > lastDay) due = Number.isFinite(answered) && answered >= lastDay ? Math.max(due, exam.getTime()) : lastDay;
  }
  return new Date(due);
}

/** Whether an item is due now (new items are due). */
export function isDue(record: ProgressRecord | undefined, mode: StudyMode | undefined, now: Date): boolean {
  const due = dueAt(record, mode, now);
  return due === null || due.getTime() <= now.getTime();
}

/** Whether an item was never answered (bucket 0 without an answer). */
export function isNew(record: ProgressRecord | undefined): boolean {
  return !record || ((record.bucket ?? 0) === 0 && !record.lastAnswer);
}

/**
 * New items a day may bring: spread over the days before the exam, otherwise `perDay`
 * (default 20) – in the long-term mode the rest wait for the next days.
 */
export function newPerDay(unseen: number, mode: StudyMode | undefined, now: Date, perDay = 20): number {
  const days = daysUntilExam(mode, now);
  return days === null ? perDay : Math.max(1, Math.ceil(unseen / days));
}
