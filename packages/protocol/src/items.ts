/**
 * Study items as the instances of a session see them (SPEC section 4.4).
 *
 * 1. Display order: the host shuffles options, pairs, events… once per session
 *    (the same order on every device, so a board and the phones agree). The
 *    authority gets the full item in this order: answers are remapped, and the
 *    types whose answer is the order itself carry it in an extra field
 *    (`correctOrder`, `correctMatches`).
 * 2. Public items: in multiplayer, the other instances get the same items
 *    without anything that gives the answer away (`answerHidden: true`). The
 *    authority shows answers with `ctx.reveal` (plugin SDK).
 *
 * Pure functions, so a future server-side authority can do exactly the same.
 */

import type { OQSEAnyItem, OQSEMeta } from '@memizy/oqse';

/** Extra fields of an item in display order (only on the authority's copy). */
export interface DisplayAnswerFields {
  /** sort-items: indices of `items` in the correct order. timeline: event ids in order. */
  correctOrder?: number[] | string[];
  /** match-pairs: for each prompt, the index of its match in `matches`. */
  correctMatches?: number[];
}

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

/** A random permutation: `perm[displayIndex] = originalIndex`. Never the identity when it can avoid it. */
function permutation(length: number, random: () => number, avoidIdentity = false): number[] {
  const base = Array.from({ length }, (_, i) => i);
  for (let attempt = 0; attempt < 6; attempt++) {
    const perm = [...base];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    if (!avoidIdentity || length < 2 || perm.some((v, i) => v !== i)) return perm;
  }
  return [...base.slice(1), 0];
}

const inverse = (perm: number[]): number[] => {
  const inv: number[] = [];
  perm.forEach((original, display) => (inv[original] = display));
  return inv;
};
const pick = <T>(list: T[], perm: number[]): T[] => perm.map((i) => list[i]);

// ----------------------------------------------------------------------------
// Display order (authority copy, answers kept)
// ----------------------------------------------------------------------------

/** The item in display order with its answers remapped. Items that must not be shuffled stay as they are. */
export function displayItem(item: OQSEAnyItem, random: () => number): OQSEAnyItem {
  const it = structuredClone(item) as any;
  switch (it.type) {
    case 'mcq-single':
    case 'mcq-multi': {
      if (it.shuffle === false || !Array.isArray(it.options)) return it;
      const perm = permutation(it.options.length, random);
      const inv = inverse(perm);
      it.options = pick(it.options, perm);
      if (Array.isArray(it.optionExplanations) && it.optionExplanations.length === perm.length) it.optionExplanations = pick(it.optionExplanations, perm);
      if (it.type === 'mcq-single') it.correctIndex = inv[it.correctIndex];
      else it.correctIndices = (it.correctIndices as number[]).map((i) => inv[i]).sort((a, b) => a - b);
      return it;
    }
    case 'fill-in-select': {
      for (const blank of Object.values(it.blanks ?? {}) as { options: string[]; correctIndex: number; shuffle?: boolean }[]) {
        if (blank.shuffle === false || !Array.isArray(blank.options)) continue;
        const perm = permutation(blank.options.length, random);
        blank.correctIndex = inverse(perm)[blank.correctIndex];
        blank.options = pick(blank.options, perm);
      }
      return it;
    }
    case 'sort-items': {
      // OQSE: the items are listed in the correct order and the application must shuffle them.
      const perm = permutation(it.items.length, random, true);
      it.items = pick(it.items, perm);
      it.correctOrder = inverse(perm);
      return it;
    }
    case 'match-pairs': {
      const p = permutation(it.prompts.length, random);
      const m = permutation(it.matches.length, random, true);
      const mInv = inverse(m);
      it.prompts = pick(it.prompts, p);
      it.matches = pick(it.matches, m);
      it.correctMatches = p.map((original) => mInv[original]);
      return it;
    }
    case 'match-complex': {
      const l = permutation(it.leftItems.length, random);
      const r = permutation(it.rightItems.length, random);
      const lInv = inverse(l), rInv = inverse(r);
      it.leftItems = pick(it.leftItems, l);
      it.rightItems = pick(it.rightItems, r);
      it.connections = (it.connections as [number, number][]).map(([a, b]) => [lInv[a], rInv[b]]);
      return it;
    }
    case 'timeline': {
      it.correctOrder = (it.events as { id: string }[]).map((e) => e.id);
      if (it.shuffle !== false) it.events = pick(it.events, permutation(it.events.length, random, true));
      return it;
    }
    case 'categorize': {
      it.items = pick(it.items, permutation(it.items.length, random)); // answers are keyed by entry id
      return it;
    }
    case 'diagram-label': {
      if (it.requireTyping) return it;
      const perm = permutation(it.labels.length, random);
      const inv = inverse(perm);
      it.labels = pick(it.labels, perm);
      for (const zone of it.zones) zone.correctLabelIndex = inv[zone.correctLabelIndex];
      return it;
    }
    default:
      return it;
  }
}

// ----------------------------------------------------------------------------
// Public copy (no answers)
// ----------------------------------------------------------------------------

/** Fields that explain or give away the answer, on any item. */
const COMMON_HIDDEN = ['explanation', 'incorrectFeedback', 'optionExplanations'];

const HIDDEN: Record<string, string[]> = {
  note: ['hiddenContent'],
  flashcard: ['back'],
  'true-false': ['correctAnswer'],
  'mcq-single': ['correctIndex'],
  'mcq-multi': ['correctIndices'],
  'short-answer': ['correctAnswers'],
  'sort-items': ['correctOrder'],
  'match-pairs': ['correctMatches'],
  'match-complex': ['connections'],
  slider: ['correctAnswer'],
  'numeric-input': ['correctAnswer', 'range'],
  'math-input': ['correctAnswer', 'alternativeAnswers'],
  matrix: ['correctCells'],
  timeline: ['correctOrder'],
  'open-ended': ['sampleAnswer', 'rubric'],
  'chess-puzzle': ['correctAnswers'],
};

/**
 * The item without its answer. Custom (`x-`) types are passed unchanged: the
 * host cannot know which of their fields are answers.
 */
export function publicItem(item: OQSEAnyItem): OQSEAnyItem {
  const type = (item as { type: string }).type;
  if (type.startsWith('x-')) return structuredClone(item);
  const it = structuredClone(item) as any;
  for (const key of [...COMMON_HIDDEN, ...(HIDDEN[type] ?? [])]) delete it[key];
  switch (type) {
    case 'fill-in-blanks':
      it.blanks = Object.fromEntries(Object.keys(it.blanks ?? {}).map((token) => [token, []]));
      break;
    case 'fill-in-select':
      for (const blank of Object.values(it.blanks ?? {}) as Record<string, unknown>[]) delete blank.correctIndex;
      break;
    case 'categorize':
      for (const entry of it.items ?? []) delete entry.correctCategoryIndex;
      break;
    case 'timeline':
      for (const event of it.events ?? []) { delete event.date; delete event.precision; }
      break;
    case 'diagram-label':
      for (const zone of it.zones ?? []) delete zone.correctLabelIndex;
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
