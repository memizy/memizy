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

// ============================================================================
// Choosing the next items of a player (`pickItems`, SPEC 5.4)
// ============================================================================

/** Default weights of the levels 0–4 (memizy-learn's, proven with students). */
export const PICK_WEIGHTS = [1, 1, 0.7, 0.4, 0.1] as const;

/** One answer of the player in this game, oldest first (what the host saw through `recordAnswer`). */
export interface PickHistoryEntry {
  itemId: string;
  correct: boolean;
  /** The item had never been answered before this answer. */
  wasNew: boolean;
}

export interface PickOptions {
  count: number;
  now: Date;
  /** A number in [0, 1) (the host's own random; the game gets the result as an action). */
  random: () => number;
  weights?: readonly number[];
  mode?: StudyMode;
  /** Only these item types. */
  types?: string[];
  /** Not now (e.g. already in the game's queue). */
  exclude?: string[];
  /** This game's answers of the player, oldest first. */
  history?: PickHistoryEntry[];
}

/** Other answers before a wrong one comes back, and how often it may come back in a game. */
const AGAIN_AFTER = 3;
const AGAIN_MAX = 2;
/** The last answered items are not picked again (if anything else is left). */
const RECENT = 3;

/**
 * The next items of a player (DECISIONS.md 2026-11-08): a wrong answer comes back after
 * about three other answers (at most twice in a game); then by the levels' weights (due
 * items count double, the last few answered not again, a new item at most every third
 * question while others wait). In the long-term mode only due items and new ones at the
 * day's pace; when none are left, the weakest. Every item type alike.
 */
export function pickItems(items: readonly OQSEAnyItem[], progress: Record<string, ProgressRecord>, options: PickOptions): string[] {
  const weights = options.weights?.length === 5 ? options.weights : PICK_WEIGHTS;
  const history = options.history ?? [];
  const excluded = new Set(options.exclude ?? []);
  const pool = items.filter((item) => !excluded.has(item.id) && (!options.types?.length || options.types.includes(item.type)));
  const picked: string[] = [];
  const take = (id: string) => {
    if (!picked.includes(id)) picked.push(id);
  };

  // 1. Wrong answers come back soon.
  const wrongTimes = new Map<string, number>();
  history.forEach((entry, i) => {
    if (entry.correct) return;
    wrongTimes.set(entry.itemId, (wrongTimes.get(entry.itemId) ?? 0) + 1);
    const since = history.length - 1 - i;
    const later = history.slice(i + 1).some((e) => e.itemId === entry.itemId);
    if (!later && since >= AGAIN_AFTER && (wrongTimes.get(entry.itemId) ?? 0) <= AGAIN_MAX && pool.some((item) => item.id === entry.itemId)) take(entry.itemId);
  });

  // 2. The rest by weights (or the long-term mode's due items).
  const recent = new Set(history.slice(-RECENT).map((e) => e.itemId));
  // Questions since the last new item (a new one at most every third question while others wait).
  let sinceNew = history.length;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].wasNew) { sinceNew = history.length - 1 - i; break; }
  let candidates = pool.filter((item) => !picked.includes(item.id));
  if (options.mode?.mode === 'long') {
    let fresh = newPerDay(candidates.filter((item) => isNew(progress[item.id])).length, options.mode, options.now) - history.filter((e) => e.wasNew).length;
    const today = candidates.filter((item) => (isNew(progress[item.id]) ? fresh-- > 0 : isDue(progress[item.id], options.mode, options.now)));
    candidates = today.length ? today : weakestFirst(candidates, progress).slice(0, Math.max(options.count * 3, 10));
  }
  const fresh = candidates.filter((item) => !recent.has(item.id));
  if (fresh.length) candidates = fresh;
  const newAllowed = () => sinceNew >= 2 || !candidates.some((item) => !isNew(progress[item.id]));
  while (picked.length < options.count && candidates.length) {
    const weightOf = (item: OQSEAnyItem) => {
      const record = progress[item.id];
      if (isNew(record)) return newAllowed() ? weights[0] : 0;
      const w = weights[Math.min(4, Math.max(0, record!.bucket ?? 0))] ?? 0;
      return isDue(record, options.mode, options.now) ? w * 2 : w;
    };
    const ws = candidates.map(weightOf);
    const total = ws.reduce((a, b) => a + b, 0);
    let index: number;
    if (total <= 0) index = Math.floor(options.random() * candidates.length);
    else {
      let r = options.random() * total;
      index = ws.findIndex((w) => (r -= w) < 0);
      if (index < 0) index = ws.length - 1;
    }
    const [chosen] = candidates.splice(index, 1);
    sinceNew = isNew(progress[chosen.id]) ? 0 : sinceNew + 1;
    take(chosen.id);
  }
  return picked.slice(0, options.count);
}

/** Lowest level first, then the longest unpractised. */
function weakestFirst(items: OQSEAnyItem[], progress: Record<string, ProgressRecord>): OQSEAnyItem[] {
  const when = (record: ProgressRecord | undefined) => Date.parse(record?.lastAnswer?.answeredAt ?? '') || 0;
  const level = (record: ProgressRecord | undefined) => record?.bucket ?? 0;
  return [...items].sort((a, b) => level(progress[a.id]) - level(progress[b.id]) || when(progress[a.id]) - when(progress[b.id]));
}
