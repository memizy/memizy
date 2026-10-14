/**
 * Links that preselect a game, a set and settings (`/host` and `/solo`), e.g. from the
 * Memizy website or an LMS:
 *
 *   ?plugin=pirates | ?pluginUrl=https://…   the game (a built-in key, `lab`, or a URL)
 *   ?set=spanish-verb-tenses | ?setUrl=https://…   the set (a built-in name or key, a stored set)
 *   ?settings={"rounds":10}   setting values (JSON; invalid ones are left out and reported)
 *
 * A link only fills in the choice for this visit – the user always starts the game, and
 * the choices remembered in this browser are not overwritten.
 */

import { resolveSettings, type SettingDefinition, type SettingValue } from '@memizy/protocol';
import { ALL_PLUGINS, type PluginChoice } from './plugins';
import { NO_SET_KEY, type StudySet } from './sets';

export type LinkProblem = { kind: 'game' | 'set' | 'settings'; value: string };

export interface LinkParams {
  plugin: PluginChoice | null;
  set: { name: string } | { url: string } | null;
  settings: Record<string, unknown> | null;
  problems: LinkProblem[];
}

const first = (value: unknown): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export function readLinkParams(query: Record<string, unknown>): LinkParams {
  const problems: LinkProblem[] = [];
  let plugin: PluginChoice | null = null;
  const pluginKey = first(query.plugin);
  const pluginUrl = first(query.pluginUrl);
  if (pluginUrl) {
    if (isHttpUrl(pluginUrl)) plugin = { kind: 'url', url: pluginUrl };
    else problems.push({ kind: 'game', value: pluginUrl });
  } else if (pluginKey === 'lab') plugin = { kind: 'lab' };
  else if (pluginKey) {
    if (ALL_PLUGINS.some((p) => p.key === pluginKey)) plugin = { kind: 'example', key: pluginKey };
    else problems.push({ kind: 'game', value: pluginKey });
  }

  let set: LinkParams['set'] = null;
  const setUrl = first(query.setUrl);
  const setName = first(query.set);
  if (setUrl) {
    if (isHttpUrl(setUrl)) set = { url: setUrl };
    else problems.push({ kind: 'set', value: setUrl });
  } else if (setName) set = { name: setName };

  let settings: Record<string, unknown> | null = null;
  const settingsText = first(query.settings);
  if (settingsText) {
    try {
      const parsed = JSON.parse(settingsText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>;
      else problems.push({ kind: 'settings', value: settingsText });
    } catch {
      problems.push({ kind: 'settings', value: settingsText });
    }
  }
  return { plugin, set, settings, problems };
}

/** The key of a set named in a link: a key (`builtin:…`, a stored set's ID), `none` (no questions), or a built-in set's file name. */
export function findSetKey(name: string, sets: StudySet[]): string | null {
  if (name.toLowerCase() === NO_SET_KEY) return NO_SET_KEY;
  const lower = name.toLowerCase();
  return sets.find((s) => s.key === name || s.file.meta.id === name || s.slug?.toLowerCase() === lower)?.key ?? null;
}

/**
 * Applies setting values from a link on top of `current`: each value is checked alone
 * (`resolveSettings`); unknown settings and invalid values are left out and returned.
 */
export function applyLinkSettings(
  definitions: SettingDefinition[],
  current: Record<string, SettingValue>,
  link: Record<string, unknown>,
): { values: Record<string, SettingValue>; rejected: string[] } {
  let values = resolveSettings(definitions, current).values;
  const rejected: string[] = [];
  for (const [id, value] of Object.entries(link)) {
    const next = resolveSettings(definitions, { ...values, [id]: value });
    if (next.errors.length > 0 || !definitions.some((d) => d.id === id)) rejected.push(id);
    else values = next.values;
  }
  return { values, rejected };
}
