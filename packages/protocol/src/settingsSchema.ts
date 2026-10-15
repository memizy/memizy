/**
 * Zod schemas of the game settings declared in the manifest (SPEC section 2).
 * Kept separate from the value helpers (settings.ts), which need no Zod.
 */

import { z } from 'zod';
import { SETTING_TYPES, type UnknownSettingDefinition } from './settings';

// ============================================================================
// Schemas
// ============================================================================

/** A string, or a map of BCP 47 language → string (e.g. `{ "cs": "Čas", "en": "Time" }`). */
export const LocalizedTextSchema = z.union([
  z.string().min(1, 'Text must not be empty'),
  z
    .record(z.string().min(2), z.string().min(1))
    .refine((map) => Object.keys(map).length > 0, 'Localized text needs at least one language'),
]);
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const SettingBase = {
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/, 'Setting id must start with a letter and contain only letters, digits, "_" and "-"'),
  label: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
  /** Modes the setting applies to (default: both). Hosts show only the relevant ones. */
  modes: z.array(z.enum(['solo', 'multiplayer'])).min(1, 'modes needs at least one mode').optional(),
};

const NumberSettingSchema = z
  .looseObject({
    ...SettingBase,
    type: z.literal('number'),
    default: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
  })
  .refine((s) => s.min === undefined || s.max === undefined || s.min <= s.max, { message: 'min must not be greater than max', path: ['min'] })
  .refine((s) => (s.min === undefined || s.default >= s.min) && (s.max === undefined || s.default <= s.max), {
    message: 'default is outside min/max',
    path: ['default'],
  });

const BooleanSettingSchema = z.looseObject({
  ...SettingBase,
  type: z.literal('boolean'),
  default: z.boolean(),
});

const SelectValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const SelectSettingSchema = z
  .looseObject({
    ...SettingBase,
    type: z.literal('select'),
    options: z.array(z.looseObject({ value: SelectValueSchema, label: LocalizedTextSchema })).min(1, 'A select setting needs at least one option'),
    default: SelectValueSchema,
  })
  .refine((s) => new Set(s.options.map((o) => o.value)).size === s.options.length, { message: 'Option values must be unique', path: ['options'] })
  .refine((s) => s.options.some((o) => o.value === s.default), { message: 'default must be one of the option values', path: ['default'] });

const TextSettingSchema = z
  .looseObject({
    ...SettingBase,
    type: z.literal('text'),
    default: z.string(),
    maxLength: z.number().int().positive().optional(),
  })
  .refine((s) => s.maxLength === undefined || s.default.length <= s.maxLength, { message: 'default is longer than maxLength', path: ['default'] });

/** A setting of a type this protocol version defines (SPEC 2). */
export const SettingDefinitionSchema = z.discriminatedUnion('type', [
  NumberSettingSchema,
  BooleanSettingSchema,
  SelectSettingSchema,
  TextSettingSchema,
]);

export type SettingDefinition = z.infer<typeof SettingDefinitionSchema>;

/**
 * A setting of a type from a later protocol version (SPEC 2): hosts do not show it and
 * pass its `default` (any JSON value) to the plugin.
 */
export const UnknownSettingSchema = z.looseObject({
  ...SettingBase,
  type: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'A setting type is a lowercase name')
    .refine((type) => !(SETTING_TYPES as readonly string[]).includes(type), 'A known setting type'),
  default: z.unknown().refine((value) => value !== undefined, 'A setting needs a default'),
});

/**
 * One entry of `settings` in a manifest: a known setting (validated by its type, with clear
 * messages) or a setting of a later version (only `id`, `label`, `default`).
 */
export const SettingEntrySchema = z.unknown().transform((value, ctx): SettingDefinition | UnknownSettingDefinition => {
  const type = typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined;
  const known = typeof type === 'string' && (SETTING_TYPES as readonly string[]).includes(type);
  const result = (known ? SettingDefinitionSchema : UnknownSettingSchema).safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path as PropertyKey[] });
    return z.NEVER;
  }
  return result.data as SettingDefinition | UnknownSettingDefinition;
});
