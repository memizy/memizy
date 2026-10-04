/**
 * The runtime part of a plugin manifest with defaults applied, and reading the
 * manifest data island from HTML. No Zod: usable by the plugin SDK.
 */

import type { MemizyRuntimeManifest } from './manifestSchema';
import type { SettingDefinition } from './settingsSchema';

export type HostAs = 'presenter' | 'player';

export type PluginView = 'solo' | 'board' | 'controller' | 'settings';

/** The runtime part with all defaults applied – what hosts work with. */
export interface PluginRuntime {
  protocol: string;
  solo: boolean;
  multiplayer: null | {
    players: { min: number; max: number; recommended?: number };
    hostAs: HostAs[];
    lateJoin: boolean;
  };
  settings: SettingDefinition[];
  settingsScreen: null | { size: 'compact' | 'large' };
  orientation: 'any' | 'portrait' | 'landscape';
  /** Views the plugin must render (SPEC 3.2). */
  views: PluginView[];
}

const DATA_ISLAND_RE = /<script\b[^>]*\btype\s*=\s*["']application\/oqse-manifest\+json["'][^>]*>([\s\S]*?)<\/script\s*>/i;

/**
 * Reads the manifest data island from plugin HTML **without executing it**
 * (works in browsers and in Node). Returns the parsed JSON, or an error.
 */
export function extractManifestFromHtml(html: string): { success: true; data: unknown } | { success: false; error: string } {
  const match = DATA_ISLAND_RE.exec(html);
  if (!match) return { success: false, error: 'No <script type="application/oqse-manifest+json"> data island found.' };
  try {
    return { success: true, data: JSON.parse(match[1]) };
  } catch (e) {
    return { success: false, error: `The manifest data island is not valid JSON: ${(e as Error).message}` };
  }
}

/** Applies defaults and derives the views (SPEC 3.2). */
export function toRuntime(memizy: MemizyRuntimeManifest): PluginRuntime {
  const mp = memizy.modes.multiplayer;
  const multiplayer = mp
    ? {
        players: { min: mp.players.min, max: mp.players.max, ...(mp.players.recommended !== undefined && { recommended: mp.players.recommended }) },
        hostAs: [...mp.hostAs],
        lateJoin: mp.lateJoin ?? true,
      }
    : null;

  const views: PluginView[] = [];
  if (memizy.modes.solo) views.push('solo');
  if (multiplayer?.hostAs.includes('presenter')) views.push('board');
  if (multiplayer) views.push('controller');
  if (multiplayer && memizy.settingsScreen) views.push('settings');

  return {
    protocol: memizy.protocol,
    solo: memizy.modes.solo !== undefined,
    multiplayer,
    settings: memizy.settings ?? [],
    settingsScreen: memizy.settingsScreen ? { size: memizy.settingsScreen.size } : null,
    orientation: memizy.display?.orientation ?? 'any',
    views,
  };
}
