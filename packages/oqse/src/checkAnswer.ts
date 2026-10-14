/**
 * `checkAnswer(item, answer)` – evaluates a learner's answer by "Answer Formats" in the
 * OQSE specification (reference implementation), so every application grades the same way.
 *
 * Answer formats and when an answer is correct are normative: "Answer Formats" in the
 * OQSE specification (choices are referenced by their `id`; also listed in the AI guide):
 *  mcq-single: option id · mcq-multi: array of option ids · true-false: boolean
 *  short-answer: text · numeric-input / slider: number (or numeric text)
 *  math-input: LaTeX text · sort-items: item ids in the player's order
 *  match-pairs: { promptId: matchId } · match-complex: array of [leftId, rightId]
 *  matrix: array of [rowId, columnId] · fill-in-blanks: { token: text }
 *  fill-in-select: { token: option id } · categorize: { entryId: categoryId }
 *  timeline: event ids in order · pin-on-image: { x, y } in % (array when multipleCorrect)
 *  diagram-label: { zoneId: labelId } (or { zoneId: text } with requireTyping)
 *  pin-on-model: mesh name (array when multipleCorrect)
 *  chess-puzzle: array of SAN moves (the player's moves and the replies)
 *  flashcard: self-rating 1–4 (OQSEP confidence; correct when 3 or 4)
 *
 * Typed text is compared by "Comparing Typed Answers" (`textAnswerMatches`).
 *
 * `note`, `open-ended` and custom `x-` types cannot be checked
 * automatically; calling `checkAnswer` on them throws.
 */

import { isTimelineOrderCorrect, textAnswerMatches } from './answers';
import type { Hotspot2D, OQSEAnyItem, TimelineEvent } from './oqse';

export function checkAnswer(item: OQSEAnyItem, answer: unknown): boolean {
  if (!item || typeof item !== 'object') throw new Error('checkAnswer: missing item');

  switch (item.type) {
    case 'mcq-single':
      return answer === item.correctId;

    case 'mcq-multi': {
      const chosen = stringArray(answer);
      return chosen !== null && sameSet(chosen, item.correctIds);
    }

    case 'true-false':
      return toBoolean(answer) === item.correctAnswer;

    case 'short-answer': {
      const typed = answer;
      return typeof typed === 'string' && item.correctAnswers.some((accepted) => textAnswerMatches(typed, accepted, item));
    }

    case 'numeric-input': {
      const value = toNumber(answer);
      return value !== null && Math.abs(value - item.correctAnswer) <= (item.tolerance ?? 0) + 1e-9;
    }

    case 'slider': {
      const value = toNumber(answer);
      return value !== null && Math.abs(value - item.correctAnswer) <= (item.tolerance ?? 0) + 1e-9;
    }

    case 'math-input': {
      if (typeof answer !== 'string') return false;
      const given = normalizeLatex(answer);
      return item.correctAnswers.some((correct) => normalizeLatex(correct) === given);
    }

    case 'sort-items': {
      const order = stringArray(answer);
      return order !== null && order.length === item.correctOrder.length && order.every((id, i) => id === item.correctOrder[i]);
    }

    case 'match-pairs': {
      const mapping = record(answer);
      return !!mapping && item.prompts.every((prompt) => mapping[prompt.id] === item.pairs[prompt.id]);
    }

    case 'match-complex': {
      const pairs = pairArray(answer);
      if (!pairs) return false;
      const correct = new Set(item.connections.map(([l, r]) => pairKey(l, r)));
      const given = new Set(pairs.map(([l, r]) => pairKey(l, r)));
      const hits = [...given].filter((pair) => correct.has(pair)).length;
      return hits === given.size && hits >= (item.minCorrect ?? correct.size);
    }

    case 'matrix': {
      const cells = pairArray(answer);
      if (!cells) return false;
      return sameSet(cells.map(([r, c]) => pairKey(r, c)), item.correctCells.map(([r, c]) => pairKey(r, c)));
    }

    case 'fill-in-blanks': {
      const values = record(answer);
      if (!values) return false;
      return Object.entries(item.blanks).every(([token, accepted]) => {
        const typed = values[token];
        return typeof typed === 'string' && accepted.some((a) => textAnswerMatches(typed, a, item));
      });
    }

    case 'fill-in-select': {
      const values = record(answer);
      return !!values && Object.entries(item.blanks).every(([token, blank]) => values[token] === blank.correctId);
    }

    case 'categorize': {
      const values = record(answer);
      return !!values && item.items.every((entry) => values[entry.id] === entry.correctCategoryId);
    }

    case 'timeline': {
      // Every event once, in a chronological order (simultaneous events in any order).
      const ids = stringArray(answer);
      if (!ids || ids.length !== item.events.length || new Set(ids).size !== ids.length) return false;
      const events = ids.map((id) => item.events.find((event) => event.id === id));
      return events.every((event) => !!event) && isTimelineOrderCorrect(events as TimelineEvent[]);
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
      return item.zones.every((zone) => {
        const given = values[zone.id];
        if (item.requireTyping) {
          const label = item.labels.find((l) => l.id === zone.correctLabelId);
          return !!label && typeof given === 'string' && textAnswerMatches(given, label.text, item);
        }
        return given === zone.correctLabelId;
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

    case 'flashcard': {
      // A self-rating on the OQSEP confidence scale: 3 and 4 mean recalled.
      const rating = toNumber(answer);
      return rating === 3 || rating === 4;
    }

    case 'note':
    case 'open-ended':
      throw new Error(`checkAnswer: "${item.type}" items cannot be checked automatically.`);

    default:
      throw new Error(`checkAnswer: unsupported item type "${item.type}".`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}

function pairArray(value: unknown): [string, string][] | null {
  if (!Array.isArray(value)) return null;
  return value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string')
    ? (value as [string, string][])
    : null;
}

const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === a.length && sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** Whitespace-insensitive, without `$` delimiters (OQSE math-input string comparison). */
function normalizeLatex(text: string): string {
  return text.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/\s+/g, '');
}

/** SAN as the OQSE specification compares it: no check/annotation marks, `O-O` castling, `e8=Q` promotions. */
function normalizeSan(move: string): string {
  return move
    .trim()
    .replace(/[+#!?]+$/g, '')
    .replace(/^0-0(-0)?$/, (castling) => castling.replace(/0/g, 'O'))
    .replace(/^([a-h](?:x[a-h])?[18])([QRBN])$/, '$1=$2');
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
