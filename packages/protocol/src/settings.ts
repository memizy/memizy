/**
 * Game settings declared in the manifest (SPEC section 2).
 * Hosts use these helpers to generate the lobby form, to validate values
 * coming from `updateSettings` or from presets, and to apply defaults.
 */

import { z } from 'zod';

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

export const SettingDefinitionSchema = z.discriminatedUnion('type', [
  NumberSettingSchema,
  BooleanSettingSchema,
  SelectSettingSchema,
  TextSettingSchema,
]);

export type SettingDefinition = z.infer<typeof SettingDefinitionSchema>;
export type SettingValue = string | number | boolean;

// ============================================================================
// Values
// ============================================================================

/** Returns an error description if `value` is not valid for `def`, otherwise `null`. */
export function validateSettingValue(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
      if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'select':
      return def.options.some((o) => o.value === value) ? null : 'must be one of the options';
    case 'text':
      if (typeof value !== 'string') return 'must be text';
      return def.maxLength !== undefined && value.length > def.maxLength ? `must be at most ${def.maxLength} characters` : null;
  }
}

/**
 * Builds the full settings object: every declared setting gets the valid input
 * value or its default. Invalid values and unknown keys are reported in `errors`
 * (and replaced by defaults / dropped).
 */
export function resolveSettings(
  definitions: SettingDefinition[],
  input: Record<string, unknown> = {},
): { values: Record<string, SettingValue>; errors: string[] } {
  const values: Record<string, SettingValue> = {};
  const errors: string[] = [];

  for (const def of definitions) {
    if (!(def.id in input)) {
      values[def.id] = def.default;
      continue;
    }
    const problem = validateSettingValue(def, input[def.id]);
    if (problem) {
      errors.push(`${def.id}: ${problem}`);
      values[def.id] = def.default;
    } else {
      values[def.id] = input[def.id] as SettingValue;
    }
  }
  for (const key of Object.keys(input)) {
    if (!definitions.some((def) => def.id === key)) errors.push(`${key}: unknown setting`);
  }
  return { values, errors };
}

/**
 * Picks the best text for a locale: exact match (`cs-CZ`), language (`cs`),
 * English, then the first available.
 */
export function localize(text: LocalizedText, locale: string): string {
  if (typeof text === 'string') return text;
  const lang = locale.split('-')[0];
  return text[locale] ?? text[lang] ?? text.en ?? Object.values(text)[0];
}
