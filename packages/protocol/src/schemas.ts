/**
 * Runtime validation of plugin → host calls (SPEC 8.4: the host validates
 * every incoming call). Size and rate limits are checked separately (limits.ts).
 */

import { z } from 'zod';
import { ProgressRecordSchema, formatOQSEErrors } from '@memizy/oqse';
import { ProtocolError } from './errors';
import type { HostApi } from './types';

const ShortText = (max: number) => z.string().min(1).max(max);

export const AddressSchema = z.string().min(1).max(128);

export const HandshakeSchema = z.looseObject({
  protocol: z.string().regex(/^\d+\.\d+$/, 'protocol must be in MAJOR.MINOR format'),
  sdk: z.looseObject({ name: ShortText(200), version: ShortText(100) }),
  plugin: z.looseObject({ id: ShortText(500), version: ShortText(100) }),
  features: z.array(ShortText(100)).max(100),
});

export const OutgoingMessageSchema = z.looseObject({
  to: z.union([z.literal('authority'), z.literal('all'), z.array(AddressSchema).min(1).max(500)]),
  data: z.unknown(),
});

export const AnswerRecordSchema = z.looseObject({
  playerId: AddressSchema.optional(),
  itemId: ShortText(128),
  isCorrect: z.boolean(),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  timeSpentMs: z.number().int().nonnegative().optional(),
  hintsUsed: z.number().int().nonnegative().optional(),
  isSkipped: z.boolean().optional(),
  answer: z.unknown().optional(),
  item: z.looseObject({ id: ShortText(128), type: ShortText(64) }).optional(),
}).refine((r) => !r.item || r.item.id === r.itemId, { message: 'item.id must equal itemId', path: ['item', 'id'] });

export const ProgressRecordsSchema = z.record(ShortText(128), ProgressRecordSchema);

export const DataScopeSchema = z.enum(['plugin', 'set']);

export const SettingsUpdateSchema = z.looseObject({
  values: z.record(z.string(), z.unknown()),
  valid: z.boolean(),
  message: z.string().max(500).optional(),
});

export const SessionResultSchema = z.looseObject({
  scores: z.record(AddressSchema, z.number().finite()).optional(),
  summary: z.string().max(1000).optional(),
});

export const ResizeRequestSchema = z.looseObject({
  height: z.union([z.number().positive().max(100_000), z.literal('auto')]),
});

export const ErrorReportSchema = z.looseObject({
  code: ShortText(100),
  message: z.string().max(2000),
  context: z.record(z.string(), z.unknown()).optional(),
});

/** Argument schemas of every Host API method. */
export const HOST_API_ARGS = {
  hello: z.tuple([HandshakeSchema]),
  ready: z.tuple([]),
  send: z.tuple([OutgoingMessageSchema]),
  saveSnapshot: z.tuple([z.unknown()]),
  recordAnswer: z.tuple([AnswerRecordSchema]),
  saveProgress: z.tuple([ProgressRecordsSchema]),
  saveData: z.tuple([DataScopeSchema, z.unknown()]),
  updateSettings: z.tuple([SettingsUpdateSchema]),
  getAsset: z.tuple([ShortText(200), ShortText(128).optional()]),
  end: z.tuple([SessionResultSchema]),
  resize: z.tuple([ResizeRequestSchema]),
  reportError: z.tuple([ErrorReportSchema]),
  exit: z.tuple([]),
} satisfies Record<keyof HostApi, z.ZodType>;

/**
 * Validates the arguments of a Host API call.
 * @throws {ProtocolError} `INVALID_ARGUMENT` with readable details.
 */
export function parseHostCall<M extends keyof HostApi>(method: M, args: unknown[]): Parameters<HostApi[M]> {
  const result = HOST_API_ARGS[method].safeParse(args);
  if (!result.success) {
    throw new ProtocolError('INVALID_ARGUMENT', `${method}: ${formatOQSEErrors(result.error).join('; ')}`);
  }
  return result.data as Parameters<HostApi[M]>;
}
