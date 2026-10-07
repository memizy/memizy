/**
 * Study items as the instances of a session see them (SPEC section 4.4).
 *
 * 1. Display order: the host shuffles options, items to sort, pairs, events… once per
 *    session (the same order on every device, so a board and the phones agree). OQSE 0.3
 *    answers refer to choice IDs, so shuffling never changes an answer.
 * 2. Public items: in multiplayer, the other instances get the same items without
 *    anything that gives the answer away (`answerHidden: true`). The authority shows
 *    answers with `ctx.reveal` (plugin SDK).
 *
 * Pure functions, so a future server-side authority can do exactly the same.
 */

import type { OQSEAnyItem, OQSEMeta } from '@memizy/oqse';

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
      it.leftItems = shuffled(it.leftItems, random);
      it.rightItems = shuffled(it.rightItems, random);
      return it;
    case 'timeline':
      if (it.shuffle !== false) {
        const chronological = [...it.events].sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)).map((e: { id: string }) => e.id);
        it.events = shuffled(it.events, random, byId(chronological));
      }
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
  'numeric-input': ['correctAnswer', 'range'],
  'math-input': ['correctAnswer', 'alternativeAnswers'],
  matrix: ['correctCells'],
  'open-ended': ['sampleAnswer', 'rubric'],
  'chess-puzzle': ['correctAnswers'],
};

/** Lists of choices (whose `explanation` tells the answer). */
const CHOICE_LISTS = ['options', 'items', 'prompts', 'matches', 'leftItems', 'rightItems', 'categories', 'rows', 'columns', 'labels'];

/**
 * The item without its answer. Custom (`x-`) types are passed unchanged: the
 * host cannot know which of their fields are answers.
 */
export function publicItem(item: OQSEAnyItem): OQSEAnyItem {
  const type = (item as { type: string }).type;
  if (type.startsWith('x-')) return structuredClone(item);
  const it = structuredClone(item) as any;
  for (const key of [...COMMON_HIDDEN, ...(HIDDEN[type] ?? [])]) delete it[key];
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
