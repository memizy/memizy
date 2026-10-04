/**
 * Learning algorithms: how a reported answer (`recordAnswer`) changes the
 * learning progress (OQSEP record) of a player. The host owns this decision
 * (SPEC 5.1); apps can plug in their own (e.g. FSRS).
 */

import type { ProgressRecord } from '@memizy/oqse';
import type { AnswerRecord } from '@memizy/protocol';

export interface LearningAlgorithm {
  /** OQSEP `meta.algorithm` identifier. */
  id: string;
  apply(previous: ProgressRecord | undefined, answer: AnswerRecord, now: Date): ProgressRecord;
}

/** Days until the next review per Leitner bucket (index = bucket). */
export const LEITNER_INTERVAL_DAYS = [0, 1, 3, 7, 21] as const;

/**
 * Leitner boxes: a correct answer moves the item one bucket up (max 4),
 * a wrong answer back to bucket 1. Skipped answers do not change the bucket.
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
    };
    if (answer.isSkipped) {
      return { ...(previous ?? { bucket: 0 }), stats, lastAnswer } as ProgressRecord;
    }
    const bucket = (answer.isCorrect ? Math.min(4, Math.max(1, previous?.bucket ?? 0) + 1) : 1) as ProgressRecord['bucket'];
    const next = new Date(now.getTime() + LEITNER_INTERVAL_DAYS[bucket] * 24 * 60 * 60 * 1000);
    return {
      ...previous,
      bucket,
      nextReviewAt: next.toISOString(),
      stats: {
        attempts: stats.attempts + 1,
        incorrect: stats.incorrect + (answer.isCorrect ? 0 : 1),
        streak: answer.isCorrect ? stats.streak + 1 : 0,
      },
      lastAnswer,
    };
  },
};
