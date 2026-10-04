/**
 * OQSE v0.1 Zod Validation Schemas
 * 
 * Runtime validation schemas for OQSE (Open Quiz & Study Exchange) format.
 * Uses Zod for type-safe runtime validation with detailed error messages.
 * 
 * @see ../oqse.md
 * @see ./oqse.ts
 */

import { z } from 'zod';
import {
  OFFICIAL_FEATURE_KEYS,
  OFFICIAL_ITEM_PROPERTIES,
  OFFICIAL_META_PROPERTIES,
} from './manifest';
import { validateJsonDepth } from './utils';
import type { OQSEFile, OQSEItem } from './oqse';

// ============================================================================
// Reusable Primitives
// ============================================================================

/**
 * UUID validation (accepts UUIDv4 and UUIDv7)
 */
export const UUIDSchema = z.string().uuid({ message: 'Invalid UUID format' });

/**
 * BCP 47 language code (e.g., "en", "en-US", "cs", "zh-Hans")
 */
export const LanguageCodeSchema = z.string().min(2, 'Language code must have at least 2 characters').regex(
  /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/,
  'Invalid BCP 47 format (e.g. "cs", "en-US")'
);

/**
 * SPDX license identifier
 */
export const SPDXLicenseSchema = z.string().min(1, 'License identifier must not be empty');

/**
 * ISO 8601 date/time string (RFC 3339 subset)
 */
export const ISO8601DateTimeSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/,
  'Invalid ISO 8601 format (e.g. "2025-11-21T14:30:00Z")'
);

/**
 * Absolute URL validation
 */
export const AbsoluteURLSchema = z.string().url({ message: 'Must be a valid absolute URL' });

/**
 * Asset key validation (lowercase alphanumeric with _, -)
 */
export const AssetKeySchema = z.string().regex(
  /^[a-z0-9_-]+$/,
  'Asset key must contain only lowercase letters, numbers, hyphens and underscores'
);

/**
 * Plain text (non-empty string)
 */
export const PlainTextSchema = z.string().min(1, 'Text must not be empty');

/**
 * Rich content (Markdown, LaTeX, Media Tags)
 */
export const RichContentSchema = z.string().min(1, 'Content must not be empty');

/**
 * Optional rich content
 */
export const OptionalRichContentSchema = z.string().max(10000, 'Question must not be longer than 10000 characters').optional();

/**
 * Blank token identifier
 */
export const BlankTokenSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Token must be alphanumeric, max 64 chars');

// ============================================================================
// Media Types
// ============================================================================

/**
 * Subtitle track for audio/video
 */
export const SubtitleTrackSchema = z.object({
  lang: LanguageCodeSchema,
  value: z.string().min(1, 'Subtitle URI must not be empty').regex(/\.(vtt|srt)(\?.*)?$/i, 'Subtitle URI must end with .vtt or .srt'),
  label: z.string().optional(),
  kind: z.enum(['captions', 'subtitles', 'descriptions']).optional(),
});

/**
 * Media object
 */
export const MediaObjectSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'model']),
  value: z.string().min(1, 'Media URI must not be empty'),
  mimeType: z.string().optional(),
  altText: z.string().optional(),
  transcript: RichContentSchema.optional(),
  caption: RichContentSchema.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  start: z.number().nonnegative().optional(),
  end: z.number().positive().optional(),
  loop: z.boolean().optional(),
  subtitles: z.array(SubtitleTrackSchema).optional(),
  license: SPDXLicenseSchema.optional(),
  attribution: z.string().optional(),
  checksums: z.record(z.string(), z.string()).optional(),
}).refine(
  (data) => {
    // Validate start < end if both are present
    if (data.start !== undefined && data.end !== undefined) {
      return data.start < data.end;
    }
    return true;
  },
  {
    message: 'Start time must be less than end time',
    path: ['end'],
  }
).refine(
  (data) => {
    // Require altText for images (not required for audio/video/model)
    if (data.type === 'image' && !data.altText) {
      return false;
    }
    return true;
  },
  {
    message: 'Images must have alternative text (altText) defined for accessibility',
    path: ['altText'],
  }
);

/**
 * Asset dictionary
 */
export const AssetDictionarySchema = z.record(AssetKeySchema, MediaObjectSchema);

// ============================================================================
// Person Object
// ============================================================================

export const PersonObjectSchema = z.object({
  name: PlainTextSchema,
  role: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  url: AbsoluteURLSchema.optional(),
});

// ============================================================================
// Source Material
// ============================================================================

export const SourceMaterialTypeSchema = z.enum([
  'url',
  'doi',
  'isbn',
  'pdf',
  'textbook',
  'video',
  'audio',
  'image',
  'model',
  'other',
]);

export const SourceMaterialSchema = z.object({
  id: PlainTextSchema,
  type: SourceMaterialTypeSchema,
  value: PlainTextSchema,
  title: PlainTextSchema,
  description: z.string().optional(),
  authors: z.array(PlainTextSchema).optional(),
  publishedDate: ISO8601DateTimeSchema.optional(),
  retrievedAt: ISO8601DateTimeSchema.optional(),
  license: SPDXLicenseSchema.optional(),
}).refine(
  (data) => {
    // For URL-based types, value must be a valid URL
    const urlTypes = ['url', 'pdf', 'video', 'audio', 'image'];
    if (urlTypes.includes(data.type)) {
      try {
        new URL(data.value);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  },
  {
    message: 'For url, pdf, video, audio and image types, value must be a valid URL',
    path: ['value'],
  }
);

export const SourceReferenceSchema = z.object({
  id: PlainTextSchema,
  location: z.string().optional(),
  quote: RichContentSchema.optional(),
});

// ============================================================================
// Tag Definitions
// ============================================================================

export const TagDefinitionSchema = z.object({
  wikidataId: z.string().regex(/^Q\d+$/, 'Wikidata ID must have format Q followed by number').optional(),
  description: z.string().optional(),
});

export const TagDefinitionDictionarySchema = z.record(z.string(), TagDefinitionSchema);

// ============================================================================
// Feature Profile (shared between Manifest capabilities & meta.requirements)
// ============================================================================

/**
 * FeatureProfile declares which features, LaTeX packages, and item/meta
 * properties an application supports (Manifest) or a set requires (meta).
 * All arrays accept official values from the registry or custom `x-` prefixed keys.
 */
export const FeatureProfileSchema = z.object({
  features: z.array(z.string().refine(
    (v) => (OFFICIAL_FEATURE_KEYS as ReadonlyArray<string>).includes(v) || v.startsWith('x-'),
    { message: 'Feature must be an official key or have prefix "x-"' }
  )).optional(),
  latexPackages: z.array(z.string().min(1, 'Package name must not be empty')).optional(),
  itemProperties: z.array(z.string().refine(
    (v) => (OFFICIAL_ITEM_PROPERTIES as ReadonlyArray<string>).includes(v) || v.startsWith('x-'),
    { message: 'Item property must be an official key or have prefix "x-"' }
  )).optional(),
  metaProperties: z.array(z.string().refine(
    (v) => (OFFICIAL_META_PROPERTIES as ReadonlyArray<string>).includes(v) || v.startsWith('x-'),
    { message: 'Meta property must be an official key or have prefix "x-"' }
  )).optional(),
});

// ============================================================================
// Translation and Linked Sets
// ============================================================================

export const TranslationObjectSchema = z.object({
  lang: LanguageCodeSchema,
  id: UUIDSchema,
  title: PlainTextSchema,
  downloadUrl: AbsoluteURLSchema.optional(),
});

export const LinkedSetObjectSchema = z.object({
  id: UUIDSchema,
  title: PlainTextSchema,
  downloadUrl: AbsoluteURLSchema.optional(),
});

// ============================================================================
// Pedagogy Object
// ============================================================================

export const BloomLevelSchema = z.enum([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

export const CognitiveLoadSchema = z.enum(['low', 'medium', 'high']);

export const PedagogySchema = z.object({
  bloomLevel: BloomLevelSchema.optional(),
  irtDifficulty: z.number().optional(),
  irtDiscrimination: z.number().optional(),
  irtGuessing: z.number().min(0).max(1, 'IRT guessing must be between 0 and 1').optional(),
  avgTime: z.number().positive().optional(),
  cognitiveLoad: CognitiveLoadSchema.optional(),
  partialCredit: z.boolean().optional(),
  penaltyPerWrong: z.number().min(0).max(1, 'Penalty must be between 0 and 1').optional(),
});

// ============================================================================
// Meta Object
// ============================================================================

export const OQSEMetaSchema = z.object({
  id: UUIDSchema,
  language: LanguageCodeSchema,
  title: PlainTextSchema.max(500, 'Title must not be longer than 500 characters'),
  description: RichContentSchema.max(5000, 'Description must not be longer than 5000 characters').optional(),
  thumbnail: AssetKeySchema.optional(),
  assets: AssetDictionarySchema.optional(),
  ageMin: z.number().int().nonnegative().optional(),
  ageMax: z.number().int().nonnegative().optional(),
  subject: z.string().optional(),
  createdAt: ISO8601DateTimeSchema,
  updatedAt: ISO8601DateTimeSchema,
  author: PersonObjectSchema.optional(),
  contributors: z.array(PersonObjectSchema).optional(),
  license: SPDXLicenseSchema.optional(),
  licenseUrl: AbsoluteURLSchema.optional(),
  requirements: FeatureProfileSchema.optional(),
  tags: z.array(PlainTextSchema).optional(),
  tagDefinitions: TagDefinitionDictionarySchema.optional(),
  translations: z.array(TranslationObjectSchema).optional(),
  sourceMaterials: z.array(SourceMaterialSchema).optional(),
  estimatedTime: z.number().positive().optional(),
  prerequisites: z.array(LinkedSetObjectSchema).optional(),
  relatedSets: z.array(LinkedSetObjectSchema).optional(),
  customData: z.record(z.string(), z.unknown()).optional(),
  appSpecific: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (data) => {
    // Validate ageMin <= ageMax
    if (data.ageMin !== undefined && data.ageMax !== undefined) {
      return data.ageMin <= data.ageMax;
    }
    return true;
  },
  {
    message: 'Minimum age (ageMin) must be less than or equal to maximum age (ageMax)',
    path: ['ageMax'],
  }
).refine(
  (data) => {
    // Validate createdAt <= updatedAt
    const created = new Date(data.createdAt);
    const updated = new Date(data.updatedAt);
    return created <= updated;
  },
  {
    message: 'Creation date (createdAt) must be before or equal to update date (updatedAt)',
    path: ['updatedAt'],
  }
);

// ============================================================================
// Base Item Properties
// ============================================================================

export const BaseItemSchema = z.object({
  id: UUIDSchema,
  type: z.string(),
  assets: AssetDictionarySchema.optional(),
  lang: LanguageCodeSchema.optional(),
  tags: z.array(PlainTextSchema).optional(),
  topic: PlainTextSchema.optional(),
  difficulty: z.number().int().min(1, 'Difficulty must be at least 1').max(5, 'Difficulty must be at most 5').optional(),
  timeLimit: z.number().positive('Time limit must be a positive number').optional(),
  hints: z.array(RichContentSchema.max(2000, 'Hint must not be longer than 2000 characters')).max(20, 'Maximum 20 hints per item').optional(),
  explanation: RichContentSchema.max(10000, 'Explanation must not be longer than 10000 characters').optional(),
  incorrectFeedback: RichContentSchema.optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  relatedItems: z.array(UUIDSchema).optional(),
  dependencyItems: z.array(UUIDSchema).optional(),
  pedagogy: PedagogySchema.optional(),
  customData: z.record(z.string(), z.unknown()).optional(),
  appSpecific: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Helper Data Structures
// ============================================================================

/**
 * Select blank object for fill-in-select
 */
export const SelectBlankObjectSchema = z.object({
  options: z.array(RichContentSchema).min(1, 'Must have at least 1 option'),
  correctIndex: z.number().int().nonnegative(),
}).refine(
  (data) => data.correctIndex < data.options.length,
  {
    message: 'Correct answer index references non-existent option',
    path: ['correctIndex'],
  }
);

/**
 * Hotspot objects (Discriminated Union)
 */
export const RectHotspotSchema = z.object({
  type: z.literal('rect'),
  label: z.string().optional(),
  x: z.number().min(0).max(100, 'X must be in range 0-100%'),
  y: z.number().min(0).max(100, 'Y must be in range 0-100%'),
  width: z.number().min(0).max(100, 'Width must be in range 0-100%'),
  height: z.number().min(0).max(100, 'Height must be in range 0-100%'),
});

export const CircleHotspotSchema = z.object({
  type: z.literal('circle'),
  label: z.string().optional(),
  x: z.number().min(0).max(100, 'X must be in range 0-100%'),
  y: z.number().min(0).max(100, 'Y must be in range 0-100%'),
  radius: z.number().min(0).max(100, 'Radius must be in range 0-100%'),
});

export const PolygonHotspotSchema = z.object({
  type: z.literal('polygon'),
  label: z.string().optional(),
  points: z.array(
    z.object({
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
    })
  ).min(3, 'Polygon must have at least 3 points'),
});

/**
 * Mesh hotspot references a named node/mesh in a 3D glTF scene.
 * Used exclusively in `pin-on-model` items.
 */
export const MeshHotspotSchema = z.object({
  type: z.literal('mesh'),
  label: z.string().optional(),
  targetName: PlainTextSchema,
});

export const HotspotObjectSchema = z.discriminatedUnion('type', [
  RectHotspotSchema,
  CircleHotspotSchema,
  PolygonHotspotSchema,
  MeshHotspotSchema,
]);

export const Hotspot2DSchema = z.discriminatedUnion('type', [
  RectHotspotSchema,
  CircleHotspotSchema,
  PolygonHotspotSchema,
]);

/**
 * 3D vector / point (used by CameraSetup)
 */
export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * Recommended initial camera configuration for pin-on-model items
 */
export const CameraSetupSchema = z.object({
  position: Vector3Schema.optional(),
  target: Vector3Schema.optional(),
});

/**
 * Categorize item
 */
export const CategorizeItemObjectSchema = z.object({
  id: PlainTextSchema,
  text: RichContentSchema,
  correctCategoryIndex: z.number().int().nonnegative(),
});

/**
 * Timeline event
 */
export const TimelinePrecisionSchema = z.enum(['year', 'month', 'day', 'datetime']);

export const TimelineEventSchema = z.object({
  id: PlainTextSchema,
  text: RichContentSchema,
  date: ISO8601DateTimeSchema,
  precision: TimelinePrecisionSchema.optional(),
});

/**
 * Diagram zone (extended hotspot)
 */
export const DiagramZoneSchema = z.union([
  RectHotspotSchema.extend({ correctLabelIndex: z.number().int().nonnegative() }),
  CircleHotspotSchema.extend({ correctLabelIndex: z.number().int().nonnegative() }),
  PolygonHotspotSchema.extend({ correctLabelIndex: z.number().int().nonnegative() }),
]);

/**
 * Rubric for open-ended questions
 */
export const RubricCriterionSchema = z.object({
  label: PlainTextSchema,
  percentage: z.number().min(0, 'Percentage must be non-negative').max(100, 'Percentage must not exceed 100'),
  description: z.string().optional(),
});

export const RubricSchema = z.object({
  criteria: z.array(RubricCriterionSchema).min(1, 'Rubric must have at least 1 criterion'),
}).refine(
  (data) => {
    const sum = data.criteria.reduce((acc, c) => acc + c.percentage, 0);
    return sum > 0;
  },
  {
    message: 'Sum of percentages of all criteria must be greater than 0',
    path: ['criteria'],
  }
);

/**
 * Numeric range
 */
export const NumericRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
}).refine(
  (data) => data.min <= data.max,
  {
    message: 'Minimum value must be less than or equal to maximum value',
    path: ['max'],
  }
);

// ============================================================================
// Item Types (Discriminated Union)
// ============================================================================

/**
 * Note Item
 */
export const NoteItemSchema = BaseItemSchema.extend({
  type: z.literal('note'),
  title: z.string().optional(),
  content: RichContentSchema.max(10000, 'Content must not be longer than 10000 characters'),
  hiddenContent: RichContentSchema.max(10000, 'Content must not be longer than 10000 characters').optional(),
});

/**
 * Flashcard Item
 */
export const FlashcardItemSchema = BaseItemSchema.extend({
  type: z.literal('flashcard'),
  front: RichContentSchema.max(10000, 'Front side must not be longer than 10000 characters'),
  back: RichContentSchema.max(10000, 'Back side must not be longer than 10000 characters'),
});

/**
 * True/False Item
 */
export const TrueFalseItemSchema = BaseItemSchema.extend({
  type: z.literal('true-false'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  answer: z.boolean(),
});

/**
 * MCQ Single Item
 */
export const MCQSingleItemSchema = BaseItemSchema.extend({
  type: z.literal('mcq-single'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  options: z.array(RichContentSchema.max(2000, 'Option must not be longer than 2000 characters')).min(2, 'Question must have at least 2 options').max(100, 'Maximum 100 options'),
  correctIndex: z.number().int().nonnegative(),
  shuffleOptions: z.boolean().optional(),
  optionExplanations: z.array(z.union([RichContentSchema, z.null()])).optional(),
}).refine(
  (data) => data.correctIndex < data.options.length,
  {
    message: 'Correct answer index references non-existent option',
    path: ['correctIndex'],
  }
).refine(
  (data) => {
    if (data.optionExplanations) {
      return data.optionExplanations.length === data.options.length;
    }
    return true;
  },
  {
    message: 'Number of option explanations must match number of options',
    path: ['optionExplanations'],
  }
).refine(
  (data) => {
    const uniqueOptions = new Set(data.options.map(opt => opt.toLowerCase()));
    return uniqueOptions.size === data.options.length;
  },
  { message: 'Options must not contain duplicates (case-insensitive)', path: ['options'] }
);

/**
 * MCQ Multi Item
 */
export const MCQMultiItemSchema = BaseItemSchema.extend({
  type: z.literal('mcq-multi'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  options: z.array(RichContentSchema.max(2000, 'Option must not be longer than 2000 characters')).min(2, 'Question must have at least 2 options').max(100, 'Maximum 100 options'),
  correctIndices: z.array(z.number().int().nonnegative()).min(1, 'Must have at least 1 correct answer'),
  minSelections: z.number().int().positive().optional(),
  maxSelections: z.number().int().positive().optional(),
  shuffleOptions: z.boolean().optional(),
  optionExplanations: z.array(z.union([RichContentSchema, z.null()])).optional(),
}).refine(
  (data) => {
    // All correctIndices must be valid
    return data.correctIndices.every(idx => idx < data.options.length);
  },
  {
    message: 'Some of correct answer indices reference non-existent option',
    path: ['correctIndices'],
  }
).refine(
  (data) => {
    // No duplicate indices
    const unique = new Set(data.correctIndices);
    return unique.size === data.correctIndices.length;
  },
  {
    message: 'Correct answer indices contain duplicates',
    path: ['correctIndices'],
  }
).refine(
  (data) => {
    if (data.minSelections && data.maxSelections) {
      return data.minSelections <= data.maxSelections;
    }
    return true;
  },
  {
    message: 'Minimum number of selections must be less than or equal to maximum',
    path: ['maxSelections'],
  }
).refine(
  (data) => {
    if (data.maxSelections) {
      return data.maxSelections <= data.options.length;
    }
    return true;
  },
  {
    message: 'Maximum number of selections must not exceed number of options',
    path: ['maxSelections'],
  }
).refine(
  (data) => {
    if (data.minSelections) {
      return data.minSelections <= data.options.length;
    }
    return true;
  },
  {
    message: 'minSelections cannot be greater than the number of options',
    path: ['minSelections'],
  }
).refine(
  (data) => {
    if (data.optionExplanations) {
      return data.optionExplanations.length === data.options.length;
    }
    return true;
  },
  {
    message: 'Number of option explanations must match number of options',
    path: ['optionExplanations'],
  }
).refine(
  (data) => {
    const uniqueOptions = new Set(data.options.map(opt => opt.toLowerCase()));
    return uniqueOptions.size === data.options.length;
  },
  { message: 'Options must not contain duplicates (case-insensitive)', path: ['options'] }
);

/**
 * Short Answer Item
 */
export const ShortAnswerItemSchema = BaseItemSchema.extend({
  type: z.literal('short-answer'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  answers: z.array(PlainTextSchema).min(1, 'Must have at least 1 correct answer'),
  caseSensitive: z.boolean().optional(),
  trimWhitespace: z.boolean().optional(),
  acceptPartial: z.boolean().optional(),
  ignoreDiacritics: z.boolean().optional(),
});

/**
 * Fill in Blanks Item
 */
export const FillInBlanksItemSchema = BaseItemSchema.extend({
  type: z.literal('fill-in-blanks'),
  question: OptionalRichContentSchema,
  text: RichContentSchema.max(10000, 'Text must not be longer than 10000 characters'),
  blanks: z.record(BlankTokenSchema, z.array(PlainTextSchema).min(1, 'Each blank must have at least 1 correct answer')),
  caseSensitive: z.boolean().optional(),
  trimWhitespace: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data.blanks).length > 0,
  {
    message: 'Text must contain at least 1 blank to fill',
    path: ['blanks'],
  }
).refine(
  (data) => {
    // Validate that all blank tokens in text exist in blanks object
    const tokenRegex = /<blank:([a-zA-Z0-9_-]{1,64})\s*\/>/g;
    const tokensInText = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(data.text)) !== null) {
      if (match[1]) {
        tokensInText.add(match[1]);
      }
    }
    
    const tokensInBlanks = new Set(Object.keys(data.blanks));
    
    // Check if all tokens in text have definitions
    for (const token of tokensInText) {
      if (!tokensInBlanks.has(token)) {
        return false;
      }
    }
    
    // Check if all defined blanks are used in text
    for (const token of tokensInBlanks) {
      if (!tokensInText.has(token)) {
        return false;
      }
    }
    
    return true;
  },
  {
    message: 'All tokens in text must have definition in blanks and all definitions must be used in text',
    path: ['blanks'],
  }
);

/**
 * Fill in Select Item
 */
export const FillInSelectItemSchema = BaseItemSchema.extend({
  type: z.literal('fill-in-select'),
  question: OptionalRichContentSchema,
  text: RichContentSchema.max(10000, 'Text must not be longer than 10000 characters'),
  blanks: z.record(BlankTokenSchema, SelectBlankObjectSchema),
}).refine(
  (data) => Object.keys(data.blanks).length > 0,
  {
    message: 'Text must contain at least 1 blank to select',
    path: ['blanks'],
  }
).refine(
  (data) => {
    // Validate that all blank tokens in text exist in blanks object
    const tokenRegex = /<blank:([a-zA-Z0-9_-]{1,64})\s*\/>/g;
    const tokensInText = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(data.text)) !== null) {
      if (match[1]) {
        tokensInText.add(match[1]);
      }
    }
    
    const tokensInBlanks = new Set(Object.keys(data.blanks));
    
    for (const token of tokensInText) {
      if (!tokensInBlanks.has(token)) {
        return false;
      }
    }
    
    for (const token of tokensInBlanks) {
      if (!tokensInText.has(token)) {
        return false;
      }
    }
    
    return true;
  },
  {
    message: 'All tokens in text must have definition in blanks and all definitions must be used in text',
    path: ['blanks'],
  }
);

/**
 * Match Pairs Item
 */
export const MatchPairsItemSchema = BaseItemSchema.extend({
  type: z.literal('match-pairs'),
  question: OptionalRichContentSchema,
  prompts: z.array(RichContentSchema).min(2, 'Must have at least 2 pairs to match').max(100, 'Maximum 100 pairs'),
  matches: z.array(RichContentSchema).min(2, 'Must have at least 2 pairs to match').max(100, 'Maximum 100 pairs'),
}).refine(
  (data) => data.prompts.length === data.matches.length,
  {
    message: 'Number of prompts must match number of matches',
    path: ['matches'],
  }
);

/**
 * Match Complex Item
 */
export const MatchComplexItemSchema = BaseItemSchema.extend({
  type: z.literal('match-complex'),
  question: OptionalRichContentSchema,
  leftItems: z.array(RichContentSchema).min(1, 'Must have at least 1 item on left'),
  rightItems: z.array(RichContentSchema).min(1, 'Must have at least 1 item on right'),
  connections: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1, 'Must have at least 1 connection'),
  minCorrect: z.number().int().positive().optional(),
}).refine(
  (data) => {
    // Validate all connection indices
    return data.connections.every(([left, right]) => 
      left < data.leftItems.length && right < data.rightItems.length
    );
  },
  {
    message: 'Some connection references non-existent item',
    path: ['connections'],
  }
).refine(
  (data) => {
    // Check for duplicate connections
    const connectionSet = new Set(data.connections.map(c => `${c[0]}-${c[1]}`));
    return connectionSet.size === data.connections.length;
  },
  {
    message: 'Connections contain duplicates',
    path: ['connections'],
  }
).refine(
  (data) => {
    if (data.minCorrect) {
      return data.minCorrect <= data.connections.length;
    }
    return true;
  },
  {
    message: 'Minimum correct answers must not exceed total number of connections',
    path: ['minCorrect'],
  }
);

/**
 * Sort Items Item
 */
export const SortItemsItemSchema = BaseItemSchema.extend({
  type: z.literal('sort-items'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  items: z.array(RichContentSchema).min(2, 'Must have at least 2 items to sort'),
});

/**
 * Slider Item
 */
export const SliderItemSchema = BaseItemSchema.extend({
  type: z.literal('slider'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  min: z.number(),
  max: z.number(),
  step: z.number().positive('Step must be a positive number'),
  correctAnswer: z.number(),
  tolerance: z.number().nonnegative('Tolerance must be non-negative'),
  unit: z.string().optional(),
}).refine(
  (data) => data.min < data.max,
  {
    message: 'Minimum value must be less than maximum value',
    path: ['max'],
  }
).refine(
  (data) => data.correctAnswer >= data.min && data.correctAnswer <= data.max,
  {
    message: 'Correct answer must be in range min-max',
    path: ['correctAnswer'],
  }
).refine(
  (data) => {
    // Check if correctAnswer is reachable by step
    const steps = (data.correctAnswer - data.min) / data.step;
    return Math.abs(steps - Math.round(steps)) < 0.0001;
  },
  {
    message: 'Correct answer must be reachable by defined step',
    path: ['correctAnswer'],
  }
).refine(
  (data) => data.tolerance <= (data.max - data.min) / 2,
  {
    message: 'Tolerance must not be greater than half of value range',
    path: ['tolerance'],
  }
);

/**
 * Pin on Image Item
 */
export const PinOnImageItemSchema = BaseItemSchema.extend({
  type: z.literal('pin-on-image'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  targetAsset: AssetKeySchema,
  hotspots: z.array(Hotspot2DSchema).min(1, 'Must have at least 1 hotspot'),
  multipleCorrect: z.boolean().optional(),
  minCorrect: z.number().int().positive().optional(),
}).refine(
  (data) => {
    if (data.minCorrect) {
      return data.minCorrect <= data.hotspots.length;
    }
    return true;
  },
  {
    message: 'Minimum correct answers must not exceed number of hotspots',
    path: ['minCorrect'],
  }
);

/**
 * Categorize Item
 */
export const CategorizeItemSchema = BaseItemSchema.extend({
  type: z.literal('categorize'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  categories: z.array(PlainTextSchema).min(2, 'Must have at least 2 categories'),
  items: z.array(CategorizeItemObjectSchema).min(1, 'Must have at least 1 item to categorize'),
}).refine(
  (data) => {
    const uniqueCategories = new Set(data.categories.map(cat => cat.toLowerCase()));
    return uniqueCategories.size === data.categories.length;
  },
  { message: 'Categories must not contain duplicates (case-insensitive)', path: ['categories'] }
).refine(
  (data) => {
    // Validate all correctCategoryIndex values
    return data.items.every(item => item.correctCategoryIndex < data.categories.length);
  },
  {
    message: 'Some item references non-existent category',
    path: ['items'],
  }
);

/**
 * Timeline Item
 */
export const TimelineItemSchema = BaseItemSchema.extend({
  type: z.literal('timeline'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  events: z.array(TimelineEventSchema).min(2, 'Must have at least 2 events'),
  randomize: z.boolean().optional(),
});

/**
 * Matrix Item
 */
export const MatrixItemSchema = BaseItemSchema.extend({
  type: z.literal('matrix'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  rows: z.array(PlainTextSchema).min(1, 'Must have at least 1 row'),
  columns: z.array(PlainTextSchema).min(1, 'Must have at least 1 column'),
  correctCells: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1, 'Must have at least 1 correct cell'),
  multiplePerRow: z.boolean().optional(),
}).refine(
  (data) => {
    // Validate all cell coordinates
    return data.correctCells.every(([row, col]) => 
      row < data.rows.length && col < data.columns.length
    );
  },
  {
    message: 'Some cell coordinates reference non-existent row or column',
    path: ['correctCells'],
  }
).refine(
  (data) => {
    // Check for duplicate cells
    const cellSet = new Set(data.correctCells.map(c => `${c[0]}-${c[1]}`));
    return cellSet.size === data.correctCells.length;
  },
  {
    message: 'Correct cells contain duplicates',
    path: ['correctCells'],
  }
).refine(
  (data) => {
    if (!data.multiplePerRow) {
      // Check that each row has at most one correct cell
      const rowCounts = new Map<number, number>();
      for (const [row] of data.correctCells) {
        rowCounts.set(row, (rowCounts.get(row) || 0) + 1);
      }
      return Array.from(rowCounts.values()).every(count => count <= 1);
    }
    return true;
  },
  {
    message: 'If multiplePerRow is false, each row may have maximum 1 correct cell',
    path: ['correctCells'],
  }
);

/**
 * Math Input Item
 */
export const MathInputItemSchema = BaseItemSchema.extend({
  type: z.literal('math-input'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  correctAnswer: PlainTextSchema,
  alternativeAnswers: z.array(PlainTextSchema).optional(),
  tolerance: z.number().nonnegative().optional(),
});

/**
 * Diagram Label Item
 */
export const DiagramLabelItemSchema = BaseItemSchema.extend({
  type: z.literal('diagram-label'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  targetAsset: AssetKeySchema,
  labels: z.array(RichContentSchema).min(1, 'Must have at least 1 label'),
  caseSensitive: z.boolean().optional(),
  requireTyping: z.boolean().optional(),
  zones: z.array(DiagramZoneSchema).min(1, 'Must have at least 1 zone'),
}).refine(
  (data) => {
    // Validate all correctLabelIndex values
    return data.zones.every(zone => zone.correctLabelIndex < data.labels.length);
  },
  {
    message: 'Some zone references non-existent label',
    path: ['zones'],
  }
);

/**
 * Open Ended Item
 */
export const OpenEndedItemSchema = BaseItemSchema.extend({
  type: z.literal('open-ended'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  minWords: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  sampleAnswer: RichContentSchema.optional(),
  rubric: RubricSchema.optional(),
}).refine(
  (data) => {
    if (data.minWords && data.maxWords) {
      return data.minWords <= data.maxWords;
    }
    return true;
  },
  {
    message: 'Minimum word count must be less than or equal to maximum',
    path: ['maxWords'],
  }
);

/**
 * Numeric Input Item
 */
export const NumericInputItemSchema = BaseItemSchema.extend({
  type: z.literal('numeric-input'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  value: z.number(),
  tolerance: z.number().nonnegative().optional(),
  range: NumericRangeSchema.optional(),
  unit: z.string().optional(),
});

/**
 * Pin on 3D Model Item
 *
 * User locates and clicks a named mesh in a glTF scene.
 */
export const PinOnModelItemSchema = BaseItemSchema.extend({
  type: z.literal('pin-on-model'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  targetAsset: AssetKeySchema,
  hotspots: z.array(MeshHotspotSchema).min(1, 'Must have at least 1 hotspot'),
  multipleCorrect: z.boolean().optional(),
  minCorrect: z.number().int().positive().optional(),
  camera: CameraSetupSchema.optional(),
}).refine(
  (data) => {
    if (data.minCorrect) {
      return data.minCorrect <= data.hotspots.length;
    }
    return true;
  },
  {
    message: 'Minimum correct answers must not exceed number of hotspots',
    path: ['minCorrect'],
  }
);

/**
 * Chess Puzzle Item
 *
 * User finds the correct move sequence on a given board position.
 */
export const ChessPuzzleItemSchema = BaseItemSchema.extend({
  type: z.literal('chess-puzzle'),
  question: RichContentSchema.max(10000, 'Question must not be longer than 10000 characters'),
  fen: PlainTextSchema,
  answers: z
    .array(
      z.array(PlainTextSchema).min(1, 'Move sequence must not be empty')
    )
    .min(1, 'Must have at least 1 correct move sequence'),
  elo: z.number().int().nonnegative('ELO must be non-negative integer').optional(),
});

// ============================================================================
// OQSE Item (Discriminated Union)
// ============================================================================

/**
 * OQSE Item Schema (Discriminated Union)
 * 
 * This uses Zod's discriminatedUnion for optimal performance and type inference.
 */
export const OQSEItemSchema = z.discriminatedUnion('type', [
  NoteItemSchema,
  FlashcardItemSchema,
  TrueFalseItemSchema,
  MCQSingleItemSchema,
  MCQMultiItemSchema,
  ShortAnswerItemSchema,
  FillInBlanksItemSchema,
  FillInSelectItemSchema,
  MatchPairsItemSchema,
  MatchComplexItemSchema,
  SortItemsItemSchema,
  SliderItemSchema,
  PinOnImageItemSchema,
  CategorizeItemSchema,
  TimelineItemSchema,
  MatrixItemSchema,
  MathInputItemSchema,
  DiagramLabelItemSchema,
  OpenEndedItemSchema,
  NumericInputItemSchema,
  PinOnModelItemSchema,
  ChessPuzzleItemSchema,
]);

// ============================================================================
// OQSE File (Root Structure)
// ============================================================================

/**
 * OQSE File Schema (Root Structure)
 */
export const OQSEFileSchema = z.object({
  // Recommended schema URL for draft v0.1: https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-v0.1.json
  $schema: z.string().url().optional(),
  version: z.string().regex(/^\d+\.\d+$/, 'Version must be in MAJOR.MINOR format (e.g. "0.1")'),
  meta: OQSEMetaSchema,
  items: z.array(OQSEItemSchema).max(10000, 'Maximum 10000 items per set'),
}).refine(
  (data) => {
    // Validate that all relatedItems and dependencyItems exist
    const itemIds = new Set(data.items.map(item => item.id));
    
    for (const item of data.items) {
      if (item.relatedItems) {
        for (const relatedId of item.relatedItems) {
          if (!itemIds.has(relatedId) || item.id === relatedId) {
            return false;
          }
        }
      }
      
      if (item.dependencyItems) {
        for (const depId of item.dependencyItems) {
          if (!itemIds.has(depId) || item.id === depId) {
            return false;
          }
        }
      }
    }
    
    return true;
  },
  {
    message: 'Some item references non-existent relatedItems, dependencyItems, or references itself',
    path: ['items'],
  }
).refine(
  (data) => {
    // Validate that thumbnail asset exists
    if (data.meta.thumbnail && data.meta.assets) {
      return data.meta.thumbnail in data.meta.assets;
    }
    return true;
  },
  {
    message: 'Thumbnail references non-existent asset',
    path: ['meta', 'thumbnail'],
  }
).refine(
  (data) => {
    // Validate that all source references exist
    const sourceMaterialIds = new Set(
      (data.meta.sourceMaterials || []).map(s => s.id)
    );
    
    for (const item of data.items) {
      if (item.sources) {
        for (const sourceRef of item.sources) {
          if (!sourceMaterialIds.has(sourceRef.id)) {
            return false;
          }
        }
      }
    }
    
    return true;
  },
  {
    message: 'Some item references non-existent source material',
    path: ['items'],
  }
);

// ============================================================================
// Validation Helper Functions
// ============================================================================

function createSecurityZodError(error: unknown): z.ZodError {
  const message =
    error instanceof Error
      ? error.message
      : 'OQSE Security Error: Maximum nesting depth exceeded limit of 10 levels.';

  return new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      message,
      path: [],
    },
  ]);
}

/**
 * Validates OQSE file and returns parsed result or throws ZodError
 */
export function validateOQSEFile(data: unknown): OQSEFile {
  validateJsonDepth(data, 10);
  return OQSEFileSchema.parse(data);
}

/**
 * Safely validates OQSE file and returns result object
 */
export function safeValidateOQSEFile(data: unknown): {
  success: boolean;
  data?: OQSEFile;
  error?: z.ZodError;
} {
  try {
    validateJsonDepth(data, 10);
  } catch (error) {
    return { success: false, error: createSecurityZodError(error) };
  }

  const result = OQSEFileSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validates individual OQSE item
 */
export function validateOQSEItem(data: unknown): OQSEItem {
  validateJsonDepth(data, 10);
  return OQSEItemSchema.parse(data);
}

/**
 * Safely validates individual OQSE item
 */
export function safeValidateOQSEItem(data: unknown): {
  success: boolean;
  data?: OQSEItem;
  error?: z.ZodError;
} {
  try {
    validateJsonDepth(data, 10);
  } catch (error) {
    return { success: false, error: createSecurityZodError(error) };
  }

  const result = OQSEItemSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

