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
import { checkCompatibility, type CompatibilityReport, type OQSEFile, type OQSEAnyItem, type OQSEMeta } from '@memizy/oqse';

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
  const types = manifest.capabilities.types;
  const all = !types || types.includes('*');
  const items = all ? file.items : file.items.filter((item) => (types as string[]).includes(item.type));
  const display = prepareDisplaySet({ meta: file.meta, items }, options.seed);
  return {
    set: display.set,
    publicSet: display.publicSet,
    compatibility: checkCompatibility(file, manifest),
    skippedItems: file.items.length - items.length,
  };
}
