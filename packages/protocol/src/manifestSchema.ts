/**
 * Plugin manifest validation (SPEC section 2): an OQSEM document whose
 * `appSpecific.memizy` block describes the runtime. Uses Zod; lightweight
 * helpers without Zod are in pluginRuntime.ts.
 */

import { z } from 'zod';
import { OQSEManifestSchema, formatOQSEErrors, type OQSEManifest } from '@memizy/oqse';
import { SettingDefinitionSchema } from './settingsSchema';
import { extractManifestFromHtml, toRuntime, type PluginRuntime } from './pluginRuntime';

// ============================================================================
// Schemas
// ============================================================================

const ProtocolVersionSchema = z.string().regex(/^\d+\.\d+$/, 'Protocol version must be in MAJOR.MINOR format (e.g. "1.0")');

export const HostAsSchema = z.enum(['presenter', 'player']);

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

/** An origin a plugin may connect to: `https://host[:port]` or `wss://host[:port]`, no path. */
const NetworkOriginSchema = z
  .string()
  .regex(/^(https|wss):\/\/[a-z0-9.-]+(:\d{1,5})?$/i, 'A network origin is "https://host" or "wss://host" (no path)');

/** Service names are dot-separated lowercase segments, e.g. "ai.chat" or "chess.puzzles". */
export const ServiceNameSchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/, 'A service name is lowercase segments joined by dots (e.g. "chess.puzzles")');

export const PluginPermissionsSchema = z.looseObject({
  /** Origins the plugin talks to (fetch, WebSocket). Shown to users; enforced with a CSP. */
  network: z.array(NetworkOriginSchema).max(20).optional(),
  /** Devices the plugin uses. */
  devices: z.array(z.enum(['camera', 'microphone', 'geolocation', 'serial', 'bluetooth'])).max(5).optional(),
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
    /** RC4: what the plugin reaches outside its sandbox (SPEC 8.4). */
    permissions: PluginPermissionsSchema.optional(),
    /** RC4: Memizy services the plugin uses (`ui.service`), e.g. "ai.chat" (SPEC 5.3). */
    services: z.array(ServiceNameSchema).max(20).optional(),
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

/** Extracts and validates the manifest of a plugin HTML file. */
export function readPluginManifestFromHtml(html: string): PluginManifestResult {
  const extracted = extractManifestFromHtml(html);
  if (!extracted.success) return { success: false, errors: [extracted.error] };
  return safeParsePluginManifest(extracted.data);
}
