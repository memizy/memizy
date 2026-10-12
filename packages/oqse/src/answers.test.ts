import { describe, it, expect } from 'vitest';
import { allowedTypos, compareTimelineEvents, editDistance, isTimelineDate, isTimelineOrderCorrect, normalizeAnswerText, textAnswerMatches } from './answers';

describe('normalizeAnswerText', () => {
  it('trims and collapses whitespace, lowercases and removes diacritics by default', () => {
    expect(normalizeAnswerText('  Plzeň \t  Město\n')).toBe('plzen mesto');
    expect(normalizeAnswerText('Plzeň', { caseSensitive: true, ignoreDiacritics: false })).toBe('Plzeň');
  });

  it('works on decomposed input and keeps letters that do not decompose', () => {
    expect(normalizeAnswerText('Plzeň')).toBe('plzen'); // n + combining caron
    expect(normalizeAnswerText('Łódź Øresund đ Straße')).toBe('łodz øresund đ straße');
  });
});

describe('textAnswerMatches', () => {
  it('compares after normalization', () => {
    expect(textAnswerMatches(' plzen ', 'Plzeň')).toBe(true);
    expect(textAnswerMatches('plzen', 'Plzeň', { ignoreDiacritics: false })).toBe(false);
    expect(textAnswerMatches('PRAHA', 'Praha')).toBe(true);
    expect(textAnswerMatches('praha', 'Praha', { caseSensitive: true })).toBe(false);
  });

  it('accepts typos with acceptPartial: none up to 3 code points, 1 up to 7, then 2', () => {
    const partial = { acceptPartial: true };
    expect(textAnswerMatches('car', 'cat', partial)).toBe(false);
    expect(textAnswerMatches('Prahha', 'Praha', partial)).toBe(true);
    expect(textAnswerMatches('Prahhaa', 'Praha', partial)).toBe(false);
    expect(textAnswerMatches('Mississipi', 'Mississippi', partial)).toBe(true);
    expect(textAnswerMatches('Brno', 'Praha', partial)).toBe(false);
    expect(textAnswerMatches('Prahha', 'Praha')).toBe(false); // without acceptPartial
  });

  it('counts a transposition of two adjacent letters as one edit', () => {
    expect(textAnswerMatches('Plzne', 'Plzeň', { acceptPartial: true })).toBe(true);
    expect(textAnswerMatches('Plnze', 'Plzeň', { acceptPartial: true })).toBe(false);
  });
});

describe('editDistance (optimal string alignment)', () => {
  it('counts insertions, deletions, substitutions and adjacent transpositions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('ab', 'ba')).toBe(1);
    expect(editDistance('ca', 'abc')).toBe(3); // no part is edited twice
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('😀a', 'a😀')).toBe(1); // code points, not UTF-16 units
  });

  it('allowedTypos depends on the length of the accepted answer', () => {
    expect([allowedTypos('abc'), allowedTypos('abcd'), allowedTypos('abcdefg'), allowedTypos('abcdefgh')]).toEqual([0, 1, 1, 2]);
  });
});

describe('timeline events', () => {
  const ev = (date: string, precision?: 'year' | 'month' | 'day' | 'datetime') => ({ date, precision });

  it('accepts years before the Common Era in historical numbering, without year 0', () => {
    expect(isTimelineDate('-0480-08-01')).toBe(true);
    expect(isTimelineDate('-0001-12-31')).toBe(true);
    expect(isTimelineDate('0000-01-01')).toBe(false);
    expect(isTimelineDate('-0000-01-01')).toBe(false);
    expect(isTimelineDate('1969-07-20T20:17:40Z')).toBe(true);
    expect(isTimelineDate('20/07/1969')).toBe(false);
  });

  it('orders years before the Common Era: 1 BC is directly followed by AD 1', () => {
    expect(compareTimelineEvents(ev('-0480-08-01'), ev('-0044-03-15'))).toBe(-1);
    expect(compareTimelineEvents(ev('-0001-12-31'), ev('0001-01-01'))).toBe(-1);
    expect(compareTimelineEvents(ev('-0001-12-31', 'year'), ev('0001-01-01', 'year'))).toBe(-1);
    expect(compareTimelineEvents(ev('0476-09-04'), ev('1969-07-20'))).toBe(-1);
  });

  it('compares at the coarser precision; without precision: day, or datetime with a time', () => {
    expect(compareTimelineEvents(ev('1969-01-01', 'year'), ev('1969-07-20'))).toBe(0);
    expect(compareTimelineEvents(ev('1969-07-01', 'month'), ev('1969-07-20'))).toBe(0);
    expect(compareTimelineEvents(ev('1969-07-20'), ev('1969-07-20T20:17:40Z'))).toBe(0);
    expect(compareTimelineEvents(ev('1969-07-20T10:00:00Z'), ev('1969-07-20T20:17:40Z'))).toBe(-1);
  });

  it('applies time zones; a time without a zone is UTC', () => {
    expect(compareTimelineEvents(ev('2025-01-01T10:00:00+02:00'), ev('2025-01-01T09:00:00Z'))).toBe(-1);
    expect(compareTimelineEvents(ev('2025-01-01T09:00:00'), ev('2025-01-01T09:00:00Z'))).toBe(0);
  });

  it('checks every pair, not only neighbours', () => {
    const year = ev('1969-01-01', 'year');
    const december = ev('1969-12-01');
    const march = ev('1969-03-01');
    expect(isTimelineOrderCorrect([march, year, december])).toBe(true);
    expect(isTimelineOrderCorrect([year, march, december])).toBe(true);
    expect(isTimelineOrderCorrect([december, year, march])).toBe(false);
  });
});
