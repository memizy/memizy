/**
 * Game settings values (SPEC section 2): validation of values, defaults and
 * localization. Hosts use these to validate `updateSettings` and presets; the
 * plugin SDK uses them without pulling in the Zod schemas.
 */

import type { LocalizedText, SettingDefinition } from './settingsSchema';

/** Setting types of this protocol version. */
export const SETTING_TYPES = ['number', 'boolean', 'select', 'text'] as const;

/**
 * A setting of a type from a later protocol version (SPEC 2): hosts do not show it and pass
 * its `default` to the plugin.
 */
export interface UnknownSettingDefinition {
  id: string;
  type: string;
  default: unknown;
  label: LocalizedText;
  description?: LocalizedText;
  modes?: ('solo' | 'multiplayer')[];
}

/** Whether a manifest setting is of a type this protocol version defines. */
export function isKnownSetting(def: SettingDefinition | UnknownSettingDefinition): def is SettingDefinition {
  return (SETTING_TYPES as readonly string[]).includes(def.type);
}

/** A setting value: a number, boolean or text, or any JSON (a setting type of a later version). */
export type SettingValue = string | number | boolean | null | SettingValue[] | { [key: string]: SettingValue };

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
  /** Settings of types from a later version: always their default; input values are ignored. */
  unknownSettings: UnknownSettingDefinition[] = [],
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
  for (const def of unknownSettings) values[def.id] = structuredClone(def.default) as SettingValue;
  for (const key of Object.keys(input)) {
    if (!definitions.some((def) => def.id === key) && !unknownSettings.some((def) => def.id === key)) errors.push(`${key}: unknown setting`);
  }
  return { values, errors };
}

/** The settings a host shows for a mode (`modes` absent = both modes). */
export function settingsForMode<T extends { modes?: readonly string[] }>(definitions: readonly T[], mode: 'solo' | 'multiplayer'): T[] {
  return definitions.filter((def) => !def.modes || def.modes.includes(mode));
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
