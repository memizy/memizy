/**
 * Whole-file validation of OQSE sets.
 *
 * Two entry points implement the two sides of the specification:
 *
 * - {@link loadOQSEFile} – tolerant import ("Best Effort", see Error Handling Policy).
 *   Invalid items are skipped, recoverable problems become warnings, and the
 *   returned set is safe to hand to a renderer or plugin.
 * - {@link validateOQSEFile} / {@link safeValidateOQSEFile} – strict validation for
 *   saving and exporting. Every rule violation is an error and nothing is modified.
 *
 * Unknown keys are always preserved (forward compatibility). Unknown values of open
 * fields are warnings (`UNKNOWN_VALUE`); items of unknown types are kept unchanged in
 * `unsupportedItems`, so that an editor can write them back.
 */

import type { z } from 'zod';
import type { MediaObject, OQSEAnyItem, OQSEFile, OQSEMeta } from './oqse';
import { OQSEMetaSchema, SourceMaterialSchema, UnknownTypeItemSchema, getItemSchema } from './oqseValidation';
import { BLOOM_LEVELS, COGNITIVE_LOADS, MEDIA_TYPES, OFFICIAL_ITEM_TYPES, SOURCE_KINDS, SUBTITLE_KINDS } from './oqse';
import { OFFICIAL_FEATURE_KEYS, OFFICIAL_ITEM_PROPERTIES, OFFICIAL_META_PROPERTIES } from './manifest';
import { findAssetKeys, findRawHtml } from './richTextProcessor';
import { formatPath, validateJsonDepth } from './utils';
import { resolveAsset } from './assets';
import { findHeadings, splitLines } from './markdownUtils';
import { itemRichText, metaRichText } from './richTextFields';
import { detectFeatures, looksLikeLatex } from './features';

// ============================================================================
// Issues
// ============================================================================

export type OQSEIssueSeverity = 'error' | 'warning';

export type OQSEIssueCode =
  | 'INVALID_ROOT'
  | 'INVALID_VERSION'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_META'
  | 'TOO_MANY_ITEMS'
  | 'INVALID_ITEM'
  | 'UNKNOWN_ITEM_TYPE'
  | 'UNKNOWN_VALUE'
  | 'INVALID_SOURCE'
  | 'LEGACY_SOURCE'
  | 'SOURCE_WITHOUT_LOCATOR'
  | 'DUPLICATE_ID'
  | 'DANGLING_REFERENCE'
  | 'MISSING_ASSET'
  | 'MISSING_TARGET_ASSET'
  | 'INVALID_TARGET_ASSET'
  | 'MISSING_THUMBNAIL_ASSET'
  | 'ASSET_KEY_NORMALIZED'
  | 'ASSET_KEY_COLLISION'
  | 'ASSET_SHADOWED'
  | 'RAW_HTML_NOT_ALLOWED'
  | 'NOTE_HEADING_LEVEL'
  | 'CHESS_SEQUENCE_LENGTH'
  | 'UNKNOWN_FEATURE'
  | 'MISSING_ALT_TEXT'
  | 'INVALID_IMAGE_URL'
  | 'BLANK_OUTSIDE_TEXT'
  | 'UNDECLARED_FEATURE'
  | 'LOOKS_LIKE_LATEX'
  | 'SECURITY_LIMIT';

/** One entry of the structured error log (see "Structured Error Log" in the specification). */
export interface OQSEIssue {
  severity: OQSEIssueSeverity;
  code: OQSEIssueCode;
  message: string;
  /** Path in the file, e.g. `items[5].type`. Empty for the root. */
  path: string;
  /** ID of the affected item, when the issue belongs to an item. */
  itemId?: string;
}

/**
 * An item of a type this library does not know (from a later 1.x version), unchanged.
 * Applications skip it when rendering; an editor that saves the set writes it back
 * (see {@link withUnsupportedItems}).
 */
export interface UnsupportedItem {
  /** Position in the original `items` array. */
  index: number;
  item: Record<string, unknown>;
}

export interface OQSELoadResult {
  /** `false` only for critical errors (the set cannot be loaded at all). */
  success: boolean;
  /** The loaded set: only valid items of known types, recoverable problems removed. Present when `success`. */
  data?: OQSEFile;
  /** Items of types this library does not know, unchanged (not in `data.items`). */
  unsupportedItems: UnsupportedItem[];
  /** Critical errors and item-level errors (each skipped item has at least one). */
  errors: OQSEIssue[];
  warnings: OQSEIssue[];
}

export interface OQSEValidationResult {
  /** `true` when the set is fully compliant (no errors). */
  success: boolean;
  /** The set with the items of known types (see `unsupportedItems`). */
  data?: OQSEFile;
  /** Items of types this library does not know: a warning, not an error; they stay in the file. */
  unsupportedItems: UnsupportedItem[];
  errors: OQSEIssue[];
  warnings: OQSEIssue[];
}

/** Error thrown by {@link validateOQSEFile}. */
export class OQSEValidationError extends Error {
  readonly errors: OQSEIssue[];
  readonly warnings: OQSEIssue[];

  constructor(errors: OQSEIssue[], warnings: OQSEIssue[]) {
    super(`Invalid OQSE file:\n${formatOQSEIssues(errors).join('\n')}`);
    this.name = 'OQSEValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

/** Formats issues as readable lines (`path: message`). */
export function formatOQSEIssues(issues: OQSEIssue[]): string[] {
  return issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message));
}

/** OQSE MAJOR version supported by this library. */
export const SUPPORTED_OQSE_MAJOR_VERSION = 1;

/**
 * The OQSE version this library writes. It reads 1.x; a higher MAJOR is loaded in
 * best-effort mode with a warning, pre-release 0.x sets are refused (no conversion).
 */
export const OQSE_VERSION = '1.0';

// ============================================================================
// Public API
// ============================================================================

/**
 * Tolerant import of an OQSE set (Best Effort).
 *
 * - Critical errors (invalid root, `version` or `meta`, a pre-release 0.x set) → `success: false`.
 * - Invalid items, unknown item types, duplicate IDs, missing target assets and
 *   raw HTML without the `html` feature → the item is skipped (error).
 * - Dangling references, a missing thumbnail, images without `altText` and uppercase
 *   asset keys → fixed in the returned copy (warning). The input is never mutated.
 */
export function loadOQSEFile(data: unknown): OQSELoadResult {
  return analyze(data, 'load');
}

/**
 * Strict validation for saving / exporting. Every rule violation is an error.
 */
export function safeValidateOQSEFile(data: unknown): OQSEValidationResult {
  const result = analyze(data, 'strict');
  const success = result.success && result.errors.length === 0;
  return { success, data: success ? result.data : undefined, unsupportedItems: result.unsupportedItems, errors: result.errors, warnings: result.warnings };
}

/**
 * The set to save: `file` with the items of unknown types put back at their original
 * positions (an application never deletes items it does not understand). Returns plain
 * JSON data, because those items are not typed.
 */
export function withUnsupportedItems(file: OQSEFile, unsupportedItems: UnsupportedItem[]): Record<string, unknown> {
  const items: unknown[] = [...file.items];
  for (const { index, item } of [...unsupportedItems].sort((a, b) => a.index - b.index)) {
    items.splice(Math.min(index, items.length), 0, structuredClone(item));
  }
  return { ...file, items };
}

/**
 * Strict validation for saving / exporting.
 * @throws {OQSEValidationError} when the set is not fully compliant.
 */
export function validateOQSEFile(data: unknown): OQSEFile {
  const result = safeValidateOQSEFile(data);
  if (!result.success) throw new OQSEValidationError(result.errors, result.warnings);
  return result.data!;
}

// ============================================================================
// Implementation
// ============================================================================

type Mode = 'load' | 'strict';
type Path = (string | number)[];

const OFFICIAL_TYPES = new Set<string>(OFFICIAL_ITEM_TYPES);

class IssueLog {
  readonly errors: OQSEIssue[] = [];
  readonly warnings: OQSEIssue[] = [];

  add(severity: OQSEIssueSeverity, code: OQSEIssueCode, message: string, path: Path, itemId?: string) {
    const issue: OQSEIssue = { severity, code, message, path: formatPath(path) };
    if (itemId) issue.itemId = itemId;
    (severity === 'error' ? this.errors : this.warnings).push(issue);
  }

  addZod(error: z.ZodError, code: OQSEIssueCode, basePath: Path, itemId?: string) {
    for (const issue of error.issues) {
      this.add('error', code, issue.message, [...basePath, ...(issue.path as Path)], itemId);
    }
  }
}

function analyze(input: unknown, mode: Mode): OQSELoadResult {
  const log = new IssueLog();
  const unsupportedItems: UnsupportedItem[] = [];
  const critical = (): OQSELoadResult => ({ success: false, unsupportedItems, errors: log.errors, warnings: log.warnings });
  // In strict mode recoverable problems are errors; in load mode they are warnings and get fixed.
  const recoverable: OQSEIssueSeverity = mode === 'strict' ? 'error' : 'warning';

  // --- Root ------------------------------------------------------------------
  try {
    validateJsonDepth(input, 10);
  } catch (e) {
    log.add('error', 'SECURITY_LIMIT', (e as Error).message, []);
    return critical();
  }
  if (!isRecord(input) || !isRecord(input.meta) || !Array.isArray(input.items)) {
    log.add('error', 'INVALID_ROOT', 'An OQSE file must be an object with "version", "meta" and "items" (array).', []);
    return critical();
  }
  const root = structuredClone(input) as Record<string, unknown> & { meta: Record<string, unknown>; items: unknown[] };

  if (root.$schema !== undefined && typeof root.$schema !== 'string') {
    log.add('error', 'INVALID_ROOT', '"$schema" must be a string URL.', ['$schema']);
    return critical();
  }
  if (typeof root.version !== 'string' || !/^\d+\.\d+$/.test(root.version)) {
    log.add('error', 'INVALID_VERSION', `Version must be in MAJOR.MINOR format (e.g. "${OQSE_VERSION}").`, ['version']);
    return critical();
  }
  const major = Number(root.version.split('.')[0]);
  if (major === 0) {
    // Pre-release drafts: their fields mean other things, so they must not be read as 1.x.
    log.add('error', 'UNSUPPORTED_VERSION', `OQSE ${root.version} is a pre-release version; this library reads OQSE ${SUPPORTED_OQSE_MAJOR_VERSION}.x (convert the set to ${OQSE_VERSION}).`, ['version']);
    return critical();
  }
  if (major !== SUPPORTED_OQSE_MAJOR_VERSION) {
    log.add('warning', 'UNSUPPORTED_VERSION', `Unsupported MAJOR version ${root.version}; loading in best-effort mode.`, ['version']);
  }
  if (root.items.length > 10000) {
    log.add('error', 'TOO_MANY_ITEMS', 'Maximum 10000 items per set.', ['items']);
    return critical();
  }

  // --- Meta ------------------------------------------------------------------
  if (mode === 'load' && !normalizeAssetKeys(root.meta, ['meta', 'assets'], log)) return critical();
  // Sources one by one: a bad source never makes the whole set unreadable.
  checkSources(root.meta, log, mode, recoverable);
  const metaResult = OQSEMetaSchema.safeParse(root.meta);
  if (!metaResult.success) {
    log.addZod(metaResult.error, 'INVALID_META', ['meta']);
    return critical();
  }
  const meta = metaResult.data as OQSEMeta;
  // Values from a newer 1.x version (or typos): ignored, with a warning.
  const known: Record<'features' | 'itemProperties' | 'metaProperties', readonly string[]> = {
    features: OFFICIAL_FEATURE_KEYS,
    itemProperties: OFFICIAL_ITEM_PROPERTIES,
    metaProperties: OFFICIAL_META_PROPERTIES,
  };
  for (const [field, official] of Object.entries(known) as [keyof typeof known, readonly string[]][]) {
    for (const value of meta.requirements?.[field] ?? []) {
      if (!value.startsWith('x-') && !official.includes(value)) {
        log.add('warning', 'UNKNOWN_FEATURE', `Unknown ${field === 'features' ? 'feature' : 'property'} "${value}" in requirements.${field} (ignored).`, ['meta', 'requirements', field]);
      }
    }
  }
  const features = new Set(meta.requirements?.features ?? []);
  const htmlAllowed = features.has('html');
  const latex = features.has('latex');

  checkAltTexts(meta.assets, ['meta', 'assets'], log, mode);
  if (meta.thumbnail && !meta.assets?.[meta.thumbnail]) {
    log.add(recoverable, 'MISSING_THUMBNAIL_ASSET', `Thumbnail references non-existent asset "${meta.thumbnail}".`, ['meta', 'thumbnail']);
    if (mode === 'load') delete meta.thumbnail;
  }
  for (const [path, text] of metaRichText(meta)) {
    const tag = htmlAllowed ? null : findRawHtml(text, { latex });
    if (tag) {
      log.add(recoverable, 'RAW_HTML_NOT_ALLOWED', rawHtmlMessage(tag), path);
      if (mode === 'load') deleteAtPath(meta, path.slice(1));
    }
  }

  // --- Items -----------------------------------------------------------------
  const seenIds = new Set<string>([meta.id]);
  const kept: Array<{ item: OQSEAnyItem; index: number }> = [];

  root.items.forEach((raw, index) => {
    const path: Path = ['items', index];
    const rawId = isRecord(raw) && typeof raw.id === 'string' ? raw.id : undefined;
    const type = isRecord(raw) ? raw.type : undefined;

    if (typeof type === 'string' && !type.startsWith('x-') && !OFFICIAL_TYPES.has(type)) {
      // A type of a later 1.x version (or a typo): kept unchanged, not rendered.
      const unknown = UnknownTypeItemSchema.safeParse(raw);
      if (!unknown.success) {
        log.addZod(unknown.error, 'INVALID_ITEM', path, rawId);
        return;
      }
      if (seenIds.has(unknown.data.id)) {
        log.add('error', 'DUPLICATE_ID', `Duplicate ID "${unknown.data.id}" (IDs must be unique within the set, including meta.id).`, [...path, 'id'], unknown.data.id);
        return;
      }
      seenIds.add(unknown.data.id);
      log.add('warning', 'UNKNOWN_ITEM_TYPE', `Unknown item type "${type}" (a newer OQSE version, or a typo; custom types use the "x-" prefix). The item is kept but not shown.`, [...path, 'type'], rawId);
      unsupportedItems.push({ index, item: structuredClone(raw) as Record<string, unknown> });
      return;
    }
    if (mode === 'load' && isRecord(raw) && !normalizeAssetKeys(raw, [...path, 'assets'], log, rawId)) return;

    const parsed = getItemSchema(raw).safeParse(raw);
    if (!parsed.success) {
      log.addZod(parsed.error, 'INVALID_ITEM', path, rawId);
      return;
    }
    const item = parsed.data as OQSEAnyItem;

    if (seenIds.has(item.id)) {
      log.add('error', 'DUPLICATE_ID', `Duplicate ID "${item.id}" (IDs must be unique within the set, including meta.id).`, [...path, 'id'], item.id);
      return;
    }
    seenIds.add(item.id);

    checkAltTexts(item.assets, [...path, 'assets'], log, mode, item.id);
    if (!checkItem(item, path, meta, htmlAllowed, latex, log, recoverable)) return;
    kept.push({ item, index });
  });
  const items = kept.map((entry) => entry.item);

  // --- References (need the final set of item IDs) ---------------------------
  const itemIds = new Set(items.map((item) => item.id));
  for (const { item } of unsupportedItems) itemIds.add(item.id as string);
  const sourceIds = new Set((meta.sourceMaterials ?? []).map((s) => s.id));
  // Sources that point into this very set: their `itemId` must exist here.
  const ownSets = new Set((meta.sourceMaterials ?? []).filter((s) => s.set === meta.id).map((s) => s.id));
  for (const { item, index } of kept) {
    const path: Path = ['items', index];
    for (const field of ['relatedItems', 'dependencyItems'] as const) {
      const refs = item[field];
      if (!refs) continue;
      const valid = refs.filter((ref) => ref !== item.id && itemIds.has(ref));
      if (valid.length !== refs.length) {
        log.add(recoverable, 'DANGLING_REFERENCE', `${field} contains IDs that do not exist in the set or reference the item itself.`, [...path, field], item.id);
        if (mode === 'load') item[field] = valid;
      }
    }
    if (item.sources) {
      const valid = item.sources.filter((src) => sourceIds.has(src.id));
      if (valid.length !== item.sources.length) {
        log.add(recoverable, 'DANGLING_REFERENCE', 'sources reference source materials that do not exist in meta.sourceMaterials.', [...path, 'sources'], item.id);
        if (mode === 'load') item.sources = valid;
      }
      item.sources.forEach((src, i) => {
        if (src.itemId === undefined || !ownSets.has(src.id) || itemIds.has(src.itemId)) return;
        log.add(recoverable, 'DANGLING_REFERENCE', `sources[${i}].itemId "${src.itemId}" does not exist in this set.`, [...path, 'sources', i, 'itemId'], item.id);
        if (mode === 'load') delete src.itemId;
      });
    }
  }

  // Features the content uses but requirements do not declare (`html` is an error above).
  for (const feature of detectFeatures({ meta, items })) {
    if (feature !== 'html' && !features.has(feature)) {
      log.add('warning', 'UNDECLARED_FEATURE', `The content uses "${feature}", but meta.requirements.features does not declare it.`, ['meta', 'requirements', 'features']);
    }
  }
  if (!latex) {
    for (const { item, index } of kept) {
      const field = itemRichText(item).find(([, text]) => looksLikeLatex(text));
      if (field) {
        log.add('warning', 'LOOKS_LIKE_LATEX', 'The text looks like a LaTeX formula; if it is one, declare the "latex" feature (otherwise $ is an ordinary character).', ['items', index, ...field[0]], item.id);
      }
    }
  }

  checkOpenValues(meta, kept, log);

  const file = { ...root, meta, items } as OQSEFile;
  return { success: true, data: file, unsupportedItems, errors: log.errors, warnings: log.warnings };
}

// ============================================================================
// Sources and open values
// ============================================================================

/** The pre-release shape `{ type, value }` of a source, converted to the 1.0 shape. */
const LEGACY_SOURCE_TYPES: Record<string, { kind: string | null; key: 'url' | 'doi' | 'isbn' | null; mimeType?: string }> = {
  url: { kind: 'web', key: 'url' },
  pdf: { kind: null, key: 'url', mimeType: 'application/pdf' },
  video: { kind: 'video', key: 'url' },
  audio: { kind: 'audio', key: 'url' },
  image: { kind: 'image', key: 'url' },
  model: { kind: 'model', key: 'url' },
  doi: { kind: 'article', key: 'doi' },
  isbn: { kind: 'book', key: 'isbn' },
  textbook: { kind: 'book', key: null },
  other: { kind: 'other', key: null },
};

/**
 * Converts a source of the release-candidate shape (`type` + `value`) to the 1.0 shape.
 * Returns `null` when the source does not use the old shape.
 */
export function convertLegacySource(source: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof source.type !== 'string' || !('value' in source)) return null;
  if (['kind', 'url', 'doi', 'isbn', 'set'].some((key) => key in source)) return null;
  const legacy = LEGACY_SOURCE_TYPES[source.type] ?? { kind: 'other', key: null };
  const { type: _type, value, ...rest } = source;
  const converted: Record<string, unknown> = { ...rest };
  if (legacy.kind) converted.kind = legacy.kind;
  if (legacy.key) converted[legacy.key] = value;
  else if (typeof value === 'string' && value && value !== source.title) {
    converted.description = typeof rest.description === 'string' && rest.description ? `${rest.description} (${value})` : value;
  }
  if (legacy.mimeType && converted.mimeType === undefined) converted.mimeType = legacy.mimeType;
  return converted;
}

/** Validates `meta.sourceMaterials` one source at a time (and converts the old shape). */
function checkSources(meta: Record<string, unknown>, log: IssueLog, mode: Mode, recoverable: OQSEIssueSeverity): void {
  if (!Array.isArray(meta.sourceMaterials)) return;
  const kept: unknown[] = [];
  meta.sourceMaterials.forEach((raw, i) => {
    const path: Path = ['meta', 'sourceMaterials', i];
    let source = raw;
    if (isRecord(raw)) {
      const converted = convertLegacySource(raw);
      if (converted) {
        log.add(recoverable, 'LEGACY_SOURCE', `Source "${String(raw.id)}" uses the pre-release shape "type" + "value"; OQSE 1.0 uses "kind" and "url" / "doi" / "isbn" / "set".`, path);
        source = converted;
      }
    }
    const parsed = SourceMaterialSchema.safeParse(source);
    if (!parsed.success) {
      log.addZod(parsed.error, 'INVALID_SOURCE', path);
      if (mode === 'strict') kept.push(raw);
      return;
    }
    const s = parsed.data;
    if (s.url === undefined && s.doi === undefined && s.isbn === undefined && s.set === undefined) {
      log.add('warning', 'SOURCE_WITHOUT_LOCATOR', `Source "${s.id}" has none of url, doi, isbn, set: it can be cited only by its title.`, path);
    }
    kept.push(mode === 'load' ? source : raw);
  });
  if (mode === 'load') meta.sourceMaterials = kept;
}

/** Values of open fields that this library does not know: warnings (the application uses the fallback). */
function checkOpenValues(meta: OQSEMeta, kept: Array<{ item: OQSEAnyItem; index: number }>, log: IssueLog): void {
  const warn = (value: unknown, known: readonly string[], path: Path, fallback: string, itemId?: string) => {
    if (typeof value === 'string' && !known.includes(value)) {
      log.add('warning', 'UNKNOWN_VALUE', `Unknown value "${value}" (a newer OQSE version, or a typo): ${fallback}.`, path, itemId);
    }
  };
  const assets = (owner: Record<string, MediaObject> | undefined, path: Path, itemId?: string) => {
    for (const [key, media] of Object.entries(owner ?? {})) {
      warn(media.type, MEDIA_TYPES, [...path, key, 'type'], 'shown as a link', itemId);
      media.subtitles?.forEach((track, i) => warn(track.kind, SUBTITLE_KINDS, [...path, key, 'subtitles', i, 'kind'], 'the track is not offered', itemId));
    }
  };
  assets(meta.assets, ['meta', 'assets']);
  meta.sourceMaterials?.forEach((source, i) => warn(source.kind, SOURCE_KINDS, ['meta', 'sourceMaterials', i, 'kind'], 'treated as "other"'));
  for (const { item, index } of kept) {
    assets(item.assets, ['items', index, 'assets'], item.id);
    warn(item.pedagogy?.bloomLevel, BLOOM_LEVELS, ['items', index, 'pedagogy', 'bloomLevel'], 'ignored', item.id);
    warn(item.pedagogy?.cognitiveLoad, COGNITIVE_LOADS, ['items', index, 'pedagogy', 'cognitiveLoad'], 'ignored', item.id);
  }
}

/** Item-level rules that need the set context. Returns `false` if the item must be skipped. */
function checkItem(
  item: OQSEAnyItem,
  path: Path,
  meta: OQSEMeta,
  htmlAllowed: boolean,
  latex: boolean,
  log: IssueLog,
  recoverable: OQSEIssueSeverity,
): boolean {
  let ok = true;

  // Raw HTML without the `html` feature (Tier 1).
  if (!htmlAllowed) {
    for (const [fieldPath, text] of itemRichText(item)) {
      const tag = findRawHtml(text, { latex });
      if (tag) {
        log.add('error', 'RAW_HTML_NOT_ALLOWED', rawHtmlMessage(tag), [...path, ...fieldPath], item.id);
        ok = false;
      }
    }
  }

  // Target asset of image/model interactions must exist and have the right media type.
  if ('targetAsset' in item && typeof item.targetAsset === 'string' && !item.type.startsWith('x-')) {
    const media = resolveAsset(item.targetAsset, item, meta);
    const expected = item.type === 'pin-on-model' ? 'model' : 'image';
    if (!media) {
      log.add('error', 'MISSING_TARGET_ASSET', `targetAsset "${item.targetAsset}" does not exist in item.assets or meta.assets.`, [...path, 'targetAsset'], item.id);
      ok = false;
    } else if (media.type !== expected) {
      log.add('error', 'INVALID_TARGET_ASSET', `targetAsset "${item.targetAsset}" must be of type "${expected}".`, [...path, 'targetAsset'], item.id);
      ok = false;
    }
  }

  // Internal IDs (timeline events, categorize entries) must be unique within the item.
  const internal = item.type === 'timeline' ? item.events : item.type === 'categorize' ? item.items : undefined;
  if (internal) {
    const ids = internal.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) {
      log.add('error', 'DUPLICATE_ID', 'Internal IDs must be unique within the item.', [...path, item.type === 'timeline' ? 'events' : 'items'], item.id);
      ok = false;
    }
  }

  // A chess solution should end with the learner's move (odd number of moves).
  if (item.type === 'chess-puzzle' && item.correctAnswers.some((line) => line.length % 2 === 0)) {
    log.add('warning', 'CHESS_SEQUENCE_LENGTH', "Each move sequence should end with the learner's move (an odd number of moves; the application plays the replies).", [...path, 'correctAnswers'], item.id);
  }

  // Headings inside a note are relative to it: the title is level 1, content starts at level 2.
  if (item.type === 'note') {
    for (const field of ['content', 'hiddenContent'] as const) {
      const text = item[field];
      if (text && findHeadings(splitLines(text)).some((h) => h.level === 1)) {
        log.add('warning', 'NOTE_HEADING_LEVEL', 'Headings inside a note should start at level 2 (##); the note title is level 1.', [...path, field], item.id);
      }
    }
  }

  // Markdown images: an absolute URL (http only with a warning); blank tags only in fill-in texts.
  const fillIn = item.type === 'fill-in-blanks' || item.type === 'fill-in-select';
  for (const [fieldPath, text] of itemRichText(item)) {
    for (const url of findMarkdownImageUrls(text)) {
      if (/^https:\/\//i.test(url)) continue;
      const http = /^http:\/\//i.test(url);
      log.add(http ? 'warning' : recoverable, 'INVALID_IMAGE_URL', http ? `Image "${url}" uses http:// (prefer https://).` : `Image "${url}" needs an absolute https:// URL (use <asset:key /> for other media).`, [...path, ...fieldPath], item.id);
    }
    if (!(fillIn && fieldPath.length === 1 && fieldPath[0] === 'text') && /<blank:[a-zA-Z0-9_-]+\s*\/>/i.test(text)) {
      log.add('warning', 'BLANK_OUTSIDE_TEXT', 'Blank tags belong only in the text of fill-in-blanks and fill-in-select (shown here as an empty line).', [...path, ...fieldPath], item.id);
    }
  }

  // Missing <asset:key /> references and shadowed global assets (recoverable in both modes).
  for (const [fieldPath, text] of itemRichText(item)) {
    for (const key of findAssetKeys(text)) {
      if (!resolveAsset(key, item, meta)) {
        log.add('warning', 'MISSING_ASSET', `<asset:${key} /> does not exist in item.assets or meta.assets.`, [...path, ...fieldPath], item.id);
      }
    }
  }
  for (const key of Object.keys(item.assets ?? {})) {
    if (meta.assets?.[key]) {
      log.add('warning', 'ASSET_SHADOWED', `Item asset "${key}" shadows a global asset with the same key; use unique keys.`, [...path, 'assets', key], item.id);
    }
  }

  return ok;
}

/**
 * Images need `altText`: on import a missing one is derived from the file name
 * (warning); when saving it is an error.
 */
function checkAltTexts(assets: Record<string, MediaObject> | undefined, path: Path, log: IssueLog, mode: Mode, itemId?: string): void {
  for (const [key, media] of Object.entries(assets ?? {})) {
    if (media.type !== 'image' || media.altText?.trim()) continue;
    log.add(mode === 'strict' ? 'error' : 'warning', 'MISSING_ALT_TEXT', `Image "${key}" has no altText (alternative text for screen readers).`, [...path, key, 'altText'], itemId);
    if (mode === 'load') media.altText = altTextFromFileName(media.value) || key;
  }
}

/** URLs of Markdown images (`![alt](url)`) outside code. */
function findMarkdownImageUrls(text: string): string[] {
  const prose = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, '').replace(/`[^`\n]+`/g, '');
  return [...prose.matchAll(/!\[[^\]\n]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]);
}

/** `assets/img/cell-diagram.png?v=2` → "cell diagram". */
function altTextFromFileName(value: string): string {
  const name = value.split(/[?#]/)[0].split('/').pop() ?? '';
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
}

/**
 * Lowercases asset keys (with a warning). Returns `false` on a collision,
 * which is an error for the owning object.
 */
function normalizeAssetKeys(owner: Record<string, unknown>, path: Path, log: IssueLog, itemId?: string): boolean {
  const assets = owner.assets;
  if (!isRecord(assets)) return true;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assets)) {
    const lower = key.toLowerCase();
    if (lower in normalized) {
      log.add('error', 'ASSET_KEY_COLLISION', `Asset keys collide after lowercasing ("${key}").`, [...path, key], itemId);
      return false;
    }
    if (lower !== key) log.add('warning', 'ASSET_KEY_NORMALIZED', `Asset key "${key}" was converted to "${lower}".`, [...path, key], itemId);
    normalized[lower] = value;
  }
  owner.assets = normalized;
  for (const field of ['thumbnail', 'targetAsset'] as const) {
    if (typeof owner[field] === 'string') owner[field] = (owner[field] as string).toLowerCase();
  }
  return true;
}

// ============================================================================
// Helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawHtmlMessage(tag: string): string {
  return `Raw HTML ${tag} is not allowed unless the set declares the "html" feature (use Markdown instead).`;
}

function deleteAtPath(target: unknown, path: Path) {
  let current = target as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) current = current[key] as Record<string | number, unknown>;
  delete current[path[path.length - 1]];
}
