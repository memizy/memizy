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
    .object({
        attempts: z.number().int().nonnegative(),
        incorrect: z.number().int().nonnegative(),
        streak: z.number().int().nonnegative(),
    })
    .refine((data) => data.incorrect <= data.attempts, {
        message: 'incorrect cannot be higher than attempts',
        path: ['incorrect'],
    });

export const LastAnswerObjectSchema: z.ZodType<LastAnswerObject> = z
    .object({
        isCorrect: z.boolean(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        answeredAt: ISO8601DateTimeSchema,
        timeSpent: z.number().int().nonnegative().optional(),
        hintsUsed: z.number().int().nonnegative().default(0),
        isSkipped: z.boolean().optional(),
    });

export const ProgressRecordSchema: z.ZodType<ProgressRecord> = z.object({
    bucket: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    nextReviewAt: ISO8601DateTimeSchema.optional(),
    stats: StatsObjectSchema,
    lastAnswer: LastAnswerObjectSchema.optional(),
    appSpecific: z.record(z.string(), z.unknown()).optional(),
});

export const ProgressMetaSchema: z.ZodType<ProgressMeta> = z.object({
    setId: UUIDSchema,
    exportedAt: ISO8601DateTimeSchema,
    algorithm: z
        .string()
        .regex(/^[a-z0-9-]+$/, 'algorithm must be lowercase alphanumeric with hyphens format')
        .optional(),
});

export const OQSEProgressSchema: z.ZodType<OQSEProgress> = z.object({
    $schema: z.url().optional(), 
    version: z.string().regex(/^\d+\.\d+$/, 'Version must be in MAJOR.MINOR format'),
    meta: ProgressMetaSchema,
    records: z.record(UUIDSchema, ProgressRecordSchema),
});

export function validateOQSEProgress(data: unknown): OQSEProgress {
    return OQSEProgressSchema.parse(data);
}

export function safeValidateOQSEProgress(data: unknown): ReturnType<typeof OQSEProgressSchema.safeParse> {
    return OQSEProgressSchema.safeParse(data);
}