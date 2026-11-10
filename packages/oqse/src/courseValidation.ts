/**
 * OQSEC v1.0 – OQSE Course: Zod schemas, loading with checks, and applying views.
 *
 * @see ../oqse-course.md
 */

import { z } from 'zod';
import type {
  CourseLesson,
  CourseNode,
  CourseOrder,
  CourseSection,
  CourseStep,
  CourseView,
  OQSECourse,
  OQSECourseViewFile,
  SetSelection,
  ViewChanges,
} from './course';
import {
  AbsoluteURLSchema,
  AssetDictionarySchema,
  AssetKeySchema,
  ISO8601DateTimeSchema,
  LanguageCodeSchema,
  OpenValueSchema,
  PersonObjectSchema,
  PlainTextSchema,
  RichContentSchema,
  SourceMaterialSchema,
  SPDXLicenseSchema,
  TranslationObjectSchema,
  UUIDSchema,
} from './oqseValidation';
import { MAX_JSON_DEPTH, validateJsonDepth } from './utils';

export const OQSEC_VERSION = '1.0';
/** Most sections, lessons, steps and checkpoints in one course. */
export const MAX_COURSE_NODES = 20_000;
/** Largest `course.json` (UTF-8 bytes) that `loadOQSECourse` accepts as text. */
export const MAX_COURSE_BYTES = 5 * 1024 * 1024;

export const KNOWN_STEP_KINDS = ['read', 'practise', 'check', 'page', 'watch', 'listen', 'link'] as const;
export const KNOWN_PAGE_KINDS = ['presentation', 'simulation', 'explainer', 'other'] as const;
export const KNOWN_AUDIENCES = ['anyone', 'class'] as const;
export const KNOWN_PRACTISE_MODES = ['cards', 'quiz', 'write'] as const;
export const KNOWN_COURSE_LEVELS = ['primary', 'lower-secondary', 'upper-secondary', 'tertiary', 'adult'] as const;

// ============================================================================
// Primitives
// ============================================================================

/** A relative path inside a course folder (OQSE's path rules: no `/` at the start, no `..`, safe characters). */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (/^[/\\]/.test(path) || /^[a-zA-Z]:/.test(path)) return false;
  if (!/^[A-Za-z0-9_\-./]+$/.test(path)) return false;
  return !path.split('/').some((part) => part === '..' || part === '' || part === '.');
}

export const RelativePathSchema = z.string().refine(isSafeRelativePath, 'Path must be relative, without "..", with only a-z A-Z 0-9 _ - . / (e.g. "sets/mud/index.json")');

/** An absolute http(s) URL (other schemes such as `javascript:` or `data:` are refused). */
export const WebURLSchema = AbsoluteURLSchema.refine((url) => /^https?:\/\//i.test(url), 'URL must start with https:// (or http://)');

const PercentSchema = z.number().min(0).max(100);
const MinutesSchema = z.number().positive();

/** A game's manifest ID: a URL or `urn:uuid:…` (OQSEM). */
export const GameIdSchema = z.string().refine(
  (id) => /^https?:\/\/\S+$/i.test(id) || /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  'Game ID must be the manifest id: a URL or "urn:uuid:…"'
);

const locationRefine = <T extends { path?: unknown; url?: unknown }>(data: T) => (data.path === undefined) !== (data.url === undefined);
const locationMessage = { message: 'A resource needs exactly one of "path" and "url"', path: ['path'] };

// ============================================================================
// Meta and resources
// ============================================================================

export const CourseMetaSchema = z.looseObject({
  id: UUIDSchema,
  language: LanguageCodeSchema,
  title: PlainTextSchema.max(500, 'Title must not be longer than 500 characters'),
  description: RichContentSchema.max(10000, 'Description must not be longer than 10000 characters').optional(),
  goals: z.array(PlainTextSchema).optional(),
  thumbnail: AssetKeySchema.optional(),
  assets: AssetDictionarySchema.optional(),
  createdAt: ISO8601DateTimeSchema,
  updatedAt: ISO8601DateTimeSchema,
  author: PersonObjectSchema.optional(),
  contributors: z.array(PersonObjectSchema).optional(),
  license: SPDXLicenseSchema.optional(),
  licenseUrl: AbsoluteURLSchema.optional(),
  levels: z.array(OpenValueSchema).optional(),
  subject: z.string().optional(),
  exam: z.string().optional(),
  school: z.string().optional(),
  tags: z.array(PlainTextSchema).optional(),
  ageMin: z.number().int().nonnegative().optional(),
  ageMax: z.number().int().nonnegative().optional(),
  estimatedTime: MinutesSchema.optional(),
  order: z.enum(['guided', 'locked', 'free']).optional(),
  sourceMaterials: z.array(SourceMaterialSchema).optional(),
  translations: z.array(TranslationObjectSchema).optional(),
  aiGenerated: z.boolean().optional(),
  customData: z.record(z.string(), z.unknown()).optional(),
  appSpecific: z.record(z.string(), z.unknown()).optional(),
})
  .refine((m) => m.ageMin === undefined || m.ageMax === undefined || m.ageMin <= m.ageMax, { message: 'ageMin must not be higher than ageMax', path: ['ageMax'] })
  .refine((m) => new Date(m.createdAt) <= new Date(m.updatedAt), { message: 'createdAt must not be after updatedAt', path: ['updatedAt'] });

export const CourseSetSchema = z.looseObject({
  id: UUIDSchema,
  title: PlainTextSchema,
  path: RelativePathSchema.optional(),
  url: WebURLSchema.optional(),
}).refine(locationRefine, locationMessage);

export const CoursePageSchema = z.looseObject({
  id: UUIDSchema,
  title: PlainTextSchema,
  kind: OpenValueSchema.optional(),
  path: RelativePathSchema.optional(),
  url: WebURLSchema.optional(),
  thumbnail: z.string().refine((v) => isSafeRelativePath(v) || /^https?:\/\//i.test(v), 'Thumbnail must be a relative path or an absolute URL').optional(),
  aiGenerated: z.boolean().optional(),
  license: SPDXLicenseSchema.optional(),
}).refine(locationRefine, locationMessage);

export const CourseGameSchema = z.looseObject({
  id: GameIdSchema,
  title: PlainTextSchema,
  path: RelativePathSchema.optional(),
  url: WebURLSchema.optional(),
  aiGenerated: z.boolean().optional(),
  license: SPDXLicenseSchema.optional(),
}).refine(locationRefine, locationMessage);

// ============================================================================
// Outline
// ============================================================================

export const SetSelectionSchema = z.looseObject({
  set: UUIDSchema,
  items: z.array(UUIDSchema).optional(),
  tags: z.array(PlainTextSchema).optional(),
});

const NEEDS: Record<string, 'sets' | 'page' | 'url'> = { read: 'sets', practise: 'sets', check: 'sets', page: 'page', watch: 'url', listen: 'url', link: 'url' };

/**
 * A step. `kind` is open: a kind from a later 1.x passes here and is reported by
 * `checkOQSECourse` as a warning; known kinds must have their keys.
 */
export const CourseStepSchema = z.looseObject({
  kind: OpenValueSchema,
  id: UUIDSchema,
  title: PlainTextSchema.optional(),
  minutes: MinutesSchema.optional(),
  optional: z.boolean().optional(),
  audience: OpenValueSchema.optional(),
  sets: z.array(SetSelectionSchema).min(1, 'A step needs at least one set').optional(),
  mode: OpenValueSchema.optional(),
  game: z.looseObject({ id: GameIdSchema, settings: z.record(z.string(), z.unknown()).optional() }).optional(),
  passScore: PercentSchema.optional(),
  page: UUIDSchema.optional(),
  url: WebURLSchema.optional(),
}).superRefine((step, ctx) => {
  const need = NEEDS[step.kind];
  if (need && step[need] === undefined) ctx.addIssue({ code: 'custom', message: `A "${step.kind}" step needs "${need}"`, path: [need] });
});

export const CheckpointSchema = z.looseObject({
  id: UUIDSchema,
  sets: z.array(SetSelectionSchema).min(1, 'A checkpoint needs at least one set'),
  passScore: PercentSchema.optional(),
  minutes: MinutesSchema.optional(),
});

export const CourseLessonSchema = z.looseObject({
  kind: z.literal('lesson'),
  id: UUIDSchema,
  title: PlainTextSchema,
  goal: PlainTextSchema.optional(),
  description: RichContentSchema.optional(),
  optional: z.boolean().optional(),
  steps: z.array(CourseStepSchema),
});

export const CourseSectionSchema: z.ZodType<CourseSection> = z.looseObject({
  kind: z.literal('section'),
  id: UUIDSchema,
  title: PlainTextSchema,
  levelName: PlainTextSchema.optional(),
  description: RichContentSchema.optional(),
  goal: PlainTextSchema.optional(),
  optional: z.boolean().optional(),
  get children() {
    return z.array(CourseNodeSchema);
  },
  checkpoint: CheckpointSchema.optional(),
}) as unknown as z.ZodType<CourseSection>;

export const CourseNodeSchema: z.ZodType<CourseNode> = z.union([CourseSectionSchema, CourseLessonSchema]) as unknown as z.ZodType<CourseNode>;

// ============================================================================
// Views
// ============================================================================

const ViewMoveSchema = z.looseObject({ node: UUIDSchema, parent: UUIDSchema.nullable(), after: UUIDSchema.nullable() });
const ViewAdditionSchema = z.looseObject({
  parent: UUIDSchema.nullable(),
  after: UUIDSchema.nullable(),
  node: z.union([CourseNodeSchema, CourseStepSchema]),
});

export const ViewChangesSchema = z.looseObject({
  hide: z.array(UUIDSchema).optional(),
  show: z.array(UUIDSchema).optional(),
  optional: z.array(UUIDSchema).optional(),
  required: z.array(UUIDSchema).optional(),
  order: z.enum(['guided', 'locked', 'free']).optional(),
  moves: z.array(ViewMoveSchema).optional(),
  add: z.array(ViewAdditionSchema).optional(),
});

export const CourseViewSchema = ViewChangesSchema.extend({
  id: UUIDSchema,
  title: PlainTextSchema,
  description: RichContentSchema.optional(),
  base: UUIDSchema.optional(),
});

// ============================================================================
// Root
// ============================================================================

const VersionSchema = z.string().regex(/^\d+\.\d+$/, 'version must be "MAJOR.MINOR" (e.g. "1.0")')
  .refine((v) => v.split('.')[0] === '1', 'Unsupported OQSEC version: this library reads OQSEC 1.x (write "version": "1.0")');

export const OQSECourseSchema: z.ZodType<OQSECourse> = z.looseObject({
  $schema: z.string().optional(),
  version: VersionSchema,
  meta: CourseMetaSchema,
  sets: z.array(CourseSetSchema).optional(),
  pages: z.array(CoursePageSchema).optional(),
  games: z.array(CourseGameSchema).optional(),
  outline: z.array(CourseNodeSchema),
  views: z.array(CourseViewSchema).optional(),
}) as unknown as z.ZodType<OQSECourse>;

export const OQSECourseViewSchema: z.ZodType<OQSECourseViewFile> = z.looseObject({
  $schema: z.string().optional(),
  version: VersionSchema,
  meta: CourseMetaSchema,
  course: z.looseObject({ id: UUIDSchema, title: PlainTextSchema, url: WebURLSchema, view: UUIDSchema.optional() }),
  sets: z.array(CourseSetSchema).optional(),
  pages: z.array(CoursePageSchema).optional(),
  games: z.array(CourseGameSchema).optional(),
  view: ViewChangesSchema,
}) as unknown as z.ZodType<OQSECourseViewFile>;

/** Validates a course (structure only; see `loadOQSECourse` for references and limits). Throws on errors. */
export function validateOQSECourse(data: unknown): OQSECourse {
  return OQSECourseSchema.parse(data);
}

export function safeValidateOQSECourse(data: unknown): ReturnType<typeof OQSECourseSchema.safeParse> {
  return OQSECourseSchema.safeParse(data);
}

export function validateOQSECourseView(data: unknown): OQSECourseViewFile {
  return OQSECourseViewSchema.parse(data);
}

export function safeValidateOQSECourseView(data: unknown): ReturnType<typeof OQSECourseViewSchema.safeParse> {
  return OQSECourseViewSchema.safeParse(data);
}

// ============================================================================
// Checks beyond the structure
// ============================================================================

export interface CourseIssue {
  severity: 'error' | 'warning';
  code:
    | 'duplicate-id'
    | 'too-many-nodes'
    | 'view-base'
    | 'unknown-set'
    | 'unknown-page'
    | 'unknown-value'
    | 'view-target';
  message: string;
  /** The ID the issue is about, when there is one. */
  id?: string;
}

/** Calls `fn` for every section, lesson, step and checkpoint, depth first, in order. */
export function walkCourse(
  nodes: CourseNode[],
  fn: (node: CourseNode | CourseStep | { kind: 'checkpoint'; id: string; sets: SetSelection[] }, parent: CourseSection | CourseLesson | null) => void,
  parent: CourseSection | CourseLesson | null = null,
): void {
  for (const node of nodes) {
    fn(node, parent);
    if (node.kind === 'section') {
      walkCourse(node.children, fn, node);
      if (node.checkpoint) fn({ kind: 'checkpoint', ...node.checkpoint }, node);
    } else {
      for (const step of node.steps) fn(step, node);
    }
  }
}

const known = (list: readonly string[], value: string | undefined) => value === undefined || list.includes(value);

/**
 * Checks what the schema cannot: unique IDs, the node limit, references to the course's sets
 * and pages, view bases and targets, unknown values of open fields.
 */
export function checkOQSECourse(course: OQSECourse): CourseIssue[] {
  const issues: CourseIssue[] = [];
  const error = (code: CourseIssue['code'], message: string, id?: string) => issues.push({ severity: 'error', code, message, id });
  const warn = (code: CourseIssue['code'], message: string, id?: string) => issues.push({ severity: 'warning', code, message, id });

  const ids = new Set<string>();
  const sets = new Set((course.sets ?? []).map((s) => s.id));
  const pages = new Set((course.pages ?? []).map((p) => p.id));
  let count = 0;
  const seen = (id: string, what: string) => {
    if (ids.has(id)) error('duplicate-id', `Duplicate ID ${id} (${what})`, id);
    ids.add(id);
  };
  const selections = (list: SetSelection[] | undefined, where: string) => {
    for (const sel of list ?? []) if (!sets.has(sel.set)) warn('unknown-set', `${where} uses set ${sel.set}, which the course does not list`, sel.set);
  };

  for (const [name, list] of [['set', course.sets], ['page', course.pages], ['game', course.games]] as const) {
    const listIds = new Set<string>();
    for (const r of list ?? []) {
      if (listIds.has(r.id)) error('duplicate-id', `The ${name} ${r.id} is listed twice`, r.id);
      listIds.add(r.id);
      if (name === 'page' && !known(KNOWN_PAGE_KINDS, (r as { kind?: string }).kind)) warn('unknown-value', `Unknown page kind "${(r as { kind?: string }).kind}" (shown as "other")`, r.id);
    }
  }
  for (const level of course.meta.levels ?? []) if (!known(KNOWN_COURSE_LEVELS, level)) warn('unknown-value', `Unknown level "${level}"`);

  walkCourse(course.outline, (node) => {
    count++;
    seen(node.id, node.kind);
    if (node.kind === 'section' || node.kind === 'lesson') return;
    if (node.kind === 'checkpoint') return selections((node as { sets: SetSelection[] }).sets, `The checkpoint ${node.id}`);
    const step = node as CourseStep & { sets?: SetSelection[]; page?: string; audience?: string; mode?: string };
    if (!known(KNOWN_STEP_KINDS, step.kind)) warn('unknown-value', `Unknown step kind "${step.kind}" (shown as not supported)`, step.id);
    if (!known(KNOWN_AUDIENCES, step.audience)) warn('unknown-value', `Unknown audience "${step.audience}" (treated as "anyone")`, step.id);
    if (!known(KNOWN_PRACTISE_MODES, step.mode)) warn('unknown-value', `Unknown mode "${step.mode}"`, step.id);
    selections(step.sets, `The step ${step.id}`);
    if (step.page !== undefined && !pages.has(step.page)) warn('unknown-page', `The step ${step.id} opens page ${step.page}, which the course does not list`, step.page);
  });
  if (count > MAX_COURSE_NODES) error('too-many-nodes', `The course has ${count} sections, lessons, steps and checkpoints (at most ${MAX_COURSE_NODES})`);

  const views = new Map((course.views ?? []).map((v) => [v.id, v]));
  for (const view of course.views ?? []) {
    seen(view.id, 'view');
    if (view.base !== undefined && !views.has(view.base)) error('view-base', `The view ${view.id} builds on view ${view.base}, which does not exist`, view.id);
    const chain = new Set<string>([view.id]);
    for (let base = view.base; base !== undefined; base = views.get(base)?.base) {
      if (chain.has(base)) { error('view-base', `The views ${[...chain].join(', ')} build on each other in a cycle`, view.id); break; }
      chain.add(base);
    }
  }
  for (const view of course.views ?? []) {
    for (const issue of applyCourseView(course, view).skipped) warn('view-target', `The view ${view.id}: ${issue}`, view.id);
  }
  return issues;
}

export interface OQSECourseLoadResult {
  success: boolean;
  data?: OQSECourse;
  errors: string[];
  warnings: CourseIssue[];
}

/**
 * Loads a course (an object or the text of `course.json`): the structure, the size and depth
 * limits, and `checkOQSECourse`. `success` is false when there are errors; warnings let it load.
 */
export function loadOQSECourse(input: unknown): OQSECourseLoadResult {
  let data = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > MAX_COURSE_BYTES) return { success: false, errors: [`course.json is larger than ${MAX_COURSE_BYTES / 1024 / 1024} MB`], warnings: [] };
    try {
      data = JSON.parse(input.replace(/^﻿/, ''));
    } catch (e) {
      return { success: false, errors: [`Not valid JSON: ${(e as Error).message}`], warnings: [] };
    }
  }
  try {
    validateJsonDepth(data, MAX_JSON_DEPTH);
  } catch {
    return { success: false, errors: [`JSON is nested deeper than ${MAX_JSON_DEPTH} levels`], warnings: [] };
  }
  const parsed = OQSECourseSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`), warnings: [] };
  }
  const issues = checkOQSECourse(parsed.data);
  const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
  return { success: errors.length === 0, data: errors.length ? undefined : parsed.data, errors, warnings: issues.filter((i) => i.severity === 'warning') };
}

// ============================================================================
// Applying a view
// ============================================================================

export interface AppliedCourseView {
  /** The outline as the view shows it (hidden parts removed, optional flags set, moves and additions done). */
  outline: CourseNode[];
  order: CourseOrder;
  /** Changes that could not be applied (a target the course does not have, a move to a wrong place). */
  skipped: string[];
}

type Located = { node: CourseNode | CourseStep; list: (CourseNode | CourseStep)[]; parent: CourseSection | CourseLesson | null };

function locate(outline: CourseNode[], id: string): Located | null {
  let found: Located | null = null;
  const visit = (list: (CourseNode | CourseStep)[], parent: CourseSection | CourseLesson | null) => {
    for (const node of list) {
      if (found) return;
      if (node.id === id) { found = { node, list, parent }; return; }
      if (node.kind === 'section') visit((node as CourseSection).children, node as CourseSection);
      else if (node.kind === 'lesson') visit((node as CourseLesson).steps, node as CourseLesson);
    }
  };
  visit(outline, null);
  return found;
}

const isStep = (node: CourseNode | CourseStep) => node.kind !== 'section' && node.kind !== 'lesson';

/** Puts `node` into `parent` (null: the top) after `after` (null: first); false when it does not fit there. */
function insert(outline: CourseNode[], node: CourseNode | CourseStep, parentId: string | null, after: string | null): boolean {
  let list: (CourseNode | CourseStep)[];
  if (parentId === null) {
    if (isStep(node)) return false;
    list = outline;
  } else {
    const parent = locate(outline, parentId)?.node;
    if (!parent) return false;
    if (parent.kind === 'section' && !isStep(node)) list = (parent as CourseSection).children;
    else if (parent.kind === 'lesson' && isStep(node)) list = (parent as CourseLesson).steps;
    else return false;
  }
  const at = after === null ? 0 : list.findIndex((n) => n.id === after) + 1;
  if (after !== null && at === 0) return false;
  list.splice(at, 0, node);
  return true;
}

const contains = (node: CourseNode | CourseStep, id: string): boolean =>
  node.kind === 'section' && (node as CourseSection).children.some((c) => c.id === id || contains(c, id));

/**
 * Applies a view to a course: its base views first (`base`, from `course.views`), then
 * `show`, `hide`, `optional` / `required`, `moves`, `add` and `order` (oqse-course.md, "Views").
 * For an OQSEC View file pass `{ ...file.view, base: file.course.view }`.
 * The course is not changed.
 */
export function applyCourseView(course: OQSECourse, view: ViewChanges & { base?: string; id?: string }): AppliedCourseView {
  const outline: CourseNode[] = structuredClone(course.outline);
  const skipped: string[] = [];
  const hidden = new Set<string>();
  let order: CourseOrder = course.meta.order ?? 'guided';

  const chain: (ViewChanges & { id?: string })[] = [view];
  const views = new Map((course.views ?? []).map((v) => [v.id, v as CourseView]));
  const visited = new Set<string>(view.id ? [view.id] : []);
  for (let base = view.base; base !== undefined; ) {
    const next = views.get(base);
    if (!next || visited.has(base)) { skipped.push(`base view ${base} is missing or cyclic`); break; }
    visited.add(base);
    chain.unshift(next);
    base = next.base;
  }

  for (const v of chain) {
    for (const id of v.show ?? []) {
      if (locate(outline, id)) hidden.delete(id); else skipped.push(`show: ${id} is not in the course`);
    }
    for (const id of v.hide ?? []) {
      if (locate(outline, id)) hidden.add(id); else skipped.push(`hide: ${id} is not in the course`);
    }
    for (const [key, value] of [['optional', true], ['required', false]] as const) {
      for (const id of v[key] ?? []) {
        const found = locate(outline, id);
        if (found) (found.node as { optional?: boolean }).optional = value; else skipped.push(`${key}: ${id} is not in the course`);
      }
    }
    for (const move of v.moves ?? []) {
      const found = locate(outline, move.node);
      if (!found) { skipped.push(`move: ${move.node} is not in the course`); continue; }
      if (move.parent !== null && (move.parent === move.node || contains(found.node, move.parent))) { skipped.push(`move: ${move.node} cannot go inside itself`); continue; }
      const index = found.list.indexOf(found.node);
      found.list.splice(index, 1);
      if (!insert(outline, found.node, move.parent, move.after)) {
        found.list.splice(index, 0, found.node);
        skipped.push(`move: ${move.node} does not fit into ${move.parent ?? 'the top'} after ${move.after ?? '(first)'}`);
      }
    }
    for (const addition of v.add ?? []) {
      if (locate(outline, addition.node.id)) { skipped.push(`add: ${addition.node.id} is already in the course`); continue; }
      if (!insert(outline, structuredClone(addition.node), addition.parent, addition.after)) {
        skipped.push(`add: ${addition.node.id} does not fit into ${addition.parent ?? 'the top'} after ${addition.after ?? '(first)'}`);
      }
    }
    if (v.order) order = v.order;
  }

  const prune = <T extends CourseNode | CourseStep>(list: T[]): T[] =>
    list.filter((n) => !hidden.has(n.id)).map((n) => {
      if (n.kind === 'section') return { ...(n as unknown as CourseSection), children: prune((n as unknown as CourseSection).children) } as unknown as T;
      if (n.kind === 'lesson') return { ...(n as unknown as CourseLesson), steps: prune((n as unknown as CourseLesson).steps) } as unknown as T;
      return n;
    });

  return { outline: prune(outline), order, skipped };
}
