/**
 * Reference implementation of checking answers in the OQSE specification: "Comparing
 * Typed Answers" (`short-answer`, `fill-in-blanks`, typed `diagram-label`) and the
 * comparison of timeline events ("TimelineEvent"). The specification is normative;
 * these functions follow it step by step.
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

// ============================================================================
// Timeline events ("TimelineEvent" in the specification)
// ============================================================================

const TIMELINE_DATE_RE = /^(-?)(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?)?$/;

const PRECISION_RANK = { year: 0, month: 1, day: 2, datetime: 3 } as const;

type TimelinePrecisionName = keyof typeof PRECISION_RANK;

interface TimelineEventLike {
  date: string;
  precision?: TimelinePrecisionName;
}

interface ParsedTimelineDate {
  /** Historical year: negative before the Common Era, never 0. */
  year: number;
  month: number;
  /** Days since 1970-01-01 (proleptic Gregorian arithmetic on the written date). */
  days: number;
  /** Milliseconds since 1970-01-01T00:00:00Z; a time without a zone is UTC. */
  instant: number;
  hasTime: boolean;
}

function parseTimelineDate(date: string): ParsedTimelineDate | null {
  const m = TIMELINE_DATE_RE.exec(date);
  if (!m) return null;
  const year = (m[1] ? -1 : 1) * Number(m[2]);
  if (year === 0) return null;
  const month = Number(m[3]);
  // Historical numbering has no year 0: 1 BC (-1) is astronomical year 0.
  const days = daysFromCivil(year < 0 ? year + 1 : year, month, Number(m[4]));
  const hasTime = m[5] !== undefined;
  let ms = 0;
  if (hasTime) {
    ms = ((Number(m[5]) * 60 + Number(m[6])) * 60 + Number(m[7])) * 1000 + Number((m[8] ?? '0').padEnd(3, '0'));
    const zone = m[9];
    if (zone && zone !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      ms -= sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
    }
  }
  return { year, month, days, instant: days * 86_400_000 + ms, hasTime };
}

/** Days since 1970-01-01 for an astronomical year (works before the Common Era). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Whether a string is a valid timeline event date (also before the Common Era, never year 0). */
export function isTimelineDate(date: string): boolean {
  return parseTimelineDate(date) !== null;
}

/**
 * Compares two timeline events at the coarser of their precisions (without
 * `precision`: `datetime` if the date has a time, otherwise `day`). Returns a negative
 * number if `a` is earlier, 0 if they are simultaneous, a positive number if `a` is later.
 */
export function compareTimelineEvents(a: TimelineEventLike, b: TimelineEventLike): number {
  const pa = parseTimelineDate(a.date);
  const pb = parseTimelineDate(b.date);
  if (!pa || !pb) throw new Error(`Invalid timeline date: ${!pa ? a.date : b.date}`);
  const rank = (p: ParsedTimelineDate, declared?: TimelinePrecisionName) => PRECISION_RANK[declared ?? (p.hasTime ? 'datetime' : 'day')];
  const precision = Math.min(rank(pa, a.precision), rank(pb, b.precision));
  if (precision === PRECISION_RANK.year) return Math.sign(pa.year - pb.year);
  if (precision === PRECISION_RANK.month) return Math.sign(pa.year - pb.year || pa.month - pb.month);
  if (precision === PRECISION_RANK.day) return Math.sign(pa.days - pb.days);
  return Math.sign(pa.instant - pb.instant);
}

/**
 * Whether events are in a correct chronological order: for every pair, the one placed
 * first is earlier than or simultaneous with the other.
 */
export function isTimelineOrderCorrect(events: readonly TimelineEventLike[]): boolean {
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (compareTimelineEvents(events[i], events[j]) > 0) return false;
    }
  }
  return true;
}
