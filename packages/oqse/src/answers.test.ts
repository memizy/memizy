import { describe, it, expect } from 'vitest';
import { allowedTypos, editDistance, normalizeAnswerText, textAnswerMatches } from './answers';

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
