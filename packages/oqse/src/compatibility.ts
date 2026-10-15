/**
 * The Handshake (Matching Process) from the OQSEM specification:
 * can an application (or plugin) described by a manifest process a given set?
 */

import { MEDIA_TYPES, type MediaObject, type OQSEFile } from './oqse';
import type { OQSEManifest } from './manifest';
import { isVersionCompatible, withManifestDefaults } from './manifest';
import { effectiveFeatures } from './features';

export interface UnsupportedAsset {
  /** `meta.assets` key, or `items[i].assets` key prefixed with the item path. */
  path: string;
  type: MediaObject['type'];
  mimeType?: string;
}

/**
 * - `full`: everything is supported.
 * - `simplified`: types, assets and version are supported, but some features or LaTeX
 *   packages are not; the application shows them by the fallbacks.
 * - `incompatible`: an item type, an asset type or the version is not supported.
 */
export type CompatibilityLevel = 'full' | 'simplified' | 'incompatible';

export interface CompatibilityReport {
  /** The result of the handshake. */
  level: CompatibilityLevel;
  /** `true` unless `level` is `incompatible` (the application can show the set). */
  compatible: boolean;
  /** The set's `version` is within `minOqseVersion`–`maxOqseVersion`. */
  versionCompatible: boolean;
  /** Item types used in the set but not supported (MUST). */
  unsupportedTypes: string[];
  /** Assets whose category or MIME type is not supported (MUST). */
  unsupportedAssets: UnsupportedAsset[];
  /** Assets without `mimeType` in a category with an explicit MIME list (cannot be verified). */
  unverifiedAssets: UnsupportedAsset[];
  /** Features of the set (declared or detected) not supported (shown by the fallbacks: `simplified`). */
  missingFeatures: string[];
  /** `meta.requirements.latexPackages` not supported (formulas shown as source: `simplified`). */
  missingLatexPackages: string[];
  /** `meta.requirements.itemProperties` / `metaProperties` not supported (only reported). */
  missingProperties: string[];
}

/**
 * Compares a set with an application manifest according to the OQSEM handshake.
 * A host can use `unsupportedTypes` for graceful degradation (e.g., a partial session).
 */
export function checkCompatibility(file: OQSEFile, manifest: OQSEManifest): CompatibilityReport {
  const caps = withManifestDefaults(manifest).capabilities;
  const supports = (list: readonly string[] | null | undefined, value: string) =>
    !!list && list.length > 0 && (list.includes('*') || list.includes(value));

  const usedTypes = [...new Set(file.items.map((item) => item.type))];
  const unsupportedTypes = usedTypes.filter((type) => !supports(caps.types, type));

  const unsupportedAssets: UnsupportedAsset[] = [];
  const unverifiedAssets: UnsupportedAsset[] = [];
  const checkAssets = (assets: Record<string, MediaObject> | undefined, prefix: string) => {
    for (const [key, media] of Object.entries(assets ?? {})) {
      // A media type of a later version is shown as a link (its fallback): nothing to check.
      if (!(MEDIA_TYPES as readonly string[]).includes(media.type)) continue;
      const list = (caps.assets as Record<string, readonly string[] | null | undefined> | undefined)?.[media.type];
      const entry: UnsupportedAsset = { path: `${prefix}.${key}`, type: media.type, mimeType: media.mimeType };
      if (!list || list.length === 0) unsupportedAssets.push(entry);
      else if (list.includes('*')) continue;
      else if (!media.mimeType) unverifiedAssets.push(entry);
      else if (!list.includes(media.mimeType)) unsupportedAssets.push(entry);
    }
  };
  checkAssets(file.meta.assets, 'meta.assets');
  file.items.forEach((item, i) => checkAssets(item.assets, `items[${i}].assets`));

  const req = file.meta.requirements;
  const missing = (required: readonly string[] | undefined, supported: readonly string[] | undefined) =>
    (required ?? []).filter((value) => !(supported ?? []).includes(value));
  // Declared features together with the detected ones, so a forgotten declaration does not matter.
  const missingFeatures = missing(effectiveFeatures(file), caps.features);
  const missingLatexPackages = missing(req?.latexPackages, caps.latexPackages);
  const missingProperties = [
    ...missing(req?.itemProperties, caps.itemProperties),
    ...missing(req?.metaProperties, caps.metaProperties),
  ];

  const versionCompatible = isVersionCompatible(file.version, manifest);
  const compatible = versionCompatible && unsupportedTypes.length === 0 && unsupportedAssets.length === 0;
  const level: CompatibilityLevel = !compatible
    ? 'incompatible'
    : missingFeatures.length > 0 || missingLatexPackages.length > 0
      ? 'simplified'
      : 'full';

  return {
    level,
    compatible,
    versionCompatible,
    unsupportedTypes,
    unsupportedAssets,
    unverifiedAssets,
    missingFeatures,
    missingLatexPackages,
    missingProperties,
  };
}
