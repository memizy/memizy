/**
 * Study items as the instances of a session see them (SPEC section 4.4).
 *
 * 1. Display order: the host shuffles options, items to sort, pairs, events… once per
 *    session (the same order on every device, so a board and the phones agree). OQSE
 *    answers refer to choice IDs, so shuffling never changes an answer.
 * 2. Public items: in multiplayer, the other instances get the same items without
 *    anything that gives the answer away (`answerHidden: true`). The authority shows
 *    answers with `ctx.reveal` (plugin SDK).
 *
 * Pure functions, so a future server-side authority can do exactly the same.
 */

import { OQSEItemSchema, isTimelineOrderCorrect, type OQSEAnyItem, type OQSEMeta, type TimelineEvent } from '@memizy/oqse';

/** Marks an item whose answer was removed (multiplayer, not the authority). */
export interface PublicItemMark {
  answerHidden?: true;
}

export interface DisplaySet {
  meta: OQSEMeta;
  items: OQSEAnyItem[];
}

// ----------------------------------------------------------------------------
// Deterministic random (mulberry32 seeded from a string)
// ----------------------------------------------------------------------------

export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy; when `avoid` is given, tries not to return that exact order. */
function shuffled<T>(list: T[], random: () => number, avoid?: (order: T[]) => boolean): T[] {
  for (let attempt = 0; attempt < 6; attempt++) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    if (!avoid || copy.length < 2 || !avoid(copy)) return copy;
  }
  return [...list.slice(1), list[0]];
}

const byId = (ids: string[]) => (order: { id: string }[]) => order.every((c, i) => c.id === ids[i]);

// ----------------------------------------------------------------------------
// Display order (authority copy, answers kept)
// ----------------------------------------------------------------------------

/** The item in display order. Answers refer to IDs, so only the lists move. */
export function displayItem(item: OQSEAnyItem, random: () => number): OQSEAnyItem {
  const it = structuredClone(item) as any;
  switch (it.type) {
    case 'mcq-single':
    case 'mcq-multi':
      if (it.shuffle !== false) it.options = shuffled(it.options, random);
      return it;
    case 'fill-in-select':
      for (const blank of Object.values(it.blanks ?? {}) as { options: unknown[]; shuffle?: boolean }[]) {
        if (blank.shuffle !== false) blank.options = shuffled(blank.options, random);
      }
      return it;
    case 'sort-items':
      // Never show the items already sorted.
      it.items = shuffled(it.items, random, byId(it.correctOrder));
      return it;
    case 'match-pairs':
      it.prompts = shuffled(it.prompts, random);
      it.matches = shuffled(it.matches, random);
      return it;
    case 'match-complex':
      it.prompts = shuffled(it.prompts, random);
      it.matches = shuffled(it.matches, random);
      return it;
    case 'timeline':
      // Never in an order that would already be correct.
      if (it.shuffle !== false) it.events = shuffled(it.events, random, (order: TimelineEvent[]) => isTimelineOrderCorrect(order));
      return it;
    case 'categorize':
      it.items = shuffled(it.items, random);
      return it;
    case 'diagram-label':
      if (!it.requireTyping) it.labels = shuffled(it.labels, random);
      return it;
    default:
      return it;
  }
}

// ----------------------------------------------------------------------------
// Public copy (no answers)
// ----------------------------------------------------------------------------

/** A Zod 4 schema, read through its definition (`_zod.def`). */
type SchemaLike = { _zod: { def: any }; safeParse(value: unknown): { success: boolean } };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The option of a union whose `type` literal is the value's `type` (items, hotspots, zones). */
function optionByType(options: SchemaLike[], value: Record<string, unknown>): SchemaLike | undefined {
  return options.find((option) => {
    const field = option._zod.def.shape?.type;
    return field?._zod.def.type === 'literal' && field._zod.def.values.includes(value.type);
  });
}

/**
 * Keeps only what `schema` describes (fail closed): keys an object schema does not list are
 * removed, also in nested objects and lists. A field of a newer OQSE version or a vendor
 * field therefore never reaches a public item (OQSE "Hiding answers safely").
 */
function knownFields(value: unknown, schema: SchemaLike): unknown {
  const def = schema._zod.def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      return value === undefined || value === null ? value : knownFields(value, def.innerType);
    case 'pipe':
      return knownFields(value, def.in);
    case 'lazy':
      return knownFields(value, def.getter());
    case 'object': {
      if (!isPlainObject(value)) return value;
      const kept: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(def.shape as Record<string, SchemaLike>)) {
        if (!(key in value)) continue;
        const known = knownFields(value[key], field);
        if (known !== undefined) kept[key] = known;
      }
      return kept;
    }
    case 'array':
      return Array.isArray(value) ? value.map((entry) => knownFields(entry, def.element)) : value;
    case 'record': {
      if (!isPlainObject(value)) return value;
      if (['unknown', 'any'].includes(def.valueType._zod.def.type)) return undefined; // free-form data
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, knownFields(entry, def.valueType)]));
    }
    case 'intersection':
      return isPlainObject(value) ? { ...(knownFields(value, def.left) as object), ...(knownFields(value, def.right) as object) } : value;
    case 'union': {
      if (!isPlainObject(value) && !Array.isArray(value)) return value;
      const options = def.options as SchemaLike[];
      const option = (isPlainObject(value) && optionByType(options, value)) || options.find((o) => o.safeParse(value).success);
      if (option) return knownFields(value, option);
      return Array.isArray(value) ? [] : {}; // nothing known about it: keep nothing
    }
    case 'unknown':
    case 'any':
      return undefined; // free-form data (appSpecific, customData) may hold anything, also answers
    default:
      return value; // strings, numbers, literals, enums
  }
}

/** Fields that explain or give away the answer, on any item. */
const COMMON_HIDDEN = ['explanation', 'incorrectFeedback'];

const HIDDEN: Record<string, string[]> = {
  note: ['hiddenContent'],
  flashcard: ['back'],
  'true-false': ['correctAnswer'],
  'mcq-single': ['correctId'],
  'mcq-multi': ['correctIds'],
  'short-answer': ['correctAnswers'],
  'sort-items': ['correctOrder'],
  'match-pairs': ['pairs'],
  'match-complex': ['connections'],
  slider: ['correctAnswer'],
  'numeric-input': ['correctAnswer'],
  'math-input': ['correctAnswers'],
  matrix: ['correctCells'],
  'open-ended': ['sampleAnswer', 'rubric'],
  'chess-puzzle': ['correctAnswers'],
};

/** Lists of choices (whose `explanation` tells the answer). */
const CHOICE_LISTS = ['options', 'items', 'prompts', 'matches', 'categories', 'rows', 'columns', 'labels'];

/**
 * The item without its answer. An official type keeps only the fields its OQSE schema lists
 * (fail closed: unknown fields, also nested, are removed, as are free-form `appSpecific` and
 * `customData`), then loses the fields that give the answer away. Custom (`x-`) types keep
 * their own fields and lose only `solution` (where OQSE puts everything that gives their
 * answer away) and the common fields. `hints` stay: a game may show them on any device while
 * the player answers.
 */
export function publicItem(item: OQSEAnyItem): OQSEAnyItem {
  const type = (item as { type: string }).type;
  const it = (type.startsWith('x-') ? structuredClone(item) : knownFields(structuredClone(item), OQSEItemSchema as unknown as SchemaLike)) as any;
  for (const key of COMMON_HIDDEN) delete it[key];
  // A quote from a source often states the answer.
  if (Array.isArray(it.sources)) for (const source of it.sources) if (source && typeof source === 'object') delete source.quote;
  if (type.startsWith('x-')) {
    delete it.solution;
    it.answerHidden = true;
    return it;
  }
  for (const key of HIDDEN[type] ?? []) delete it[key];
  for (const key of CHOICE_LISTS) {
    if (Array.isArray(it[key])) for (const choice of it[key]) if (choice && typeof choice === 'object') delete choice.explanation;
  }
  switch (type) {
    case 'fill-in-blanks':
      it.blanks = Object.fromEntries(Object.keys(it.blanks ?? {}).map((token) => [token, []]));
      break;
    case 'fill-in-select':
      for (const blank of Object.values(it.blanks ?? {}) as Record<string, any>[]) {
        delete blank.correctId;
        for (const choice of blank.options ?? []) delete choice.explanation;
      }
      break;
    case 'categorize':
      for (const entry of it.items ?? []) delete entry.correctCategoryId;
      break;
    case 'timeline':
      for (const event of it.events ?? []) { delete event.date; delete event.precision; }
      break;
    case 'diagram-label':
      for (const zone of it.zones ?? []) delete zone.correctLabelId;
      if (it.requireTyping) it.labels = []; // typed answers: the labels are the answers
      break;
    case 'pin-on-image':
    case 'pin-on-model':
      it.hotspots = [];
      break;
  }
  it.answerHidden = true;
  return it;
}

/**
 * The set of a session: `set` in display order with answers (the authority,
 * solo), `publicSet` without answers (the other instances in multiplayer).
 * Without a seed nothing is shuffled.
 */
export function prepareDisplaySet(set: DisplaySet, seed?: string): { set: DisplaySet; publicSet: DisplaySet } {
  const random = seed === undefined ? null : seededRandom(seed);
  const items = set.items.map((item) => (random ? displayItem(item, random) : structuredClone(item)));
  return { set: { meta: set.meta, items }, publicSet: { meta: set.meta, items: items.map(publicItem) } };
}
