/**
 * Game settings values (SPEC section 2): validation of values, defaults and
 * localization. Hosts use these to validate `updateSettings` and presets; the
 * plugin SDK uses them without pulling in the Zod schemas.
 */

import type { LocalizedText, SettingDefinition } from './settingsSchema';

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
