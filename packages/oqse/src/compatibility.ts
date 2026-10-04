/**
 * The Handshake (Matching Process) from the OQSEM specification:
 * can an application (or plugin) described by a manifest process a given set?
 */

import type { MediaObject, OQSEFile } from './oqse';
import type { OQSEManifest } from './manifest';
import { isVersionCompatible } from './manifest';

export interface UnsupportedAsset {
  /** `meta.assets` key, or `items[i].assets` key prefixed with the item path. */
  path: string;
  type: MediaObject['type'];
  mimeType?: string;
}

export interface CompatibilityReport {
  /** `true` when every MUST rule of the handshake passes. */
  compatible: boolean;
  /** The set's `version` is within `minOqseVersion`–`maxOqseVersion`. */
  versionCompatible: boolean;
  /** Item types used in the set but not supported (MUST). */
  unsupportedTypes: string[];
  /** Assets whose category or MIME type is not supported (MUST). */
  unsupportedAssets: UnsupportedAsset[];
  /** Assets without `mimeType` in a category with an explicit MIME list (cannot be verified). */
  unverifiedAssets: UnsupportedAsset[];
  /** `meta.requirements.features` not supported (MUST). */
  missingFeatures: string[];
  /** `meta.requirements.latexPackages` not supported (MUST). */
  missingLatexPackages: string[];
  /** `meta.requirements.itemProperties` / `metaProperties` not supported (SHOULD). */
  missingProperties: string[];
}

/**
 * Compares a set with an application manifest according to the OQSEM handshake.
 * A host can use `unsupportedTypes` for graceful degradation (e.g., a partial session).
 */
export function checkCompatibility(file: OQSEFile, manifest: OQSEManifest): CompatibilityReport {
  const caps = manifest.capabilities;
  const supports = (list: readonly string[] | null | undefined, value: string) =>
    !!list && list.length > 0 && (list.includes('*') || list.includes(value));

  const usedTypes = [...new Set(file.items.map((item) => item.type))];
  const unsupportedTypes = usedTypes.filter((type) => !supports(caps.types, type));

  const unsupportedAssets: UnsupportedAsset[] = [];
  const unverifiedAssets: UnsupportedAsset[] = [];
  const checkAssets = (assets: Record<string, MediaObject> | undefined, prefix: string) => {
    for (const [key, media] of Object.entries(assets ?? {})) {
      const list = caps.assets?.[media.type] as readonly string[] | null | undefined;
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
  const missingFeatures = missing(req?.features, caps.features);
  const missingLatexPackages = missing(req?.latexPackages, caps.latexPackages);
  const missingProperties = [
    ...missing(req?.itemProperties, caps.itemProperties),
    ...missing(req?.metaProperties, caps.metaProperties),
  ];

  const versionCompatible = isVersionCompatible(file.version, manifest);
  const compatible =
    versionCompatible &&
    unsupportedTypes.length === 0 &&
    unsupportedAssets.length === 0 &&
    missingFeatures.length === 0 &&
    missingLatexPackages.length === 0;

  return {
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
