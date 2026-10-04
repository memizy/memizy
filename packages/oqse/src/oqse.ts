/**
 * OQSE v0.1 Type Definitions
 * (Open Quiz & Study Exchange)
 * 
 * Type-safe TypeScript definitions for the OQSE specification.
 * Uses Discriminated Unions to make invalid states unrepresentable.
 * 
 * @see ../oqse.md
 */

// ============================================================================
// BCP 47 Language Code
// ============================================================================

/**
 * BCP 47 language code (e.g., "en", "en-US", "cs", "zh-Hans")
 */
export type LanguageCode = string;

// ============================================================================
// SPDX License Identifier
// ============================================================================

/**
 * SPDX license identifier (e.g., "CC-BY-SA-4.0", "CC0-1.0")
 * @see https://spdx.org/licenses/
 */
export type SPDXLicense = string;

// ============================================================================
// ISO 8601 Date/Time (RFC 3339 subset)
// ============================================================================

/**
 * ISO 8601 date/time string in RFC 3339 format.
 * Examples: "2025-11-21", "2025-11-21T14:30:00Z", "2025-11-21T15:30:00+01:00"
 */
export type ISO8601DateTime = string;

// ============================================================================
// Media Types
// ============================================================================

/**
 * Media object type
 */
export type MediaType = 'image' | 'audio' | 'video' | 'model';

/**
 * Media object for embedding media in items or set metadata.
 * Used in `meta.assets` and `item.assets`.
 */
export interface MediaObject {
  /** Media type */
  type: MediaType;
  
  /** 
   * URI of the resource.
   * Can be absolute URL (https://...) or relative path in package (assets/...)
   */
  value: string;
  
  /** MIME type (e.g., "image/png", "audio/mpeg", "video/mp4") */
  mimeType?: string;
  
  /** 
   * Alternative text for accessibility.
   * REQUIRED for images, optional for audio/video.
   * MUST be plain text without formatting.
   */
  altText?: string;
  
  /** 
   * Verbatim transcript of spoken word (for audio/video).
   * Rich Content (Markdown, LaTeX).
   */
  transcript?: string;
  
  /** 
   * Media caption displayed below/next to media.
   * Rich Content (Markdown, LaTeX).
   */
  caption?: string;
  
  /** Preferred width in pixels (rendering hint) */
  width?: number;
  
  /** Preferred height in pixels (rendering hint) */
  height?: number;
  
  /** Time in seconds where media playback should start (for audio/video) */
  start?: number;
  
  /** Time in seconds where media playback should end (for audio/video) */
  end?: number;
  
  /** Whether media should loop (for audio/video). Default: false */
  loop?: boolean;
  
  /** Subtitles for audio/video */
  subtitles?: SubtitleTrack[];
  
  /** SPDX license for this specific media (if different from set) */
  license?: SPDXLicense;
  
  /** Media author/source attribution (e.g., "Photo: NASA") */
  attribution?: string;
  
  /** 
   * File integrity checksums.
   * Key is algorithm name ("sha256", "sha512", "md5"), value is hex hash.
   */
  checksums?: Record<string, string>;
}

/**
 * Subtitle track for audio/video media
 */
export interface SubtitleTrack {
  /** Language code (BCP 47) */
  lang: LanguageCode;
  
  /** URI to .vtt or .srt file (absolute URL or relative path) */
  value: string;
  
  /** Display name (e.g., "Czech", "English") */
  label?: string;
  
  /** Subtitle type per WebVTT specification. Default: "subtitles" */
  kind?: 'captions' | 'subtitles' | 'descriptions';
}

/**
 * Dictionary of media objects.
 * Key is lowercase alphanumeric identifier (a-z, 0-9, _, -)
 */
export type AssetDictionary = Record<string, MediaObject>;

// ============================================================================
// Person Object
// ============================================================================

/**
 * Person object for identifying authors and contributors
 */
export interface PersonObject {
  /** Full name of the person */
  name: string;
  
  /** Role in the project (e.g., "Editor", "Translator", "Biology Expert") */
  role?: string;
  
  /** Contact email */
  email?: string;
  
  /** Link to website or author profile */
  url?: string;
}

// ============================================================================
// Source Material
// ============================================================================

/**
 * Source material type
 */
export type SourceMaterialType = 
  | 'url' 
  | 'doi' 
  | 'isbn' 
  | 'pdf' 
  | 'textbook' 
  | 'video' 
  | 'audio' 
  | 'image' 
  | 'model'
  | 'other';

/**
 * Source material object describing sources from which the set draws
 */
export interface SourceMaterial {
  /** 
   * Unique ID within the file (not global UUID).
   * Can be alphanumeric string (e.g., "src-1", "book-physics")
   */
  id: string;
  
  /** Source type */
  type: SourceMaterialType;
  
  /** 
   * Source value.
   * For 'url', 'pdf', 'video', 'audio', 'image': absolute URL
   * For 'doi', 'isbn', 'textbook', 'other': identifier string
   */
  value: string;
  
  /** Source title */
  title: string;
  
  /** Additional source description */
  description?: string;
  
  /** Source authors */
  authors?: string[];
  
  /** Source publication date (ISO 8601) */
  publishedDate?: ISO8601DateTime;
  
  /** Date when the source was used (ISO 8601) */
  retrievedAt?: ISO8601DateTime;
  
  /** License of the original source (SPDX ID) */
  license?: SPDXLicense;
}

/**
 * Reference to a source material from an item
 */
export interface SourceReference {
  /** ID of source defined in meta.sourceMaterials */
  id: string;
  
  /** Specification of place in source (e.g., "page 42", "time 12:30") */
  location?: string;
  
  /** 
   * Exact citation or text segment from source.
   * Rich Content (Markdown, LaTeX).
   */
  quote?: string;
}

// ============================================================================
// Tag Definitions
// ============================================================================

/**
 * Tag definition for semantic linking
 */
export interface TagDefinition {
  /** "Q" identifier from Wikidata for semantic linking */
  wikidataId?: string;
  
  /** More detailed tag description */
  description?: string;
}

/**
 * Dictionary of tag definitions.
 * Key is the tag string, value is TagDefinition.
 */
export type TagDefinitionDictionary = Record<string, TagDefinition>;

// ============================================================================
// Feature Requirements
// ============================================================================

// ============================================================================
// Feature Profile (shared between Manifest capabilities and meta.requirements)
// ============================================================================

/**
 * FeatureProfile is a base structure shared between:
 * - Application Manifest `capabilities` object (§2.1.2)
 * - Study Set `meta.requirements` object (§3)
 *
 * It declares which features, LaTeX packages, and item/meta properties
 * an application supports (in Manifest) or requires (in Study Set).
 *
 * @see ../oqse.md#feature-profile--official-registry
 */
export interface FeatureProfile {
  /**
   * Array of feature flags from the Official Feature Registry or `x-` prefixed extensions.
   * Example: `["math", "markdown", "x-memizy-3d-voxel"]`
   */
  features?: string[];

  /**
   * Array of supported/required LaTeX packages.
   * Only meaningful when `features` includes `"math"`.
   * Example: `["mhchem", "amsmath"]`
   */
  latexPackages?: string[];

  /**
   * Array of item-level properties supported/required.
   * Example: `["hints", "explanation", "sources"]`
   */
  itemProperties?: string[];

  /**
   * Array of set-level metadata properties supported/required.
   * Example: `["license", "contributors", "tags"]`
   */
  metaProperties?: string[];
}

// ============================================================================
// Translation and Linked Sets
// ============================================================================

/**
 * Translation object defining reference to translated version of this set
 */
export interface TranslationObject {
  /** Language code (BCP 47) of translated set */
  lang: LanguageCode;
  
  /** Unique UUID (meta.id) of translated set */
  id: string;
  
  /** Name of translated set */
  title: string;
  
  /** Link to download translated set */
  downloadUrl?: string;
}

/**
 * Linked set object for prerequisites and related sets
 */
export interface LinkedSetObject {
  /** UUID of OQSE set being referenced */
  id: string;
  
  /** Name of referenced set */
  title: string;
  
  /** Absolute address for downloading set */
  downloadUrl?: string;
}

// ============================================================================
// Pedagogy Object
// ============================================================================

/**
 * Bloom's taxonomy level (revised)
 */
export type BloomLevel = 
  | 'remember' 
  | 'understand' 
  | 'apply' 
  | 'analyze' 
  | 'evaluate' 
  | 'create';

/**
 * Cognitive load level
 */
export type CognitiveLoad = 'low' | 'medium' | 'high';

/**
 * Pedagogy object for advanced data for adaptive learning and psychometrics
 */
export interface Pedagogy {
  /** Level according to revised Bloom's taxonomy */
  bloomLevel?: BloomLevel;
  
  /** IRT Parameter b (Difficulty). Typically range -3.0 to +3.0 */
  irtDifficulty?: number;
  
  /** IRT Parameter a (Discrimination) */
  irtDiscrimination?: number;
  
  /** IRT Parameter c (Pseudo-guessing). Probability of guessing answer by chance */
  irtGuessing?: number;
  
  /** Average time (in seconds) students actually need to solve */
  avgTime?: number;
  
  /** Subjective cognitive load */
  cognitiveLoad?: CognitiveLoad;
  
  /** Whether item supports partial scoring */
  partialCredit?: boolean;
  
  /** Penalty for each wrong choice (0.0 - 1.0) */
  penaltyPerWrong?: number;
}

// ============================================================================
// Meta Object
// ============================================================================

/**
 * Metadata describing the entire set
 */
export interface OQSEMeta {
  /** Unique UUID of the set */
  id: string;
  
  /** Language code of the set (BCP 47) */
  language: LanguageCode;
  
  /** Title of the study set (Plain Text) */
  title: string;
  
  /** Short description of the set (Rich Content) */
  description?: string;
  
  /** Key from meta.assets that defines the cover image */
  thumbnail?: string;
  
  /** Dictionary of media for the entire set */
  assets?: AssetDictionary;
  
  /** Minimum recommended age (0 = preschool, recommended >= 3) */
  ageMin?: number;
  
  /** Maximum recommended age */
  ageMax?: number;
  
  /** Subject/field (e.g., "mathematics", "biology", "history") */
  subject?: string;
  
  /** Date and time of creation (ISO 8601) */
  createdAt: ISO8601DateTime;
  
  /** Date and time of last modification (ISO 8601) */
  updatedAt: ISO8601DateTime;
  
  /** Information about the main author of the set */
  author?: PersonObject;
  
  /** Array of information about other contributors */
  contributors?: PersonObject[];
  
  /** SPDX license identifier */
  license?: SPDXLicense;
  
  /** Link to the full text of the license */
  licenseUrl?: string;
  
  /**
   * A FeatureProfile object describing set's explicit requirements.
   * Declares which features, LaTeX packages, and item/meta properties are required.
   * Note: Required item types and assets are implicit and MUST NOT be listed here.
   *
   * @see FeatureProfile
   */
  requirements?: FeatureProfile;

  /** Array of text labels (tags) for the entire set */
  tags?: string[];
  
  /** Dictionary of tag definitions */
  tagDefinitions?: TagDefinitionDictionary;
  
  /** Array of references to translations of this set */
  translations?: TranslationObject[];
  
  /** Array of objects describing sources from which the set draws */
  sourceMaterials?: SourceMaterial[];
  
  /** Estimated time to complete the set in minutes */
  estimatedTime?: number;
  
  /** Array of references to sets that should be completed before this set */
  prerequisites?: LinkedSetObject[];
  
  /** Array of references to related OQSE sets */
  relatedSets?: LinkedSetObject[];
  
  /** Object for metadata determined by the author/creator */
  customData?: Record<string, unknown>;
  
  /** Object for metadata specific to a particular software application */
  appSpecific?: Record<string, unknown>;
}

// ============================================================================
// Common Item Properties
// ============================================================================

/**
 * Base properties shared by all item types
 */
export interface BaseItem {
  /** Unique UUID of the item */
  id: string;
  
  /** Item type (discriminator for union) */
  type: string;
  
  /** Dictionary of media for this item */
  assets?: AssetDictionary;
  
  /** Language code (BCP 47) for this specific item. Overrides meta.language */
  lang?: LanguageCode;
  
  /** Array of text labels (tags) for this item */
  tags?: string[];

  /** Primary category, chapter, or lecture name for this item */
  topic?: string;
  
  /** Numeric difficulty from 1 (easy) to 5 (hard) */
  difficulty?: number;
  
  /** Recommended time limit in seconds for answering this item */
  timeLimit?: number;
  
  /** Array of hints (Rich Content) */
  hints?: string[];
  
  /** Explanation of the correct answer (Rich Content) */
  explanation?: string;
  
  /** 
   * Message displayed after an incorrect answer (Rich Content).
   * Guidance without revealing the solution.
   */
  incorrectFeedback?: string;
  
  /** Array of references to sources related to this item */
  sources?: SourceReference[];
  
  /** Array of IDs of related items in this set */
  relatedItems?: string[];
  
  /** Array of IDs of items that should logically precede this item */
  dependencyItems?: string[];
  
  /** Advanced data for adaptive learning and psychometrics */
  pedagogy?: Pedagogy;
  
  /** Field for static creator metadata */
  customData?: Record<string, unknown>;
  
  /** Field for application-specific static metadata */
  appSpecific?: Record<string, unknown>;
}

// ============================================================================
// Helper Data Structures
// ============================================================================

/**
 * Select blank object for fill-in-select items
 */
export interface SelectBlankObject {
  /** Array of text options to choose from (Rich Content) */
  options: string[];
  
  /** Index of correct answer in options array (0-based) */
  correctIndex: number;
}

/**
 * Hotspot shape type.
 * `rect`, `circle`, `polygon` are for 2D image hotspots (pin-on-image).
 * `mesh` is for 3D model mesh selection (pin-on-model).
 */
export type HotspotShape = 'rect' | 'circle' | 'polygon' | 'mesh';

/**
 * Base hotspot properties
 */
interface BaseHotspot {
  /** Zone shape */
  type: HotspotShape;
  
  /** Zone label (Plain Text) */
  label?: string;
}

/**
 * Rectangle hotspot
 */
export interface RectHotspot extends BaseHotspot {
  type: 'rect';
  
  /** Percent X from left edge (0-100) */
  x: number;
  
  /** Percent Y from top edge (0-100) */
  y: number;
  
  /** Width in percentages (0-100) */
  width: number;
  
  /** Height in percentages (0-100) */
  height: number;
}

/**
 * Circle hotspot
 */
export interface CircleHotspot extends BaseHotspot {
  type: 'circle';
  
  /** Center X in percentages (0-100) */
  x: number;
  
  /** Center Y in percentages (0-100) */
  y: number;
  
  /** Radius in percentages (0-100) */
  radius: number;
}

/**
 * Polygon hotspot
 */
export interface PolygonHotspot extends BaseHotspot {
  type: 'polygon';
  
  /** Array of points defining shape */
  points: Array<{ x: number; y: number }>;
}

/**
 * Mesh hotspot for 3D model items (`pin-on-model`).
 * Identifies a named mesh/object in a glTF scene by its node name.
 * Coordinates are not used; selection is by object identity in the 3D scene.
 */
export interface MeshHotspot extends BaseHotspot {
  type: 'mesh';
  
  /**
   * Name (or partial name) of the object/mesh in the 3D scene.
   * Corresponds to the glTF node name in the `.glb` / `.gltf` file.
   * Example: `"Femur"`, `"spine_L3"`
   */
  targetName: string;
}

/**
 * Hotspot object (Discriminated Union).
 * Use `RectHotspot | CircleHotspot | PolygonHotspot` for 2D image hotspots.
 * Use `MeshHotspot` for 3D model mesh selection.
 */
export type HotspotObject = RectHotspot | CircleHotspot | PolygonHotspot | MeshHotspot;

/**
 * 2D hotspots for image-based interactions.
 */
export type Hotspot2D = RectHotspot | CircleHotspot | PolygonHotspot;

// ============================================================================
// 3D / Spatial Helper Structures
// ============================================================================

/**
 * A 3D point or vector with X, Y, Z coordinates.
 * Used for camera setup in `pin-on-model` items.
 */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Recommended initial camera configuration for `pin-on-model` items.
 * If omitted, the application SHOULD auto-fit the model in view.
 */
export interface CameraSetup {
  /** Camera position in 3D world space */
  position?: Vector3;
  
  /** The point the camera is looking at and orbiting around */
  target?: Vector3;
}

/**
 * Categorize item
 */
export interface CategorizeItem {
  /** 
   * Unique ID within question (not global UUID).
   * Can be alphanumeric string.
   */
  id: string;
  
  /** Item text (Rich Content) */
  text: string;
  
  /** 0-based index into categories array in parent item */
  correctCategoryIndex: number;
}

/**
 * Timeline event precision
 */
export type TimelinePrecision = 'year' | 'month' | 'day' | 'datetime';

/**
 * Timeline event
 */
export interface TimelineEvent {
  /** 
   * Unique ID within question (not global UUID).
   * Can be alphanumeric string.
   */
  id: string;
  
  /** Event description (Rich Content) */
  text: string;
  
  /** 
   * Event date in ISO 8601 format.
   * MUST always contain full date, even if precision is only year or month.
   */
  date: ISO8601DateTime;
  
  /** Determines display format to user. Default: use full precision from date */
  precision?: TimelinePrecision;
}

/**
 * Diagram label zone (extended hotspot with correctLabelIndex)
 */
export type DiagramZone = (RectHotspot | CircleHotspot | PolygonHotspot) & {
  /** Index of correct label from labels array (0-based) */
  correctLabelIndex: number;
};

/**
 * Rubric criterion for open-ended questions
 */
export interface RubricCriterion {
  /** Criterion name (e.g., "Grammar", "Argumentation") */
  label: string;
  
  /** Criterion weight in percentages (0-100) */
  percentage: number;
  
  /** Description of what is evaluated in this criterion */
  description?: string;
}

/**
 * Rubric for open-ended questions
 */
export interface Rubric {
  /** Array of criteria */
  criteria: RubricCriterion[];
}

/**
 * Range object for numeric-input
 */
export interface NumericRange {
  /** Minimum value (inclusive) */
  min: number;
  
  /** Maximum value (inclusive) */
  max: number;
}

// ============================================================================
// Item Types (Discriminated Unions)
// ============================================================================

/**
 * Note item (Study Note)
 */
export interface NoteItem extends BaseItem {
  type: 'note';
  
  /** Note heading (Plain Text) */
  title?: string;
  
  /** Main educational content (Rich Content) */
  content: string;

  /** Additional content that is initially hidden (Rich Content) */
  hiddenContent?: string;
}

/**
 * Flashcard item
 */
export interface FlashcardItem extends BaseItem {
  type: 'flashcard';
  
  /** Text on front side (Rich Content) */
  front: string;
  
  /** Text on back side (Rich Content) */
  back: string;
}

/**
 * True/False item
 */
export interface TrueFalseItem extends BaseItem {
  type: 'true-false';
  
  /** Statement to be evaluated (Rich Content) */
  question: string;
  
  /** Correct answer */
  answer: boolean;
}

/**
 * Multiple Choice Question - Single Choice
 */
export interface MCQSingleItem extends BaseItem {
  type: 'mcq-single';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Array of text options (Rich Content). Min 2 items. */
  options: string[];
  
  /** Index (0-based) of correct answer in options array */
  correctIndex: number;
  
  /** Whether application should shuffle options. Default: true */
  shuffleOptions?: boolean;
  
  /** 
   * Array of explanations specific to each option (Rich Content).
   * Index corresponds to index in options array.
   * Use null for options without specific explanation.
   */
  optionExplanations?: Array<string | null>;
}

/**
 * Multiple Choice Question - Multiple Choice
 */
export interface MCQMultiItem extends BaseItem {
  type: 'mcq-multi';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Array of text options (Rich Content). Min 2 items. */
  options: string[];
  
  /** Array of indices of correct answers. Min 1 index. */
  correctIndices: number[];
  
  /** Minimum number of answers user must select */
  minSelections?: number;
  
  /** Maximum number of answers user can select */
  maxSelections?: number;
  
  /** Whether application should shuffle options. Default: true */
  shuffleOptions?: boolean;
  
  /** 
   * Array of explanations specific to each option (Rich Content).
   * Index corresponds to index in options array.
   * Use null for options without specific explanation.
   */
  optionExplanations?: Array<string | null>;
}

/**
 * Short Text Answer
 */
export interface ShortAnswerItem extends BaseItem {
  type: 'short-answer';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Array of acceptable text answers (Plain Text). Min 1 item. */
  answers: string[];
  
  /** Distinguish letter case. Default: false */
  caseSensitive?: boolean;
  
  /** Ignore spaces at beginning/end. Default: true */
  trimWhitespace?: boolean;
  
  /** Accept approximate match (fuzzy matching). Default: false */
  acceptPartial?: boolean;
  
  /** 
   * Remove diacritics before comparison.
   * Default: false
   */
  ignoreDiacritics?: boolean;
}

/**
 * Fill in the Blanks
 */
export interface FillInBlanksItem extends BaseItem {
  type: 'fill-in-blanks';
  
  /** Heading or instructions (Rich Content) */
  question?: string;
  
  /** 
   * Text with blanks marked using blank tags <blank:token />.
   * Rich Content (Markdown, LaTeX, Media Tags).
   */
  text: string;
  
  /** 
   * Dictionary where key is token and value is array of correct answers (Plain Text).
   * Min 1 token.
   */
  blanks: Record<string, string[]>;
  
  /** Distinguish letter case when checking answers. Default: false */
  caseSensitive?: boolean;
  
  /** Ignore spaces at beginning and end of answer. Default: true */
  trimWhitespace?: boolean;
}

/**
 * Fill in with Selection
 */
export interface FillInSelectItem extends BaseItem {
  type: 'fill-in-select';
  
  /** Heading or instructions (Rich Content) */
  question?: string;
  
  /** 
   * Text with blanks marked using blank tags <blank:token />.
   * Rich Content (Markdown, LaTeX, Media Tags).
   */
  text: string;
  
  /** 
   * Dictionary where key is token and value is SelectBlankObject.
   * Min 1 token.
   */
  blanks: Record<string, SelectBlankObject>;
}

/**
 * Match Pairs
 */
export interface MatchPairsItem extends BaseItem {
  type: 'match-pairs';
  
  /** Instructions (Rich Content) */
  question?: string;
  
  /** Left side (what is being matched) - array of strings (Rich Content). Min 2 items. */
  prompts: string[];
  
  /** 
   * Right side (target) - array of strings (Rich Content).
   * Must have same length as prompts. Min 2 items.
   * prompts[0] belongs to matches[0], etc.
   */
  matches: string[];
}

/**
 * Advanced Matching
 */
export interface MatchComplexItem extends BaseItem {
  type: 'match-complex';
  
  /** Instructions (Rich Content) */
  question?: string;
  
  /** Items on left side (Rich Content). Min 1 item. */
  leftItems: string[];
  
  /** Items on right side (Rich Content). Min 1 item. */
  rightItems: string[];
  
  /** 
   * Array of index pairs [left_index, right_index] defining correct pairs.
   * Min 1 connection.
   */
  connections: Array<[number, number]>;
  
  /** Minimum number of correct connections required for success */
  minCorrect?: number;
}

/**
 * Sorting
 */
export interface SortItemsItem extends BaseItem {
  type: 'sort-items';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** 
   * Array of items in correct order (Rich Content).
   * Min 2 items. Application must shuffle them.
   */
  items: string[];
}

/**
 * Slider / Numeric Answer
 */
export interface SliderItem extends BaseItem {
  type: 'slider';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Minimum value on slider */
  min: number;
  
  /** Maximum value on slider */
  max: number;
  
  /** Slider step (e.g., 1, 0.1). Must be > 0 */
  step: number;
  
  /** Correct value. Must be reachable by slider. */
  correctAnswer: number;
  
  /** Allowed deviation (can be 0) */
  tolerance: number;
  
  /** Unit (e.g., "year", "m", "°C") (Plain Text) */
  unit?: string;
}

/**
 * Pin on Image
 */
export interface PinOnImageItem extends BaseItem {
  type: 'pin-on-image';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** Key from assets, which determines the image to be clicked on */
  targetAsset: string;
  
  /** Array defining correct areas. Min 1 hotspot. */
  hotspots: Hotspot2D[];
  
  /** Whether user must mark more than one hotspot. Default: false */
  multipleCorrect?: boolean;
  
  /** 
   * If multipleCorrect: true, determines minimum number of correct hotspots.
   * Ignored if multipleCorrect: false
   */
  minCorrect?: number;
}

/**
 * Categorization
 */
export interface CategorizeItemType extends BaseItem {
  type: 'categorize';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** Array of category names (Plain Text). Min 2 items. */
  categories: string[];
  
  /** Items to sort. Min 1 item. */
  items: CategorizeItem[];
}

/**
 * Timeline
 */
export interface TimelineItem extends BaseItem {
  type: 'timeline';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** Array of events in correct chronological order. Min 2 events. */
  events: TimelineEvent[];
  
  /** Whether application should shuffle events. Default: true */
  randomize?: boolean;
}

/**
 * Matrix / Table Answer
 */
export interface MatrixItem extends BaseItem {
  type: 'matrix';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** Row labels (Plain Text). Min 1 item. */
  rows: string[];
  
  /** Column labels (Plain Text). Min 1 item. */
  columns: string[];
  
  /** 
   * Array of coordinates of correct answers in format [row, column].
   * Indices are 0-based. Min 1 cell.
   */
  correctCells: Array<[number, number]>;
  
  /** Can user select multiple answers in one row? Default: false */
  multiplePerRow?: boolean;
}

/**
 * Math Input
 */
export interface MathInputItem extends BaseItem {
  type: 'math-input';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Correct answer in LaTeX format (e.g., "$2x + 2$") */
  correctAnswer: string;
  
  /** Array of other text strings that should also be considered correct */
  alternativeAnswers?: string[];
  
  /** For purely numeric answers, allowed numeric deviation */
  tolerance?: number;
}

/**
 * Diagram Labeling
 */
export interface DiagramLabelItem extends BaseItem {
  type: 'diagram-label';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /** Key from assets, which determines the diagram image */
  targetAsset: string;
  
  /** 
   * Array of text labels for user to assign (Rich Content).
   * Must contain all correct answers and may contain distractors.
   */
  labels: string[];
  
  /** Distinguish letter case when comparing labels. Default: false */
  caseSensitive?: boolean;
  
  /** 
   * If true, application MUST render text fields instead of draggable labels.
   * Default: false
   */
  requireTyping?: boolean;
  
  /** Array of zones on image. Min 1 zone. */
  zones: DiagramZone[];
}

/**
 * Open-Ended Answer
 */
export interface OpenEndedItem extends BaseItem {
  type: 'open-ended';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Minimum required word count */
  minWords?: number;
  
  /** Maximum allowed word count */
  maxWords?: number;
  
  /** Sample (model) answer for evaluators (Rich Content) */
  sampleAnswer?: string;
  
  /** Structured evaluation criteria */
  rubric?: Rubric;
}

/**
 * Numeric Input
 */
export interface NumericInputItem extends BaseItem {
  type: 'numeric-input';
  
  /** Question text (Rich Content) */
  question: string;
  
  /** Correct numeric value (float) */
  value: number;
  
  /** Absolute allowed deviation. Default: 0 */
  tolerance?: number;
  
  /** 
   * Alternative to value+tolerance.
   * If specified, takes precedence over value.
   */
  range?: NumericRange;
  
  /** Unit displayed after input field (Plain Text) */
  unit?: string;
}

/**
 * Pin on 3D Model
 *
 * The user must locate and click on a specific named part (mesh) of a 3D model.
 * Requires the `capabilities.assets.model` to be declared in the application manifest.
 *
 * @see §6.21
 */
export interface PinOnModelItem extends BaseItem {
  type: 'pin-on-model';
  
  /** Instructions (Rich Content) */
  question: string;
  
  /**
   * Key from `assets` dictionary pointing to the 3D model.
   * The referenced asset MUST have `type: "model"` and use glTF/GLB format.
   * Example key: `"model_lower_limb"`
   */
  targetAsset: string;
  
  /**
   * Array of correct mesh hotspots. At least 1 hotspot is required.
   * For 3D models, use `MeshHotspot` (`type: "mesh"`).
   */
  hotspots: MeshHotspot[];
  
  /**
   * Whether the user must find more than one target mesh.
   * Default: `false`
   */
  multipleCorrect?: boolean;
  
  /**
   * Minimum number of correct meshes the user must find.
   * Only applies when `multipleCorrect: true`.
   */
  minCorrect?: number;
  
  /**
   * Recommended initial camera setup.
   * If omitted, the application SHOULD auto-fit the entire model in view.
   */
  camera?: CameraSetup;
}

/**
 * Chess Puzzle
 *
 * An interactive chess puzzle where the user finds the correct move sequence
 * on a given board position. Applications SHOULD render an interactive chessboard.
 *
 * @see §6.22
 */
export interface ChessPuzzleItem extends BaseItem {
  type: 'chess-puzzle';
  
  /**
   * Instructions or puzzle description (Rich Content).
   * Example: `"White to move and checkmate in 2."`
   */
  question: string;
  
  /**
   * Board position in Forsyth–Edwards Notation (FEN).
   * Example: `"r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"`
   */
  fen: string;
  
  /**
   * Array of valid solution move sequences.
   * Each sequence is an array of moves in Standard Algebraic Notation (SAN).
   * Multiple sequences allow declaring alternative correct solutions.
   * Example: `[["Ng5"]]` or `[["e4", "e5"]]`
   */
  answers: string[][];
  
  /**
   * ELO difficulty rating of the puzzle.
   * Optional. Allows adaptive selection of puzzles by difficulty.
   */
  elo?: number;
}

// ============================================================================
// OQSE Item (Discriminated Union of all item types)
// ============================================================================

/**
 * OQSE Item (Discriminated Union)
 * 
 * This is the power of TypeScript's Discriminated Unions:
 * TypeScript will narrow the type based on the `type` field,
 * making invalid states unrepresentable.
 */
export type OQSEItem =
  | NoteItem
  | FlashcardItem
  | TrueFalseItem
  | MCQSingleItem
  | MCQMultiItem
  | ShortAnswerItem
  | FillInBlanksItem
  | FillInSelectItem
  | MatchPairsItem
  | MatchComplexItem
  | SortItemsItem
  | SliderItem
  | PinOnImageItem
  | PinOnModelItem
  | CategorizeItemType
  | TimelineItem
  | MatrixItem
  | MathInputItem
  | DiagramLabelItem
  | OpenEndedItem
  | NumericInputItem
  | ChessPuzzleItem;

// ============================================================================
// OQSE File (Root Structure)
// ============================================================================

/**
 * OQSE File (Root Structure)
 * 
 * This is the top-level structure of an OQSE file.
 */
export interface OQSEFile {
  /** URL reference to the JSON Schema specification */
  $schema?: string;
  
  /** Version of the OQSE specification (e.g., "0.1") */
  version: string;
  
  /** Metadata about the entire set */
  meta: OQSEMeta;
  
  /** Array containing individual study items */
  items: OQSEItem[];
}

// ============================================================================
// Type Guards (Runtime Type Checking)
// ============================================================================

/**
 * Type guard for NoteItem
 */
export function isNote(item: OQSEItem): item is NoteItem {
  return item.type === 'note';
}

/**
 * Type guard for FlashcardItem
 */
export function isFlashcard(item: OQSEItem): item is FlashcardItem {
  return item.type === 'flashcard';
}

/**
 * Type guard for TrueFalseItem
 */
export function isTrueFalse(item: OQSEItem): item is TrueFalseItem {
  return item.type === 'true-false';
}

/**
 * Type guard for MCQSingleItem
 */
export function isMCQSingle(item: OQSEItem): item is MCQSingleItem {
  return item.type === 'mcq-single';
}

/**
 * Type guard for MCQMultiItem
 */
export function isMCQMulti(item: OQSEItem): item is MCQMultiItem {
  return item.type === 'mcq-multi';
}

/**
 * Type guard for ShortAnswerItem
 */
export function isShortAnswer(item: OQSEItem): item is ShortAnswerItem {
  return item.type === 'short-answer';
}

/**
 * Type guard for FillInBlanksItem
 */
export function isFillInBlanks(item: OQSEItem): item is FillInBlanksItem {
  return item.type === 'fill-in-blanks';
}

/**
 * Type guard for FillInSelectItem
 */
export function isFillInSelect(item: OQSEItem): item is FillInSelectItem {
  return item.type === 'fill-in-select';
}

/**
 * Type guard for MatchPairsItem
 */
export function isMatchPairs(item: OQSEItem): item is MatchPairsItem {
  return item.type === 'match-pairs';
}

/**
 * Type guard for MatchComplexItem
 */
export function isMatchComplex(item: OQSEItem): item is MatchComplexItem {
  return item.type === 'match-complex';
}

/**
 * Type guard for SortItemsItem
 */
export function isSortItems(item: OQSEItem): item is SortItemsItem {
  return item.type === 'sort-items';
}

/**
 * Type guard for SliderItem
 */
export function isSlider(item: OQSEItem): item is SliderItem {
  return item.type === 'slider';
}

/**
 * Type guard for PinOnImageItem
 */
export function isPinOnImage(item: OQSEItem): item is PinOnImageItem {
  return item.type === 'pin-on-image';
}

/**
 * Type guard for CategorizeItemType
 */
export function isCategorize(item: OQSEItem): item is CategorizeItemType {
  return item.type === 'categorize';
}

/**
 * Type guard for TimelineItem
 */
export function isTimeline(item: OQSEItem): item is TimelineItem {
  return item.type === 'timeline';
}

/**
 * Type guard for MatrixItem
 */
export function isMatrix(item: OQSEItem): item is MatrixItem {
  return item.type === 'matrix';
}

/**
 * Type guard for MathInputItem
 */
export function isMathInput(item: OQSEItem): item is MathInputItem {
  return item.type === 'math-input';
}

/**
 * Type guard for DiagramLabelItem
 */
export function isDiagramLabel(item: OQSEItem): item is DiagramLabelItem {
  return item.type === 'diagram-label';
}

/**
 * Type guard for OpenEndedItem
 */
export function isOpenEnded(item: OQSEItem): item is OpenEndedItem {
  return item.type === 'open-ended';
}

/**
 * Type guard for NumericInputItem
 */
export function isNumericInput(item: OQSEItem): item is NumericInputItem {
  return item.type === 'numeric-input';
}

/**
 * Type guard for PinOnModelItem
 */
export function isPinOnModel(item: OQSEItem): item is PinOnModelItem {
  return item.type === 'pin-on-model';
}

/**
 * Type guard for ChessPuzzleItem
 */
export function isChessPuzzle(item: OQSEItem): item is ChessPuzzleItem {
  return item.type === 'chess-puzzle';
}

// ============================================================================
// Core Item Types (for Conformity Levels)
// ============================================================================

/**
 * Core Item Types (Level 1: Core Consumer)
 * 
 * These are the absolute minimum types that every implementation must support.
 */
export type CoreItemType = 'note' | 'flashcard' | 'mcq-single' | 'short-answer';

/**
 * Extended Item Types
 * 
 * All other types beyond the core.
 */
export type ExtendedItemType = Exclude<OQSEItem['type'], CoreItemType>;

/**
 * Type guard for Core Item
 */
export function isCoreItem(item: OQSEItem): boolean {
  return ['note', 'flashcard', 'mcq-single', 'short-answer'].includes(item.type);
}

/**
 * Type guard for Extended Item
 */
export function isExtendedItem(item: OQSEItem): boolean {
  return !isCoreItem(item);
}

