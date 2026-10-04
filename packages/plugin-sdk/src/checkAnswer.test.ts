import { describe, it, expect } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { checkAnswer } from './checkAnswer';

const item = (data: Record<string, unknown>) => ({ id: 'x', ...data }) as unknown as OQSEAnyItem;

describe('checkAnswer', () => {
  it('choice types', () => {
    const mcq = item({ type: 'mcq-single', question: 'Q', options: ['a', 'b'], correctIndex: 1 });
    expect(checkAnswer(mcq, 1)).toBe(true);
    expect(checkAnswer(mcq, '1')).toBe(true); // from data-payload / forms
    expect(checkAnswer(mcq, 0)).toBe(false);
    expect(checkAnswer(mcq, undefined)).toBe(false);

    const multi = item({ type: 'mcq-multi', question: 'Q', options: ['a', 'b', 'c'], correctIndices: [0, 2] });
    expect(checkAnswer(multi, [2, 0])).toBe(true);
    expect(checkAnswer(multi, [0])).toBe(false);
    expect(checkAnswer(multi, [0, 2, 2])).toBe(false);

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
    expect(checkAnswer(item({ type: 'sort-items', question: 'Q', items: ['a', 'b', 'c'] }), [0, 1, 2])).toBe(true);
    expect(checkAnswer(item({ type: 'sort-items', question: 'Q', items: ['a', 'b', 'c'] }), [1, 0, 2])).toBe(false);
    expect(checkAnswer(item({ type: 'match-pairs', prompts: ['a', 'b'], matches: ['A', 'B'] }), [0, 1])).toBe(true);
    expect(checkAnswer(item({ type: 'match-pairs', prompts: ['a', 'b'], matches: ['A', 'B'] }), [1, 0])).toBe(false);
    const complex = item({ type: 'match-complex', leftItems: ['a', 'b'], rightItems: ['x', 'y'], connections: [[0, 0], [1, 1], [1, 0]], minCorrect: 2 });
    expect(checkAnswer(complex, [[0, 0], [1, 1]])).toBe(true);
    expect(checkAnswer(complex, [[0, 0], [0, 1]])).toBe(false);
    const matrix = item({ type: 'matrix', question: 'Q', rows: ['r1', 'r2'], columns: ['c1', 'c2'], correctCells: [[0, 1], [1, 0]] });
    expect(checkAnswer(matrix, [[1, 0], [0, 1]])).toBe(true);
    expect(checkAnswer(matrix, [[0, 1]])).toBe(false);
    const timeline = item({ type: 'timeline', question: 'Q', events: [{ id: 'e1', text: 'a', date: '1900-01-01' }, { id: 'e2', text: 'b', date: '1910-01-01' }] });
    expect(checkAnswer(timeline, ['e1', 'e2'])).toBe(true);
    expect(checkAnswer(timeline, ['e2', 'e1'])).toBe(false);
  });

  it('blanks and categories', () => {
    const blanks = item({ type: 'fill-in-blanks', text: '<blank:a /> <blank:b />', blanks: { a: ['Praha'], b: ['Brno', 'brno city'] } });
    expect(checkAnswer(blanks, { a: 'praha', b: 'BRNO' })).toBe(true);
    expect(checkAnswer(blanks, { a: 'praha' })).toBe(false);
    const select = item({ type: 'fill-in-select', text: '<blank:a />', blanks: { a: { options: ['x', 'y'], correctIndex: 1 } } });
    expect(checkAnswer(select, { a: 1 })).toBe(true);
    const categorize = item({ type: 'categorize', question: 'Q', categories: ['A', 'B'], items: [{ id: 'i1', text: 't', correctCategoryIndex: 1 }] });
    expect(checkAnswer(categorize, { i1: 1 })).toBe(true);
    expect(checkAnswer(categorize, { i1: 0 })).toBe(false);
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

    const label = item({ type: 'diagram-label', question: 'Q', targetAsset: 'd', labels: ['Heart', 'Lung'], zones: [{ type: 'circle', x: 1, y: 1, radius: 1, correctLabelIndex: 1 }] });
    expect(checkAnswer(label, { 0: 1 })).toBe(true);
    expect(checkAnswer(item({ ...(label as object), requireTyping: true }), { 0: ' lung ' })).toBe(true);

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
