/**
 * Reference implementation of "Comparing Typed Answers" in the OQSE specification
 * (`short-answer`, `fill-in-blanks`, typed `diagram-label`). The specification is
 * normative; these functions follow it step by step.
 */

export interface TextComparisonOptions {
  /** Distinguish letter case. Default: false */
  caseSensitive?: boolean;
  /** Ignore diacritics ("Plzen" matches "Plzeň"). Default: true */
  ignoreDiacritics?: boolean;
  /** Accept small typos. Default: false */
  acceptPartial?: boolean;
}

/**
 * Normalizes a typed or accepted answer: NFC, whitespace trimmed and collapsed,
 * lowercase (unless `caseSensitive`), without diacritics (unless `ignoreDiacritics: false`).
 */
export function normalizeAnswerText(text: string, options: TextComparisonOptions = {}): string {
  let result = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!options.caseSensitive) result = result.toLowerCase();
  if (options.ignoreDiacritics ?? true) result = result.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return result;
}

/** Edits `acceptPartial` allows for an accepted answer of this length (after normalization). */
export function allowedTypos(normalizedAccepted: string): number {
  const length = [...normalizedAccepted].length;
  return length <= 3 ? 0 : length <= 7 ? 1 : 2;
}

/** Whether a typed answer matches an accepted one (see "Comparing Typed Answers"). */
export function textAnswerMatches(typed: string, accepted: string, options: TextComparisonOptions = {}): boolean {
  const a = normalizeAnswerText(typed, options);
  const b = normalizeAnswerText(accepted, options);
  if (a === b) return true;
  if (!options.acceptPartial) return false;
  const allowed = allowedTypos(b);
  return allowed > 0 && editDistance(a, b, allowed) <= allowed;
}

/**
 * Optimal string alignment distance (restricted Damerau–Levenshtein) in Unicode code
 * points: insertions, deletions, substitutions and transpositions of two adjacent code
 * points. Stops early and returns `max + 1` when the distance is surely above `max`.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) value = Math.min(value, before[j - 2] + 1);
      row[j] = value;
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = row;
  }
  return prev[y.length];
}
