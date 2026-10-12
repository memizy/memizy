/**
 * @file manifestValidation.ts
 * @description OQSEM v1.0 Zod validation schemas for the OQSE Application Manifest (section 2.1.1).
 *
 * Mirrors every type defined in `manifest.ts` and exposes helper functions for
 * validating manifest objects received from plugins, presets, or remote sources.
 *
 * @see {@link ./manifest.ts} for the corresponding TypeScript type definitions.
 * @see {@link ../oqse-manifest.md#oqsem-root-object} for the canonical specification.
 */

import { z } from 'zod';
import { OFFICIAL_ITEM_TYPES } from './oqse';
import {
  OFFICIAL_ACTIONS,
  type OQSEManifest,
} from './manifest';
import { FeatureKeySchema, FeatureProfileSchema, PersonObjectSchema, PropertyKeySchema } from './oqseValidation';

// ============================================================================
// Primitive helpers
// ============================================================================

/** Non-empty plain-text string (no leading/trailing whitespace). */
const NonEmptyStringSchema = z.string().min(1, 'Value must not be empty').trim();

/** Pragmatic BCP 47 locale validation (e.g. "en", "cs", "en-US"). */
const BCP47Schema = z
  .string()
  .regex(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9\-]+)*$/, 'Must be a valid BCP 47 locale (e.g., "en", "cs")');

/** Absolute URL (http/https). */
const AbsoluteURLSchema = z
  .string()
  .url('Must be a valid absolute URL')
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
    message: 'URL must use http or https scheme',
  });

/** URN UUID format (e.g. "urn:uuid:123e4567-e89b-12d3-a456-426614174000"). */
const URNUUIDSchema = z
  .string()
  .regex(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Must be a valid URN UUID (urn:uuid:...)'
  );

/** Version string in MAJOR.MINOR format (e.g. "1.0", "2.3"). */
const ManifestVersionSchema = z
  .string()
  .regex(/^\d+\.\d+$/, 'Version must be in MAJOR.MINOR format (e.g. "1.0")');

/**
 * Version of the manifest format this library reads: OQSEM 1.x. Other MAJOR versions
 * are refused rather than read as 1.x (see "Versioning" in the specification).
 */
const SupportedManifestVersionSchema = z
  .string()
  .regex(/^1\.\d+$/, 'Unsupported manifest version: this library reads OQSEM 1.x manifests (write "version": "1.0")');


const OQSEItemTypeSchema = NonEmptyStringSchema.refine(
  (v) =>
    (OFFICIAL_ITEM_TYPES as ReadonlyArray<string>).includes(v) ||
    v.startsWith('x-'),
  { message: 'Custom types MUST use the "x-" prefix' }
);

// ============================================================================
// Actions
// ============================================================================

/**
 * A valid OQSE action: one of the five official actions, or a vendor-specific
 * action prefixed with `x-` (e.g. `x-acme-grade`).
 */
export const OQSEActionSchema = z
  .string()
  .refine(
    (v) => (OFFICIAL_ACTIONS as ReadonlyArray<string>).includes(v) || v.startsWith('x-'),
    {
      message:
        'Action must be one of [render, edit, validate, import, export] or have prefix "x-"',
    }
  );

// ============================================================================
// Study Mode & Question Density
// ============================================================================

/** Recommended study modality for a set of items. */
export const OQSEStudyModeSchema = z.enum(['game', 'fun', 'drill']);

/** Recommended question density per session. */
export const OQSEQuestionDensitySchema = z.enum(['low', 'medium', 'high']);

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * A feature flag: an official key, a newer one from a later 1.x version (hosts ignore
 * it) or a vendor-specific key prefixed with `x-` (e.g. `x-acme-chemistry`).
 */
export const FeatureFlagSchema = FeatureKeySchema;

// ============================================================================
// Property Key Schemas
// ============================================================================

/** Item-level property keys (official, newer or vendor-prefixed). */
export const ItemPropertyKeySchema = PropertyKeySchema;

/** Meta-level property keys (official, newer or vendor-prefixed). */
export const MetaPropertyKeySchema = PropertyKeySchema;

// ============================================================================
// WildcardOrExplicit pattern
// ============================================================================

/**
 * Creates a schema for the `WildcardOrExplicit<T>` pattern used in
 * `ManifestAssets` and `ManifestCapabilities`.
 *
 * Valid values:
 * - `['*']` - wildcard, accepts anything
 * - `T[]` - explicit allow-list
 * - `null` - feature disabled / not supported
 */
function wildcardOrExplicit<T extends z.ZodTypeAny>(
  itemSchema: T
): z.ZodUnion<[z.ZodTuple<[z.ZodLiteral<'*'>]>, z.ZodArray<T>, z.ZodNull]> {
  return z.union([z.tuple([z.literal('*')]), z.array(itemSchema), z.null()]);
}

// ============================================================================
// MIME Type Schemas
// ============================================================================

/** Any valid image MIME type. */
export const ImageMimeTypeSchema = z
  .string()
  .refine((v) => v.startsWith('image/'), { message: 'Must be a valid image MIME type (image/...)' });

/** Any valid audio MIME type. */
export const AudioMimeTypeSchema = z
  .string()
  .refine((v) => v.startsWith('audio/'), { message: 'Must be a valid audio MIME type (audio/...)' });

/** Any valid video MIME type. */
export const VideoMimeTypeSchema = z
  .string()
  .refine((v) => v.startsWith('video/'), { message: 'Must be a valid video MIME type (video/...)' });

/** Any valid 3D model MIME type. */
export const ModelMimeTypeSchema = z
  .string()
  .refine(
    (v) => v.startsWith('model/') || v === 'application/octet-stream',
    { message: 'Must be a valid 3D model MIME type (model/... or application/octet-stream)' }
  );

// ============================================================================
// Manifest Assets
// ============================================================================

/**
 * Declares which media asset MIME types an application can handle.
 * `null` means the category is not supported; `['*']` means all MIME types
 * within that category are accepted; an array lists explicit MIME types.
 */
export const ManifestAssetsSchema = z.object({
  image: wildcardOrExplicit(ImageMimeTypeSchema).optional(),
  audio: wildcardOrExplicit(AudioMimeTypeSchema).optional(),
  video: wildcardOrExplicit(VideoMimeTypeSchema).optional(),
  model: wildcardOrExplicit(ModelMimeTypeSchema).optional(),
});

// ============================================================================
// Manifest Capabilities
// ============================================================================

/**
 * Full capability declaration of an OQSE-compatible application.
 * Extends FeatureProfile with application-level capability fields.
 */
export const ManifestCapabilitiesSchema = FeatureProfileSchema.extend({
  /**
   * Supported OQSE actions (if present, at least one). Official action names or `x-`
   * vendor prefixes. Default: `["render"]`.
   */
  actions: z
    .array(OQSEActionSchema)
    .min(1, 'Application must support at least one action')
    .default(['render']),

  /**
   * Item types supported by this application (`['*']` for all). Absent, `null` or `[]`:
   * the application processes no items (e.g. a game without study sets).
   */
  types: wildcardOrExplicit(OQSEItemTypeSchema).optional(),

  /** Media asset categories and MIME types the application can handle. */
  assets: ManifestAssetsSchema.optional(),
});

// ============================================================================
// Root Manifest Schema
// ============================================================================

/**
 * Full OQSE Application Manifest schema (Table 2.1.1).
 *
 * Validated constraints beyond syntax:
 * - `minOqseVersion` <= `maxOqseVersion` when both are present
 * - `version` is an OQSEM 1.x version (MAJOR.MINOR)
 * - `capabilities` (default `{}`) and `capabilities.actions` (default `["render"]`) may be omitted
 */
export const OQSEManifestSchema = z
  .object({
    // Recommended schema URL: https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-manifest-v1.0.json
    $schema: AbsoluteURLSchema.optional(),
    // --- Identity ---

    /** Unique manifest identifier as absolute URL or URN UUID. */
    id: z.union([AbsoluteURLSchema, URNUUIDSchema]),

    /** Human-readable display name of the application. */
    appName: NonEmptyStringSchema.max(200, 'Name must not be longer than 200 characters'),

    /**
     * Version of the manifest format (OQSEM), MAJOR.MINOR. Not the version of the
     * application (`pluginVersion`) nor of the OQSE sets it reads.
     */
    version: SupportedManifestVersionSchema,

    pluginVersion: z.string().optional(),

    // --- OQSE Compatibility ---

    /** Minimum OQSE spec version this application can consume. */
    minOqseVersion: ManifestVersionSchema.optional(),

    /** Maximum OQSE spec version this application can consume. */
    maxOqseVersion: ManifestVersionSchema.optional(),

    // --- Capabilities ---

    /** Declares all features, item types, and media assets the app handles. */
    capabilities: ManifestCapabilitiesSchema.prefault({}),

    // --- Plugin / Embedding ---

    author: PersonObjectSchema.optional(),

    contributors: z.array(PersonObjectSchema).optional(),

    license: z.string().max(100, 'License must not be longer than 100 characters').optional(),

    licenseUrl: AbsoluteURLSchema.optional(),

    locales: z.array(BCP47Schema).optional(),

    /** Short human-readable description (Rich Content, <= 5000 chars). */
    description: z.string().max(5000, 'Description must not be longer than 5000 characters').optional(),

    emoji: z.string().optional(),

    /** Optional tags for discoverability in a plugin catalog. */
    tags: z.array(NonEmptyStringSchema).optional(),

    /** Preferred study mode for sets generated/consumed by this app. */
    studyMode: OQSEStudyModeSchema.optional(),

    /** Preferred question density for sessions run by this app. */
    questionDensity: OQSEQuestionDensitySchema.optional(),

    appSpecific: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      // Validate minOqseVersion <= maxOqseVersion when both are present
      if (!data.minOqseVersion || !data.maxOqseVersion) return true;

      const minParts = data.minOqseVersion.split('.');
      const maxParts = data.maxOqseVersion.split('.');
      const minMajor = Number(minParts[0]);
      const minMinor = Number(minParts[1]);
      const maxMajor = Number(maxParts[0]);
      const maxMinor = Number(maxParts[1]);

      if (minMajor !== maxMajor) return minMajor < maxMajor;
      return minMinor <= maxMinor;
    },
    {
      message: 'minOqseVersion must not be greater than maxOqseVersion',
      path: ['minOqseVersion'],
    }
  );

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validates an unknown value against `OQSEManifestSchema`.
 *
 * @param data - The value to validate (typically parsed JSON).
 * @returns The validated `OQSEManifest` object.
 * @throws {z.ZodError} when validation fails.
 *
 * @example
 * ```ts
 * const manifest = validateOQSEManifest(JSON.parse(rawJson));
 * manifest.capabilities.actions; // string[]
 * ```
 */
export function validateOQSEManifest(data: unknown): OQSEManifest {
  return OQSEManifestSchema.parse(data) as OQSEManifest;
}

/**
 * Safely validates an unknown value without throwing.
 *
 * @param data - The value to validate.
 * @returns A Zod `SafeParseReturnType` with `success` flag and either `data` or `error`.
 *
 * @example
 * ```ts
 * const result = safeValidateOQSEManifest(raw);
 * if (result.success) {
 *   console.log(result.data.id);
 * }
 * ```
 */
export function safeValidateOQSEManifest(
  data: unknown
): ReturnType<typeof OQSEManifestSchema.safeParse> {
  return OQSEManifestSchema.safeParse(data);
}

/**
 * Checks whether a plain object looks like an OQSE Manifest (duck-typing).
 *
 * This is a fast pre-check - use `validateOQSEManifest` for full validation.
 *
 * @param data - Any value.
 * @returns `true` if `data` has the minimum required shape.
 */
export function isValidOQSEManifest(data: unknown): data is OQSEManifest {
  return OQSEManifestSchema.safeParse(data).success;
}
