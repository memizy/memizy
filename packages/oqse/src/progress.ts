/**
 * OQSEP v0.1 Type Definitions
 * (Open Quiz & Study Exchange - Progress)
 *
 * @see ../oqse-progress.md#data-model
 */

/** Aggregate performance statistics for a single item. */
export interface StatsObject {
	attempts: number;
	incorrect: number;
	streak: number;
}

/** Last answer details for a single item interaction. */
export interface LastAnswerObject {
	isCorrect: boolean;
	confidence?: 1 | 2 | 3 | 4;
	answeredAt: string;
	timeSpent?: number;
	hintsUsed: number;
	isSkipped?: boolean;
}

/** Progress state for one item from the linked OQSE set. */
export interface ProgressRecord {
	bucket: 0 | 1 | 2 | 3 | 4;
	nextReviewAt?: string;
	stats: StatsObject;
	lastAnswer?: LastAnswerObject;
	appSpecific?: Record<string, unknown>;
}

/** OQSEP metadata describing origin and export context. */
export interface ProgressMeta {
	setId: string;
	exportedAt: string;
	algorithm?: string;
}

/** Root OQSEP payload for one user and one study set. */
export interface OQSEProgress {
	$schema?: string;
	version: string;
	meta: ProgressMeta;
	records: Record<string, ProgressRecord>;
}
