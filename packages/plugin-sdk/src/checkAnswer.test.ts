import { describe, it, expect } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { checkAnswer } from './checkAnswer';

const item = (data: Record<string, unknown>) => ({ id: 'x', ...data }) as unknown as OQSEAnyItem;
/** Choices with the given IDs (text = ID). */
const ch = (...ids: string[]) => ids.map((id) => ({ id, text: id }));

describe('checkAnswer', () => {
  it('choice types', () => {
    const mcq = item({ type: 'mcq-single', question: 'Q', options: ch('a', 'b'), correctId: 'b' });
    expect(checkAnswer(mcq, 'b')).toBe(true);
    expect(checkAnswer(mcq, 'a')).toBe(false);
    expect(checkAnswer(mcq, 1)).toBe(false); // positions are not answers in OQSE 0.3
    expect(checkAnswer(mcq, undefined)).toBe(false);

    const multi = item({ type: 'mcq-multi', question: 'Q', options: ch('a', 'b', 'c'), correctIds: ['a', 'c'] });
    expect(checkAnswer(multi, ['c', 'a'])).toBe(true);
    expect(checkAnswer(multi, ['a'])).toBe(false);
    expect(checkAnswer(multi, ['a', 'c', 'c'])).toBe(false);

    const tf = item({ type: 'true-false', question: 'Q', correctAnswer: false });
    expect(checkAnswer(tf, false)).toBe(true);
    expect(checkAnswer(tf, 'false')).toBe(true);
    expect(checkAnswer(tf, true)).toBe(false);
  });

  it('short-answer options', () => {
    const base = { type: 'short-answer', question: 'Q', correctAnswers: ['Praha', 'Prague'] };
    expect(checkAnswer(item(base), '  praha ')).toBe(true);
    expect(checkAnswer(item({ ...base, caseSensitive: true }), 'praha')).toBe(false);
    expect(checkAnswer(item({ ...base, correctAnswers: ['citrón'] }), 'citron')).toBe(false);
    expect(checkAnswer(item({ ...base, correctAnswers: ['citrón'], ignoreDiacritics: true }), 'Citron')).toBe(true);
    expect(checkAnswer(item({ ...base, acceptPartial: true }), 'Prahha')).toBe(true);
    expect(checkAnswer(item({ ...base, acceptPartial: true }), 'Brno')).toBe(false);
    expect(checkAnswer(item({ ...base, correctAnswers: ['cat'], acceptPartial: true }), 'car')).toBe(false);
  });

  it('numbers', () => {
    const numeric = item({ type: 'numeric-input', question: 'Q', correctAnswer: 9.81, tolerance: 0.1 });
    expect(checkAnswer(numeric, 9.9)).toBe(true);
    expect(checkAnswer(numeric, '9,75')).toBe(true);
    expect(checkAnswer(numeric, 10)).toBe(false);
    expect(checkAnswer(numeric, 'abc')).toBe(false);
    const ranged = item({ type: 'numeric-input', question: 'Q', correctAnswer: 5, range: { min: 1000, max: 2000 } });
    expect(checkAnswer(ranged, '1 500')).toBe(true);
    const slider = item({ type: 'slider', question: 'Q', min: 0, max: 100, step: 1, correctAnswer: 50 });
    expect(checkAnswer(slider, 50)).toBe(true);
    expect(checkAnswer(slider, 51)).toBe(false);
  });

  it('math-input ignores whitespace and $ delimiters', () => {
    const math = item({ type: 'math-input', question: 'Q', correctAnswer: '2x+2', alternativeAnswers: ['2+2x'] });
    expect(checkAnswer(math, '2x + 2')).toBe(true);
    expect(checkAnswer(math, '$2 + 2x$')).toBe(true);
    expect(checkAnswer(math, '2X+2')).toBe(false);
  });

  it('ordering and matching', () => {
    const sort = item({ type: 'sort-items', question: 'Q', items: ch('b', 'a', 'c'), correctOrder: ['a', 'b', 'c'] });
    expect(checkAnswer(sort, ['a', 'b', 'c'])).toBe(true);
    expect(checkAnswer(sort, ['b', 'a', 'c'])).toBe(false);
    expect(checkAnswer(sort, ['a', 'b'])).toBe(false);
    const pairs = item({ type: 'match-pairs', prompts: ch('cz', 'sk'), matches: ch('praha', 'bratislava', 'viden'), pairs: { cz: 'praha', sk: 'bratislava' } });
    expect(checkAnswer(pairs, { sk: 'bratislava', cz: 'praha' })).toBe(true);
    expect(checkAnswer(pairs, { cz: 'praha', sk: 'viden' })).toBe(false);
    expect(checkAnswer(pairs, { cz: 'praha' })).toBe(false);
    const complex = item({ type: 'match-complex', leftItems: ch('a', 'b'), rightItems: ch('x', 'y'), connections: [['a', 'x'], ['b', 'y'], ['b', 'x']], minCorrect: 2 });
    expect(checkAnswer(complex, [['a', 'x'], ['b', 'y']])).toBe(true);
    expect(checkAnswer(complex, [['a', 'x'], ['a', 'y']])).toBe(false);
    const matrix = item({ type: 'matrix', question: 'Q', rows: ch('r1', 'r2'), columns: ch('c1', 'c2'), correctCells: [['r1', 'c2'], ['r2', 'c1']] });
    expect(checkAnswer(matrix, [['r2', 'c1'], ['r1', 'c2']])).toBe(true);
    expect(checkAnswer(matrix, [['r1', 'c2']])).toBe(false);
    // Timeline: the order of the dates, listed in any order; the same year counts as simultaneous.
    const timeline = item({
      type: 'timeline',
      question: 'Q',
      events: [
        { id: 'e2', text: 'b', date: '1910-01-01' },
        { id: 'e1', text: 'a', date: '1900-01-01' },
        { id: 'e3', text: 'c', date: '1910-06-01', precision: 'year' },
      ],
    });
    expect(checkAnswer(timeline, ['e1', 'e2', 'e3'])).toBe(true);
    expect(checkAnswer(timeline, ['e1', 'e3', 'e2'])).toBe(true);
    expect(checkAnswer(timeline, ['e2', 'e1', 'e3'])).toBe(false);
    expect(checkAnswer(timeline, ['e1', 'e2'])).toBe(false);
  });

  it('blanks and categories', () => {
    const blanks = item({ type: 'fill-in-blanks', text: '<blank:a /> <blank:b />', blanks: { a: ['Praha'], b: ['Brno', 'brno city'] } });
    expect(checkAnswer(blanks, { a: 'praha', b: 'BRNO' })).toBe(true);
    expect(checkAnswer(blanks, { a: 'praha' })).toBe(false);
    const select = item({ type: 'fill-in-select', text: '<blank:a />', blanks: { a: { options: ch('x', 'y'), correctId: 'y' } } });
    expect(checkAnswer(select, { a: 'y' })).toBe(true);
    expect(checkAnswer(select, { a: 'x' })).toBe(false);
    const categorize = item({ type: 'categorize', question: 'Q', categories: ch('A', 'B'), items: [{ id: 'i1', text: 't', correctCategoryId: 'B' }] });
    expect(checkAnswer(categorize, { i1: 'B' })).toBe(true);
    expect(checkAnswer(categorize, { i1: 'A' })).toBe(false);
  });

  it('spatial and special types', () => {
    const pin = item({
      type: 'pin-on-image',
      question: 'Q',
      targetAsset: 'map',
      hotspots: [
        { type: 'circle', x: 50, y: 50, radius: 5 },
        { type: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { type: 'polygon', points: [{ x: 80, y: 80 }, { x: 90, y: 80 }, { x: 85, y: 90 }] },
      ],
    });
    expect(checkAnswer(pin, { x: 52, y: 51 })).toBe(true);
    expect(checkAnswer(pin, { x: 85, y: 84 })).toBe(true);
    expect(checkAnswer(pin, { x: 30, y: 30 })).toBe(false);
    const pins = item({ ...(pin as object), multipleCorrect: true, minCorrect: 2 });
    expect(checkAnswer(pins, [{ x: 50, y: 50 }, { x: 5, y: 5 }])).toBe(true);
    expect(checkAnswer(pins, [{ x: 50, y: 50 }, { x: 51, y: 51 }])).toBe(false);

    const label = item({ type: 'diagram-label', question: 'Q', targetAsset: 'd', labels: [{ id: 'heart', text: 'Heart' }, { id: 'lung', text: 'Lung' }], zones: [{ id: 'z1', type: 'circle', x: 1, y: 1, radius: 1, correctLabelId: 'lung' }] });
    expect(checkAnswer(label, { z1: 'lung' })).toBe(true);
    expect(checkAnswer(label, { z1: 'heart' })).toBe(false);
    expect(checkAnswer(item({ ...(label as object), requireTyping: true }), { z1: ' lung ' })).toBe(true);

    const model = item({ type: 'pin-on-model', question: 'Q', targetAsset: 'm', hotspots: [{ type: 'mesh', targetName: 'Femur' }] });
    expect(checkAnswer(model, 'femur_left')).toBe(true);
    expect(checkAnswer(model, 'Tibia')).toBe(false);

    const chess = item({ type: 'chess-puzzle', question: 'Q', fen: '8/8/8/8/8/8/8/8 w - - 0 1', correctAnswers: [['Qh5+', 'Nc6', 'Qxf7#']] });
    expect(checkAnswer(chess, ['Qh5', 'Nc6', 'Qxf7'])).toBe(true);
    expect(checkAnswer(chess, ['Qh5'])).toBe(false);
  });

  it('throws for types that cannot be checked', () => {
    expect(() => checkAnswer(item({ type: 'flashcard', front: 'a', back: 'b' }), true)).toThrow(/rate themselves/);
    expect(() => checkAnswer(item({ type: 'x-custom' }), 1)).toThrow(/unsupported/);
  });
});
