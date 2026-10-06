/**
 * `checkAnswer(item, answer)` – evaluates a player's answer according to the
 * rules of the OQSE specification, so every plugin grades the same way.
 *
 * Answer formats (also listed in the AI guide):
 *  mcq-single: option index · mcq-multi: array of indices · true-false: boolean
 *  short-answer: text · numeric-input / slider: number (or numeric text)
 *  math-input: LaTeX text · sort-items: indices of `items` in the player's order
 *  match-pairs: for each prompt the index of the chosen match
 *
 * Indices refer to the lists as the plugin gets them. The host shuffles them once
 * per session (SPEC 4.4); for sort-items, match-pairs and timeline the right
 * order is then in `correctOrder` / `correctMatches` (otherwise the listed order).
 *  match-complex: array of [left, right] pairs · matrix: array of [row, column]
 *  fill-in-blanks: { token: text } · fill-in-select: { token: option index }
 *  categorize: { entryId: category index } · timeline: event ids in order
 *  pin-on-image: { x, y } in % (array of points when multipleCorrect)
 *  diagram-label: { zoneIndex: labelIndex } (or { zoneIndex: text } with requireTyping)
 *  pin-on-model: mesh name (array when multipleCorrect) · chess-puzzle: array of SAN moves
 *
 * `flashcard`, `note`, `open-ended` and custom `x-` types cannot be checked
 * automatically; calling `checkAnswer` on them throws.
 */

import type { Hotspot2D, OQSEAnyItem } from '@memizy/oqse';

export function checkAnswer(item: OQSEAnyItem, answer: unknown): boolean {
  if (!item || typeof item !== 'object') throw new Error('checkAnswer: missing item');
  if ((item as { answerHidden?: boolean }).answerHidden) {
    throw new Error(`checkAnswer: this device has item "${item.id}" without its answer. Check answers in actions (they run on the authority), or show them after ctx.reveal().`);
  }

  switch (item.type) {
    case 'mcq-single':
      return toInt(answer) === item.correctIndex;

    case 'mcq-multi': {
      const chosen = intArray(answer);
      return chosen !== null && sameSet(chosen, item.correctIndices);
    }

    case 'true-false':
      return toBoolean(answer) === item.correctAnswer;

    case 'short-answer': {
      if (typeof answer !== 'string') return false;
      const opts = { caseSensitive: item.caseSensitive ?? false, trim: item.trimWhitespace ?? true, diacritics: item.ignoreDiacritics ?? false };
      const given = normalizeText(answer, opts);
      return item.correctAnswers.some((correct) => {
        const expected = normalizeText(correct, opts);
        return given === expected || (!!item.acceptPartial && withinTypoTolerance(given, expected));
      });
    }

    case 'numeric-input': {
      const value = toNumber(answer);
      if (value === null) return false;
      if (item.range) return value >= item.range.min && value <= item.range.max;
      return Math.abs(value - item.correctAnswer) <= (item.tolerance ?? 0) + 1e-9;
    }

    case 'slider': {
      const value = toNumber(answer);
      return value !== null && Math.abs(value - item.correctAnswer) <= (item.tolerance ?? 0) + 1e-9;
    }

    case 'math-input': {
      if (typeof answer !== 'string') return false;
      const given = normalizeLatex(answer);
      return [item.correctAnswer, ...(item.alternativeAnswers ?? [])].some((correct) => normalizeLatex(correct) === given);
    }

    case 'sort-items': {
      const order = intArray(answer);
      const target = (item as { correctOrder?: number[] }).correctOrder ?? item.items.map((_, i) => i);
      return order !== null && order.length === item.items.length && order.every((value, i) => value === target[i]);
    }

    case 'match-pairs': {
      const mapping = intArray(answer);
      const target = (item as { correctMatches?: number[] }).correctMatches ?? item.prompts.map((_, i) => i);
      return mapping !== null && mapping.length === item.prompts.length && mapping.every((value, i) => value === target[i]);
    }

    case 'match-complex': {
      const pairs = pairArray(answer);
      if (!pairs) return false;
      const correct = new Set(item.connections.map(([l, r]) => `${l}:${r}`));
      const given = new Set(pairs.map(([l, r]) => `${l}:${r}`));
      const hits = [...given].filter((pair) => correct.has(pair)).length;
      return hits === given.size && hits >= (item.minCorrect ?? correct.size);
    }

    case 'matrix': {
      const cells = pairArray(answer);
      if (!cells) return false;
      return sameSet(cells.map(([r, c]) => `${r}:${c}`), item.correctCells.map(([r, c]) => `${r}:${c}`));
    }

    case 'fill-in-blanks': {
      const values = record(answer);
      if (!values) return false;
      const opts = { caseSensitive: item.caseSensitive ?? false, trim: item.trimWhitespace ?? true, diacritics: false };
      return Object.entries(item.blanks).every(([token, accepted]) => {
        const given = values[token];
        return typeof given === 'string' && accepted.some((a) => normalizeText(a, opts) === normalizeText(given, opts));
      });
    }

    case 'fill-in-select': {
      const values = record(answer);
      return !!values && Object.entries(item.blanks).every(([token, blank]) => toInt(values[token]) === blank.correctIndex);
    }

    case 'categorize': {
      const values = record(answer);
      return !!values && item.items.every((entry) => toInt(values[entry.id]) === entry.correctCategoryIndex);
    }

    case 'timeline': {
      if (!Array.isArray(answer) || answer.length !== item.events.length) return false;
      const target = (item as { correctOrder?: string[] }).correctOrder ?? item.events.map((event) => event.id);
      return target.every((id, i) => answer[i] === id);
    }

    case 'pin-on-image': {
      const points = (Array.isArray(answer) ? answer : [answer]).map(toPoint);
      if (points.length === 0 || points.some((p) => p === null)) return false;
      if (!item.multipleCorrect) return points.length === 1 && item.hotspots.some((h) => insideHotspot(points[0]!, h));
      const hit = new Set<number>();
      for (const point of points) {
        const index = item.hotspots.findIndex((h) => insideHotspot(point!, h));
        if (index === -1) return false;
        hit.add(index);
      }
      return hit.size >= (item.minCorrect ?? item.hotspots.length);
    }

    case 'diagram-label': {
      const values = record(answer);
      if (!values) return false;
      const caseSensitive = item.caseSensitive ?? false;
      return item.zones.every((zone, index) => {
        const given = values[index];
        if (item.requireTyping) {
          const opts = { caseSensitive, trim: true, diacritics: false };
          return typeof given === 'string' && normalizeText(given, opts) === normalizeText(item.labels[zone.correctLabelIndex], opts);
        }
        return toInt(given) === zone.correctLabelIndex;
      });
    }

    case 'pin-on-model': {
      const names = (Array.isArray(answer) ? answer : [answer]).filter((n): n is string => typeof n === 'string');
      if (names.length === 0) return false;
      const matches = (name: string) => item.hotspots.findIndex((h) => name.toLowerCase().includes(h.targetName.toLowerCase()));
      if (!item.multipleCorrect) return names.length === 1 && matches(names[0]) !== -1;
      const hit = new Set<number>();
      for (const name of names) {
        const index = matches(name);
        if (index === -1) return false;
        hit.add(index);
      }
      return hit.size >= (item.minCorrect ?? item.hotspots.length);
    }

    case 'chess-puzzle': {
      if (!Array.isArray(answer) || answer.some((m) => typeof m !== 'string')) return false;
      const given = (answer as string[]).map(normalizeSan);
      return item.correctAnswers.some((line) => line.length === given.length && line.every((move, i) => normalizeSan(move) === given[i]));
    }

    case 'flashcard':
    case 'note':
    case 'open-ended':
      throw new Error(`checkAnswer: "${item.type}" items cannot be checked automatically (let the player rate themselves).`);

    default:
      throw new Error(`checkAnswer: unsupported item type "${item.type}".`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toInt(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Locale input: decimal comma, spaces as thousand separators (OQSE numeric-input rules).
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(normalized)) return null;
  return Number(normalized);
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function intArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ints = value.map(toInt);
  return ints.every((n) => n !== null) ? (ints as number[]) : null;
}

function pairArray(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const pairs = value.map((pair) => (Array.isArray(pair) && pair.length === 2 ? intArray(pair) : null));
  return pairs.every((p) => p !== null) ? (pairs as [number, number][]) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === a.length && sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

function normalizeText(text: string, opts: { caseSensitive: boolean; trim: boolean; diacritics: boolean }): string {
  let result = text.normalize('NFC');
  if (opts.trim) result = result.trim().replace(/\s+/g, ' ');
  if (!opts.caseSensitive) result = result.toLowerCase();
  if (opts.diacritics) result = result.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return result;
}

/** Typo tolerance for `acceptPartial`: exact up to 3 characters, 1 edit up to 7, otherwise 2. */
function withinTypoTolerance(given: string, expected: string): boolean {
  const allowed = expected.length <= 3 ? 0 : expected.length <= 7 ? 1 : 2;
  return allowed > 0 && levenshtein(given, expected, allowed) <= allowed;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Whitespace-insensitive, without `$` delimiters (OQSE math-input string comparison). */
function normalizeLatex(text: string): string {
  return text.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/\s+/g, '');
}

/** SAN without check/annotation marks. */
function normalizeSan(move: string): string {
  return move.trim().replace(/[+#!?]+$/g, '');
}

function toPoint(value: unknown): { x: number; y: number } | null {
  const p = record(value);
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
}

function insideHotspot(point: { x: number; y: number }, hotspot: Hotspot2D): boolean {
  switch (hotspot.type) {
    case 'rect':
      return point.x >= hotspot.x && point.x <= hotspot.x + hotspot.width && point.y >= hotspot.y && point.y <= hotspot.y + hotspot.height;
    case 'circle':
      return (point.x - hotspot.x) ** 2 + (point.y - hotspot.y) ** 2 <= hotspot.radius ** 2;
    case 'polygon': {
      let inside = false;
      const pts = hotspot.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const crosses = pts[i].y > point.y !== pts[j].y > point.y;
        if (crosses && point.x < ((pts[j].x - pts[i].x) * (point.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
      }
      return inside;
    }
  }
}
