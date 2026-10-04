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
 * Unknown keys are always preserved (forward compatibility).
 */

import type { z } from 'zod';
import type { MediaObject, OQSEAnyItem, OQSEFile, OQSEMeta } from './oqse';
import { OQSEMetaSchema, getItemSchema } from './oqseValidation';
import { OFFICIAL_ITEM_TYPES } from './oqse';
import { findAssetKeys, findRawHtml } from './richTextProcessor';
import { formatPath, validateJsonDepth } from './utils';

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

export interface OQSELoadResult {
  /** `false` only for critical errors (the set cannot be loaded at all). */
  success: boolean;
  /** The loaded set: only valid items, recoverable problems removed. Present when `success`. */
  data?: OQSEFile;
  /** Critical errors and item-level errors (each skipped item has at least one). */
  errors: OQSEIssue[];
  warnings: OQSEIssue[];
}

export interface OQSEValidationResult {
  /** `true` when the set is fully compliant (no errors). */
  success: boolean;
  data?: OQSEFile;
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
export const SUPPORTED_OQSE_MAJOR_VERSION = 0;

// ============================================================================
// Public API
// ============================================================================

/**
 * Tolerant import of an OQSE set (Best Effort).
 *
 * - Critical errors (invalid root, `version` or `meta`) → `success: false`.
 * - Invalid items, unknown item types, duplicate IDs, missing target assets and
 *   raw HTML without the `html` feature → the item is skipped (error).
 * - Dangling references, a missing thumbnail and uppercase asset keys → fixed in
 *   the returned copy (warning). The input is never mutated.
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
  return { success, data: success ? result.data : undefined, errors: result.errors, warnings: result.warnings };
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

/**
 * Looks up a media object for `<asset:key />` or `targetAsset`: first in the
 * item's own `assets`, then in `meta.assets`. The key is case-insensitive.
 */
export function resolveAsset(
  key: string,
  item: Pick<OQSEAnyItem, 'assets'> | undefined,
  meta: Pick<OQSEMeta, 'assets'> | undefined,
): MediaObject | undefined {
  const k = key.toLowerCase();
  return item?.assets?.[k] ?? meta?.assets?.[k];
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
  const critical = (): OQSELoadResult => ({ success: false, errors: log.errors, warnings: log.warnings });
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
    log.add('error', 'INVALID_VERSION', 'Version must be in MAJOR.MINOR format (e.g. "0.2").', ['version']);
    return critical();
  }
  if (Number(root.version.split('.')[0]) !== SUPPORTED_OQSE_MAJOR_VERSION) {
    log.add('warning', 'UNSUPPORTED_VERSION', `Unsupported MAJOR version ${root.version}; loading in best-effort mode.`, ['version']);
  }
  if (root.items.length > 10000) {
    log.add('error', 'TOO_MANY_ITEMS', 'Maximum 10000 items per set.', ['items']);
    return critical();
  }

  // --- Meta ------------------------------------------------------------------
  if (mode === 'load' && !normalizeAssetKeys(root.meta, ['meta', 'assets'], log)) return critical();
  const metaResult = OQSEMetaSchema.safeParse(root.meta);
  if (!metaResult.success) {
    log.addZod(metaResult.error, 'INVALID_META', ['meta']);
    return critical();
  }
  const meta = metaResult.data as OQSEMeta;
  const features = new Set(meta.requirements?.features ?? []);
  const htmlAllowed = features.has('html');
  const latex = features.has('latex');

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
      log.add(recoverable, 'UNKNOWN_ITEM_TYPE', `Unknown item type "${type}" (custom types must use the "x-" prefix).`, [...path, 'type'], rawId);
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

    if (!checkItem(item, path, meta, htmlAllowed, latex, log)) return;
    kept.push({ item, index });
  });
  const items = kept.map((entry) => entry.item);

  // --- References (need the final set of item IDs) ---------------------------
  const itemIds = new Set(items.map((item) => item.id));
  const sourceIds = new Set((meta.sourceMaterials ?? []).map((s) => s.id));
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
    }
  }

  const file = { ...root, meta, items } as OQSEFile;
  return { success: true, data: file, errors: log.errors, warnings: log.warnings };
}

/** Item-level rules that need the set context. Returns `false` if the item must be skipped. */
function checkItem(
  item: OQSEAnyItem,
  path: Path,
  meta: OQSEMeta,
  htmlAllowed: boolean,
  latex: boolean,
  log: IssueLog,
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
// Rich Content field extraction
// ============================================================================

type TextEntry = [Path, string];

function pushText(out: TextEntry[], path: Path, value: unknown) {
  if (typeof value === 'string') out.push([path, value]);
}

function pushTexts(out: TextEntry[], path: Path, values: unknown) {
  if (Array.isArray(values)) values.forEach((value, i) => pushText(out, [...path, i], value));
}

function pushMediaTexts(out: TextEntry[], path: Path, assets: Record<string, MediaObject> | undefined) {
  for (const [key, media] of Object.entries(assets ?? {})) {
    pushText(out, [...path, key, 'transcript'], media.transcript);
    pushText(out, [...path, key, 'caption'], media.caption);
  }
}

function metaRichText(meta: OQSEMeta): TextEntry[] {
  const out: TextEntry[] = [];
  pushText(out, ['meta', 'description'], meta.description);
  pushMediaTexts(out, ['meta', 'assets'], meta.assets);
  return out;
}

/** All Rich Content fields of an item, as `[path relative to the item, text]`. */
export function itemRichText(item: OQSEAnyItem): TextEntry[] {
  const out: TextEntry[] = [];
  pushTexts(out, ['hints'], item.hints);
  pushText(out, ['explanation'], item.explanation);
  pushText(out, ['incorrectFeedback'], item.incorrectFeedback);
  item.sources?.forEach((source, i) => pushText(out, ['sources', i, 'quote'], source.quote));
  pushMediaTexts(out, ['assets'], item.assets);
  if ('question' in item) pushText(out, ['question'], item.question);

  switch (item.type) {
    case 'note':
      pushText(out, ['content'], item.content);
      pushText(out, ['hiddenContent'], item.hiddenContent);
      break;
    case 'flashcard':
      pushText(out, ['front'], item.front);
      pushText(out, ['back'], item.back);
      break;
    case 'mcq-single':
    case 'mcq-multi':
      pushTexts(out, ['options'], item.options);
      pushTexts(out, ['optionExplanations'], item.optionExplanations);
      break;
    case 'fill-in-blanks':
      pushText(out, ['text'], item.text);
      break;
    case 'fill-in-select':
      pushText(out, ['text'], item.text);
      for (const [token, blank] of Object.entries(item.blanks)) pushTexts(out, ['blanks', token, 'options'], blank.options);
      break;
    case 'match-pairs':
      pushTexts(out, ['prompts'], item.prompts);
      pushTexts(out, ['matches'], item.matches);
      break;
    case 'match-complex':
      pushTexts(out, ['leftItems'], item.leftItems);
      pushTexts(out, ['rightItems'], item.rightItems);
      break;
    case 'sort-items':
      pushTexts(out, ['items'], item.items);
      break;
    case 'categorize':
      item.items.forEach((entry, i) => pushText(out, ['items', i, 'text'], entry.text));
      break;
    case 'timeline':
      item.events.forEach((event, i) => pushText(out, ['events', i, 'text'], event.text));
      break;
    case 'diagram-label':
      pushTexts(out, ['labels'], item.labels);
      break;
    case 'open-ended':
      pushText(out, ['sampleAnswer'], item.sampleAnswer);
      break;
  }
  return out;
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
