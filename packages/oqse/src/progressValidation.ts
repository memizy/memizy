import { z } from 'zod';
import type {
    LastAnswerObject,
    OQSEProgress,
    ProgressMeta,
    ProgressRecord,
    StatsObject,
} from './progress';
import { ISO8601DateTimeSchema, UUIDSchema } from './oqseValidation';

export const StatsObjectSchema: z.ZodType<StatsObject> = z
    .looseObject({
        attempts: z.number().int().nonnegative(),
        incorrect: z.number().int().nonnegative(),
        streak: z.number().int().nonnegative(),
    })
    .refine((data) => data.incorrect <= data.attempts, {
        message: 'incorrect cannot be higher than attempts',
        path: ['incorrect'],
    });

/** Largest `lastAnswer.answer` (JSON): the protocol's limit for a recorded answer. */
export const MAX_LAST_ANSWER_BYTES = 4096;

export const LastAnswerObjectSchema: z.ZodType<LastAnswerObject> = z
    .looseObject({
        isCorrect: z.boolean(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        answeredAt: ISO8601DateTimeSchema,
        timeSpent: z.number().int().nonnegative().optional(),
        hintsUsed: z.number().int().nonnegative().default(0),
        isSkipped: z.boolean().optional(),
        answer: z
            .unknown()
            .refine((value) => value === undefined || jsonBytes(value) <= MAX_LAST_ANSWER_BYTES, 'answer must be JSON of at most 4 KB')
            .optional(),
    });

export const ProgressRecordSchema: z.ZodType<ProgressRecord> = z.looseObject({
    bucket: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    nextReviewAt: ISO8601DateTimeSchema.optional(),
    stats: StatsObjectSchema,
    lastAnswer: LastAnswerObjectSchema.optional(),
    starred: z.boolean().optional(),
    appSpecific: z.record(z.string(), z.unknown()).optional(),
});

export const ProgressMetaSchema: z.ZodType<ProgressMeta> = z.looseObject({
    setId: UUIDSchema,
    exportedAt: ISO8601DateTimeSchema,
    algorithm: z
        .string()
        .regex(/^[a-z0-9-]+$/, 'algorithm must be lowercase alphanumeric with hyphens format')
        .optional(),
});

export const OQSEProgressSchema: z.ZodType<OQSEProgress> = z.looseObject({
    $schema: z.url().optional(), 
    version: z.string().regex(/^1\.\d+$/, 'Unsupported progress version: this library reads OQSEP 1.x (write "version": "1.0")'),
    meta: ProgressMetaSchema,
    /** Item IDs (UUIDs for items of the set; generated items may have other IDs). */
    records: z.record(z.string().min(1).max(128), ProgressRecordSchema),
});

function jsonBytes(value: unknown): number {
    try {
        return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
    } catch {
        return Infinity; // not JSON (cycles, BigInt)
    }
}

export function validateOQSEProgress(data: unknown): OQSEProgress {
    return OQSEProgressSchema.parse(data);
}

export function safeValidateOQSEProgress(data: unknown): ReturnType<typeof OQSEProgressSchema.safeParse> {
    return OQSEProgressSchema.safeParse(data);
}