/**
 * OQSE v0.1 - Application Manifest Type Definitions
 * (Open Quiz & Study Exchange)
 *
 * Type-safe TypeScript definitions for the OQSE Application Manifest (Section 2).
 * Every application that interacts with OQSE data MUST declare its capabilities
 * via this manifest format.
 *
 * @see ../oqse-manifest.md#oqsem-application-manifest
 */

import type { FeatureProfile, PersonObject } from './oqse';

// Re-export FeatureProfile so consumers can import everything from this module.
export type { FeatureProfile } from './oqse';

// ============================================================================
// Action Registry  Section 2.1.3
// ============================================================================

/**
 * Official actions from the OQSE Action Registry (Section 2.1.3).
 *
 * - `render`   - Player/learning mode: displays items interactively.
 * - `edit`     - Authoring mode: creates/modifies item content.
 * - `validate` - Verification mode: checks structural/logical correctness.
 * - `import`   - Data ingestion: parses OQSE data into an internal system.
 * - `export`   - Data generation: serializes internal data into OQSE format.
 */
export const OFFICIAL_ACTIONS = ['render', 'edit', 'validate', 'import', 'export'] as const;
export type OfficialAction = typeof OFFICIAL_ACTIONS[number];

/**
 * Custom action using the required `x-` prefix (e.g., `"x-preview"`, `"x-sync"`).
 * Host environments that do not recognize a custom action MUST ignore it.
 */
export type CustomAction = `x-${string}`;

/**
 * Any action value: official from the Action Registry or a custom `x-` prefixed action.
 */
export type OQSEAction = OfficialAction | CustomAction;

// ============================================================================
// Study Mode & Question Density  Section 2.1.1
// ============================================================================

/**
 * Primary experience type of an application.
 *
 * - `"game"`  - Entertainment-first; gameplay mechanics take priority.
 * - `"fun"`   - Balanced blend of interactivity and learning.
 * - `"drill"` - Maximally focused, distraction-free repetition.
 *
 * If absent, no assumption is made.
 */
export type OQSEStudyMode = 'game' | 'fun' | 'drill';

/**
 * Ratio of quiz items relative to non-question game elements.
 *
 * - `"low"`    - Questions appear rarely; gameplay dominates.
 * - `"medium"` - Questions and gameplay are roughly balanced.
 * - `"high"`   - Nearly every interaction is a question.
 *
 * If `studyMode` is `"drill"`, hosts SHOULD treat this as `"high"` regardless.
 * If absent, no assumption is made.
 */
export type OQSEQuestionDensity = 'low' | 'medium' | 'high';

// ============================================================================
// Official Feature Registry  Section 2.2
// ============================================================================

/**
 * All officially recognized feature keys from the OQSE Feature Registry (Section 2.2).
 *
 * Features are declared in `capabilities.features` (Manifest) and in
 * `meta.requirements.features` (Study Set) to signal support/requirement.
 *
 * Dependency notes:
 * - `syntax-highlighting`, `mermaid`, `smiles`, `abc-notation`, `html`
 *   are only meaningful when `markdown` is also declared.
 * - `latexPackages` (in FeatureProfile) is only meaningful when `math` is declared.
 */
export const OFFICIAL_FEATURE_KEYS = [
  // 1. Base Formatting (Tier 1)
  'markdown',
  'math',
  'rtl',

  // 2. Extended Formatting & Blocks (Higher parsing complexity or sanitization overhead)
  'html',
  'syntax-highlighting',
  'mermaid',
  'smiles',
  'abc-notation',

  // 3. Device & Interaction Features (Client capabilities)
  'text-to-speech',
  'voice-input',
  'handwriting-recognition'
] as const;

export type OfficialFeatureKey = typeof OFFICIAL_FEATURE_KEYS[number];

/**
 * A custom feature using the required `x-` prefix (e.g., `"x-memizy-3d-voxel"`).
 * MUST NOT collide with current or future official registry entries.
 * SHOULD be documented in the manifest's own `appSpecific` field.
 */
export type CustomFeatureKey = `x-${string}`;

/**
 * Any feature flag: official from the registry or a custom `x-` prefixed value.
 */
export type FeatureFlag = OfficialFeatureKey | CustomFeatureKey;

// ============================================================================
// Item Property Registry  Section 2.2
// ============================================================================

/**
 * Official item-level property keys from the OQSE itemProperties registry (Section 2.2).
 *
 * Declared in `capabilities.itemProperties` (app support) and
 * `meta.requirements.itemProperties` (set requirement).
 */
export const OFFICIAL_ITEM_PROPERTIES = [
  'hints',             // Application displays optional hints
  'explanation',       // Application shows explanation after answer
  'incorrectFeedback', // Application shows feedback specific to wrong answers
  'sources',           // Application displays item-level source references
  'relatedItems',      // Application navigates to/displays related items
  'dependencyItems',   // Application enforces item prerequisites
  'timeLimit',         // Application enforces/displays item time limits
  'lang',              // Application respects per-item language override
  'topic',             // Application groups/filters items by topic
  'pedagogy'           // Application uses IRT/forgetting-curve data
] as const;

export type OfficialItemProperty = typeof OFFICIAL_ITEM_PROPERTIES[number];

/**
 * A custom item property using the `x-` prefix.
 */
export type CustomItemProperty = `x-${string}`;

/**
 * Any item property key: official or custom.
 */
export type ItemPropertyKey = OfficialItemProperty | CustomItemProperty;

// ============================================================================
// Meta Property Registry  Section 2.2
// ============================================================================

/**
 * Official set-level (meta) property keys from the OQSE metaProperties registry (Section 2.2).
 *
 * Declared in `capabilities.metaProperties` (app support) and
 * `meta.requirements.metaProperties` (set requirement).
 */
export const OFFICIAL_META_PROPERTIES = [
  'description',     // Application displays set description
  'thumbnail',       // Application displays set cover image
  'subject',         // Application uses subject for categorization/search
  'language',        // Application respects set language (TTS, fonts, locale)
  'author',          // Application attributes the primary author
  'contributors',    // Application attributes all contributors
  'license',         // Application displays licensing and respects rights
  'ageRestriction',  // Application respects ageMin/ageMax recommendations
  'tags',            // Application supports browsing/filtering by tags
  'tagDefinitions',  // Application uses tag definitions (Wikidata tooltips)
  'sourceMaterials', // Application displays the set's source range
  'estimatedTime',   // Application displays/uses completion time estimate
  'prerequisites',   // Application enforces prerequisite sets
  'translations',    // Application offers navigation to translated versions
  'relatedSets'      // Application suggests related study sets
] as const;

export type OfficialMetaProperty = typeof OFFICIAL_META_PROPERTIES[number];

/**
 * A custom meta property using the `x-` prefix.
 */
export type CustomMetaProperty = `x-${string}`;

/**
 * Any meta property key: official or custom.
 */
export type MetaPropertyKey = OfficialMetaProperty | CustomMetaProperty;

// ============================================================================
// Wildcard / Null Array Semantics  Section 2.1.2
// ============================================================================

/**
 * A typed "explicit list" array - lists concrete accepted values.
 * Used for MIME type arrays in ManifestAssets and for item `types`.
 */
export type ExplicitArray<T extends string> = T[];

/**
 * A "wildcard" array - the single-element tuple `["*"]` meaning "all accepted."
 */
export type WildcardArray = ['*'];

/**
 * The full wildcard-or-explicit-or-null semantic for `types` and `assets` values:
 *
 * | Value            | Meaning                              |
 * |------------------|--------------------------------------|
 * | `["*"]`          | All accepted (any type/MIME).        |
 * | `["a/b", ...]`   | Only the listed values are supported.|
 * | `null`           | Not supported; hosts MUST NOT pass.  |
 * | `[]` / absent    | Equivalent to `null` (not supported).|
 *
 * Parsers MUST treat `[]` identically to `null`.
 */
export type WildcardOrExplicit<T extends string> = WildcardArray | ExplicitArray<T> | null;

// ============================================================================
// Manifest Assets Map  Section 2.1.2
// ============================================================================

/**
 * Common image MIME types recognized by OQSE.
 * Applications MAY support additional types; these are well-known values.
 */
export type ImageMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/avif'
  | 'image/bmp'
  | `image/${string}`;

/**
 * Common audio MIME types recognized by OQSE.
 */
export type AudioMimeType =
  | 'audio/mpeg'
  | 'audio/ogg'
  | 'audio/wav'
  | 'audio/aac'
  | 'audio/flac'
  | 'audio/mp4'
  | `audio/${string}`;

/**
 * Common video MIME types recognized by OQSE.
 */
export type VideoMimeType =
  | 'video/mp4'
  | 'video/webm'
  | 'video/ogg'
  | 'video/quicktime'
  | `video/${string}`;

/**
 * 3D model MIME types recognized by OQSE.
 * glTF format (`.glb` / `.gltf`) is RECOMMENDED as the universal baseline.
 */
export type ModelMimeType =
  | 'model/gltf-binary'   // .glb
  | 'model/gltf+json'     // .gltf
  | 'model/obj'           // .obj
  | 'model/fbx'           // .fbx
  | `model/${string}`;

/**
 * Asset support map for the four supported asset categories.
 *
 * Per each category:
 * - `["*"]`             - Accepts any MIME type in this category.
 * - `["image/png", ...]` - Only the listed MIME types.
 * - `null` or absent    - Category not supported.
 * - `[]`                - Equivalent to `null` (not supported); SHOULD NOT be emitted.
 *
 * If the entire `assets` object is omitted, the application declares no media support.
 */
export interface ManifestAssets {
  /** Image asset support */
  image?: WildcardOrExplicit<ImageMimeType>;
  /** Audio asset support */
  audio?: WildcardOrExplicit<AudioMimeType>;
  /** Video asset support */
  video?: WildcardOrExplicit<VideoMimeType>;
  /** 3D model asset support. glTF (`model/gltf-binary`) is RECOMMENDED. */
  model?: WildcardOrExplicit<ModelMimeType>;
}

// ============================================================================
// Manifest Capabilities Object  Section 2.1.2
// ============================================================================

/**
 * The `capabilities` object in the Application Manifest.
 *
 * Extends FeatureProfile by adding `actions`, `types`, and `assets`.
 * Declares everything the application can do, what types it handles,
 * what media formats it accepts, and which OQSE features it supports.
 *
 * @see ../oqse-manifest.md#capabilities-object-extends-featureprofile
 */
export interface ManifestCapabilities extends FeatureProfile {
  /**
  * Actions the application can perform (REQUIRED, >=1 value).
   * MUST contain at least one value from the Action Registry.
   * Custom actions MUST use the `x-` prefix.
   *
   * @example `["render", "edit"]`
   */
  actions: OQSEAction[];

  /**
   * OQSE item types the application supports.
   *
   * - Required (at least one type or `["*"]`) when `actions` includes `render` or `edit`.
   * - MAY be omitted for `validate`, `import`, or `export`-only applications.
   * - `["*"]` - supports all item types.
   * - `[]` / `null` - equivalent; treated as "no types declared".
   * - Custom types MUST use the `x-` prefix.
   *
   * @example `["flashcard", "mcq-single", "*"]`
   */
  types?: WildcardOrExplicit<string>;

  /**
   * Media asset support map.
   * If omitted entirely, the application declares no media support.
   *
   * @see ManifestAssets
   */
  assets?: ManifestAssets;

  /**
   * Array of supported feature flags.
   * Values MUST come from the Official Feature Registry or use the `x-` prefix.
   *
   * @see OfficialFeatureKey
   * @see FeatureFlag
   */
  features?: FeatureFlag[];

  /**
   * Array of supported LaTeX packages.
   * Only meaningful when `features` includes `"math"`.
   *
   * @example `["mhchem", "amsmath"]`
   */
  latexPackages?: string[];

  /**
   * Item-level properties the application supports.
   *
   * @see OfficialItemProperty
   * @see ItemPropertyKey
   */
  itemProperties?: ItemPropertyKey[];

  /**
   * Set-level metadata properties the application supports.
   *
   * @see OfficialMetaProperty
   * @see MetaPropertyKey
   */
  metaProperties?: MetaPropertyKey[];
}

// ============================================================================
// OQSE Application Manifest (Root Object)  Section 2.1.1
// ============================================================================

/**
 * OQSE Application Manifest (Section 2.1).
 *
 * Every application, micro-frontend, or plugin that interacts with OQSE data
 * MUST declare its capabilities using this structure.
 *
 * **Delivery options:**
 * - HTML application: `<script type="application/oqse-manifest+json">` tag.
 * - Non-HTML application: static `oqse-manifest.json` at the deployment root.
 * - HTTP discovery: `Link: <manifest.json>; rel="oqse-manifest"` header.
 *
 * @see ../oqse-manifest.md#oqsem-application-manifest
 *
 * @example
 * ```json
 * {
 *   "$schema": "https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-manifest-v0.1.json",
 *   "version": "0.1",
 *   "pluginVersion": "2.1.0",
 *   "id": "https://memizy.com/universal-player",
 *   "appName": "Memizy Universal Player",
 *   "capabilities": {
 *     "actions": ["render"],
 *     "types": ["flashcard", "mcq-single"],
 *     "features": ["math", "markdown"]
 *   }
 * }
 * ```
 */
export interface OQSEManifest {
  /**
   * URL reference to the JSON Schema for automatic validation.
   * Recommended but not required.
  * @example `"https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-manifest-v0.1.json"`
   */
  $schema?: string;

  /**
   * Version of the Application Manifest format (REQUIRED).
   * MUST follow `"MAJOR.MINOR"` format. The current version is `"0.1"`.
   * Malformed values MUST cause the host to reject this manifest.
   *
   * @example `"0.1"`
   */
  version: string;

  /**
   * Version of the application/plugin itself using SemVer.
   * Independent of the manifest format version.
   *
   * @example `"2.1.0"`
   */
  pluginVersion?: string;

  /**
   * Minimum OQSE spec version this application requires.
   * MUST follow `"MAJOR.MINOR"` format. Version comparison is numeric field-by-field.
   * If malformed, treat as absent and SHOULD warn.
   * MUST be \u2264 `maxOqseVersion` when both are declared.
   *
   * @example `"0.1"`
   */
  minOqseVersion?: string;

  /**
   * Maximum OQSE spec version this application is compatible with.
   * MUST follow `"MAJOR.MINOR"` format. If absent, no upper bound is assumed.
   * If malformed, treat as absent and SHOULD warn.
   *
   * @example `"1.99"`
   */
  maxOqseVersion?: string;

  /**
   * Unique identifier for this application (REQUIRED).
   * MUST be either:
   * - A controlled URL (preferred): `"https://memizy.com/player"`
   * - A URN-format UUID: `"urn:uuid:019aa600-abc1-7234-b678-c0ffee000001"`
   */
  id: string;

  /**
   * Human-readable name of the application (REQUIRED).
   * MUST be non-empty. Plain Text.
   *
   * @example `"Memizy Universal Player"`
   */
  appName: string;

  /**
   * Human-readable description of what the application does.
   * Displayed in host environments and plugin catalogs.
  * **Rich Content** (Markdown/LaTeX supported by host capabilities).
   */
  description?: string;

  /**
   * Information about the main author or organization.
   * Uses the standard `PersonObject` structure.
   */
  author?: PersonObject;

  /**
   * Array of information about other contributors.
   */
  contributors?: PersonObject[];

  /** SPDX license identifier (e.g., "MIT", "GPL-3.0"). */
  license?: string;

  /** URI to the full text of the license. */
  licenseUrl?: string;

  /**
   * BCP 47 locale codes for the application's supported UI languages.
   * If absent or `[]`, the host SHOULD assume the application supports English.
   *
   * @example `["en", "cs"]`
   */
  locales?: string[];

  /**
   * Plain-text keywords for filtering and discovery in host environments/catalogs.
   * Uses the same convention as `meta.tags` in study sets.
   *
   * @example `["flashcards", "spaced-repetition", "chess"]`
   */
  tags?: string[];

  /**
   * A single emoji used as the application's visual identity in catalogs.
   * SHOULD be a single visually-rendered emoji glyph.
   * Multi-codepoint emoji (flags, family sequences) are acceptable.
   * If a future `iconUrl` field is also declared, hosts SHOULD prefer that.
   *
   * @example `"\uD83E\uDDE0"` (brain), `"\uD83D\uDE80"` (rocket), `"\uD83C\uDFAE"` (game controller)
   */
  emoji?: string;

  /**
   * Primary experience type of the application.
   * MUST be one of `"game"`, `"fun"`, or `"drill"`.
   * If absent, no assumption is made.
   */
  studyMode?: OQSEStudyMode;

  /**
   * Ratio of quiz questions relative to other game elements.
   * MUST be one of `"low"`, `"medium"`, or `"high"`.
   * If `studyMode` is `"drill"`, hosts SHOULD treat this as `"high"`.
   * If absent, no assumption is made.
   */
  questionDensity?: OQSEQuestionDensity;

  /**
   * Object for application-specific metadata not covered by standard fields.
   * Applications declaring custom `x-` features SHOULD document their semantics here.
   * Other applications MUST ignore this object.
   */
  appSpecific?: Record<string, unknown>;

  /**
   * Capabilities of this application (REQUIRED).
   * Extends FeatureProfile with `actions`, `types`, and `assets`.
   *
   * @see ManifestCapabilities
   */
  capabilities: ManifestCapabilities;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates that a version string follows the `"MAJOR.MINOR"` format
 * required by both `manifest.version` and `minOqseVersion`/`maxOqseVersion`.
 *
 * @param version - The version string to validate.
 * @returns `true` if valid (e.g., `"0.1"`, `"2.10"`), `false` otherwise.
 *
 * @example
 * isValidManifestVersion("0.1")   // true
 * isValidManifestVersion("2.10")  // true
 * isValidManifestVersion("1.0.0") // false (SemVer, not allowed here)
 * isValidManifestVersion("v0.1")  // false
 */
export function isValidManifestVersion(version: string): boolean {
  return /^\d+\.\d+$/.test(version);
}

/**
 * Validates that a SemVer string follows the `"MAJOR.MINOR.PATCH"` format
 * required by `manifest.pluginVersion`.
 *
 * @param version - The SemVer string to validate.
 * @returns `true` if valid (e.g., `"2.1.0"`, `"1.0.0-rc.1"`), `false` otherwise.
 */
export function isValidSemVer(version: string): boolean {
  // semver: MAJOR.MINOR.PATCH with optional pre-release and build metadata
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version);
}

/**
 * Numerically compares two `"MAJOR.MINOR"` version strings.
 *
 * @returns
 * - Negative number if `a < b`
 * - `0` if `a === b`
 * - Positive number if `a > b`
 *
 * @example
 * compareManifestVersions("0.1", "1.10")  // negative (0.1 < 1.10)
 * compareManifestVersions("2.0", "1.99")  // positive (2.0 > 1.99)
 */
export function compareManifestVersions(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
}

/**
 * Type guard: checks whether a value is a valid `OQSEManifest` at runtime.
 *
 * Performs only structural validation (presence of required fields and correct types).
 * For full spec-compliant validation including enum values and version format,
 * use the Zod schema in `src/app/schemas/`.
 *
 * @param value - Unknown parsed JSON value.
 * @returns `true` if the value has the required shape of an `OQSEManifest`.
 */
export function isOQSEManifest(value: unknown): value is OQSEManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  const author = m['author'];

  return (
    typeof m['version'] === 'string' &&
    typeof m['id'] === 'string' &&
    typeof m['appName'] === 'string' &&
    m['appName'] !== '' &&
    (author === undefined || (typeof author === 'object' && author !== null)) &&
    typeof m['capabilities'] === 'object' &&
    m['capabilities'] !== null &&
    Array.isArray((m['capabilities'] as Record<string, unknown>)['actions'])
  );
}

/**
 * Checks whether an OQSE file's version is within the application's
 * declared min/max OQSE version range.
 *
 * @param fileVersion   - The `version` field of the OQSE study set file (e.g., `"0.1"`).
 * @param manifest      - The Application Manifest to check against.
 * @returns `true` if the file is compatible, `false` if the host MUST NOT load it.
 */
export function isVersionCompatible(fileVersion: string, manifest: OQSEManifest): boolean {
  if (!isValidManifestVersion(fileVersion)) return false;

  if (manifest.minOqseVersion && isValidManifestVersion(manifest.minOqseVersion)) {
    if (compareManifestVersions(fileVersion, manifest.minOqseVersion) < 0) return false;
  }

  if (manifest.maxOqseVersion && isValidManifestVersion(manifest.maxOqseVersion)) {
    if (compareManifestVersions(fileVersion, manifest.maxOqseVersion) > 0) return false;
  }

  return true;
}


