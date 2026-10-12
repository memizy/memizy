/**
 * Loading a plugin (reading and validating its manifest without running it)
 * and preparing a study set for it.
 */

import {
  isProtocolSupported,
  prepareDisplaySet,
  readPluginManifestFromHtml,
  type PluginManifest,
  type PluginRuntime,
} from '@memizy/protocol';
import { OQSE_VERSION, checkCompatibility, generateUUID, type CompatibilityReport, type OQSEFile, type OQSEAnyItem, type OQSEMeta } from '@memizy/oqse';

export interface LoadedPlugin {
  /** The plugin HTML (rendered with `srcdoc`). */
  html: string;
  manifest: PluginManifest;
  runtime: PluginRuntime;
}

export type LoadPluginResult = { success: true; plugin: LoadedPlugin } | { success: false; errors: string[] };

/** Reads and validates a plugin from its HTML (e.g. a file uploaded to the Plugin Lab). */
export function loadPluginFromHtml(html: string): LoadPluginResult {
  const result = readPluginManifestFromHtml(html);
  if (!result.success) return result;
  if (!isProtocolSupported(result.runtime.protocol)) {
    return { success: false, errors: [`The plugin needs Memizy Plugin Protocol ${result.runtime.protocol}, which this host does not support.`] };
  }
  return { success: true, plugin: { html, manifest: result.manifest, runtime: result.runtime } };
}

/** Downloads a plugin HTML file and loads it. */
export async function loadPluginFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<LoadPluginResult> {
  const response = await fetchImpl(url);
  if (!response.ok) return { success: false, errors: [`Could not download the plugin (${response.status} ${response.statusText}).`] };
  return loadPluginFromHtml(await response.text());
}

export interface PreparedSet {
  /** The items the plugin plays, in display order with answers (the authority; solo). */
  set: { meta: OQSEMeta; items: OQSEAnyItem[] };
  /** The same items without answers (other instances in multiplayer, the relay bundle). */
  publicSet: { meta: OQSEMeta; items: OQSEAnyItem[] };
  compatibility: CompatibilityReport;
  /** Items left out because the plugin does not declare their type. */
  skippedItems: number;
}

/**
 * Keeps only the item types the plugin declares and reports the OQSEM
 * handshake (`checkCompatibility`). The set should already be loaded with
 * `loadOQSEFile`. With a `seed` (normally the session id) the options, pairs
 * and orders are shuffled once for the session (SPEC 4.4).
 */
export function prepareSetForPlugin(file: OQSEFile, manifest: PluginManifest, options: { seed?: string } = {}): PreparedSet {
  // Without `types` the plugin processes no items (a game without questions).
  const types = (manifest.capabilities?.types ?? []) as string[];
  const items = types.includes('*') ? file.items : file.items.filter((item) => types.includes(item.type));
  const display = prepareDisplaySet({ meta: file.meta, items }, options.seed);
  return {
    set: display.set,
    publicSet: display.publicSet,
    compatibility: checkCompatibility(file, manifest),
    skippedItems: file.items.length - items.length,
  };
}

/**
 * An empty study set for a plugin that plays without one (`appSpecific.memizy.set` is
 * `"none"`, or `"optional"` and the host chose no set). The plugin gets `items: []`.
 */
export function createEmptySet(meta: { title: string; language: string }): OQSEFile {
  const now = new Date().toISOString();
  return { version: OQSE_VERSION, meta: { id: generateUUID(), title: meta.title, language: meta.language, createdAt: now, updatedAt: now }, items: [] };
}
