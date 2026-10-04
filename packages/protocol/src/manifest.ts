/**
 * Plugin manifest (SPEC section 2): an OQSEM document whose
 * `appSpecific.memizy` block describes the runtime.
 */

import { z } from 'zod';
import { OQSEManifestSchema, formatOQSEErrors, type OQSEManifest } from '@memizy/oqse';
import { SettingDefinitionSchema, type SettingDefinition } from './settings';

// ============================================================================
// Schemas
// ============================================================================

const ProtocolVersionSchema = z.string().regex(/^\d+\.\d+$/, 'Protocol version must be in MAJOR.MINOR format (e.g. "1.0")');

export const HostAsSchema = z.enum(['presenter', 'player']);
export type HostAs = z.infer<typeof HostAsSchema>;

export const MultiplayerModeSchema = z.looseObject({
  players: z
    .looseObject({
      min: z.number().int().min(1, 'players.min must be at least 1'),
      max: z.number().int().max(200, 'players.max must be at most 200'),
      recommended: z.number().int().positive().optional(),
    })
    .refine((p) => p.min <= p.max, { message: 'players.min must not be greater than players.max', path: ['min'] })
    .refine((p) => p.recommended === undefined || (p.recommended >= p.min && p.recommended <= p.max), {
      message: 'players.recommended must be between min and max',
      path: ['recommended'],
    }),
  hostAs: z
    .array(HostAsSchema)
    .min(1, 'hostAs must contain "presenter" and/or "player"')
    .refine((list) => new Set(list).size === list.length, 'hostAs must not contain duplicates'),
  lateJoin: z.boolean().optional(),
});

export const MemizyRuntimeSchema = z
  .looseObject({
    protocol: ProtocolVersionSchema,
    modes: z.looseObject({
      solo: z.looseObject({}).optional(),
      multiplayer: MultiplayerModeSchema.optional(),
    }),
    settings: z.array(SettingDefinitionSchema).optional(),
    settingsScreen: z.looseObject({ size: z.enum(['compact', 'large']) }).optional(),
    display: z.looseObject({ orientation: z.enum(['any', 'portrait', 'landscape']).optional() }).optional(),
  })
  .refine((r) => r.modes.solo !== undefined || r.modes.multiplayer !== undefined, {
    message: 'modes must declare "solo" and/or "multiplayer"',
    path: ['modes'],
  })
  .refine((r) => r.settingsScreen === undefined || r.modes.multiplayer !== undefined, {
    message: 'settingsScreen is only used in the multiplayer lobby; declare modes.multiplayer or remove it',
    path: ['settingsScreen'],
  })
  .refine((r) => {
    const ids = (r.settings ?? []).map((s) => s.id);
    return new Set(ids).size === ids.length;
  }, { message: 'Setting ids must be unique', path: ['settings'] });

// ============================================================================
// Types
// ============================================================================

export type MemizyRuntimeManifest = z.infer<typeof MemizyRuntimeSchema>;

/** A plugin manifest: OQSEM plus the required `appSpecific.memizy` block. */
export type PluginManifest = OQSEManifest & {
  appSpecific: Record<string, unknown> & { memizy: MemizyRuntimeManifest };
};

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

export type PluginManifestResult =
  | { success: true; manifest: PluginManifest; runtime: PluginRuntime }
  | { success: false; errors: string[] };

// ============================================================================
// Parsing
// ============================================================================

/**
 * Validates a plugin manifest (OQSEM part and Memizy runtime part).
 * The returned `manifest` is the original object (unknown keys preserved).
 */
export function safeParsePluginManifest(data: unknown): PluginManifestResult {
  const errors: string[] = [];

  const oqsem = OQSEManifestSchema.safeParse(data);
  if (!oqsem.success) errors.push(...formatOQSEErrors(oqsem.error));

  const memizy = (data as { appSpecific?: { memizy?: unknown } } | null)?.appSpecific?.memizy;
  if (memizy === undefined) {
    errors.push('appSpecific.memizy: Missing the Memizy runtime block (protocol, modes, …)');
  } else {
    const runtime = MemizyRuntimeSchema.safeParse(memizy);
    if (!runtime.success) {
      errors.push(...formatOQSEErrors(runtime.error).map((e) => `appSpecific.memizy.${e}`));
    }
  }

  if (errors.length > 0) return { success: false, errors };
  const manifest = data as PluginManifest;
  return { success: true, manifest, runtime: toRuntime(manifest.appSpecific.memizy) };
}

/** Error thrown by {@link parsePluginManifest}. */
export class PluginManifestError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid plugin manifest:\n${errors.join('\n')}`);
    this.name = 'PluginManifestError';
    this.errors = errors;
  }
}

/** Like {@link safeParsePluginManifest}, but throws {@link PluginManifestError}. */
export function parsePluginManifest(data: unknown): { manifest: PluginManifest; runtime: PluginRuntime } {
  const result = safeParsePluginManifest(data);
  if (!result.success) throw new PluginManifestError(result.errors);
  return { manifest: result.manifest, runtime: result.runtime };
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

/** Extracts and validates the manifest of a plugin HTML file. */
export function readPluginManifestFromHtml(html: string): PluginManifestResult {
  const extracted = extractManifestFromHtml(html);
  if (!extracted.success) return { success: false, errors: [extracted.error] };
  return safeParsePluginManifest(extracted.data);
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
