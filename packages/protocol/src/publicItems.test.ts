import { describe, it, expect } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { publicItem } from './items';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6d${String(n).padStart(2, '0')}`;

describe('public items keep only known fields (SPEC 4.4, OQSE "Hiding answers safely")', () => {
  it('removes fields of a newer version or of vendors, also nested, and free-form data', () => {
    const item = {
      id: id(1),
      type: 'mcq-single',
      question: 'Capital of Spain?',
      hints: ['Not Barcelona'],
      tags: ['geo'],
      assets: { map: { type: 'image', value: 'https://example.com/m.png', altText: 'Map', futureCrop: { x: 1 } } },
      sources: [{ id: 'atlas', itemId: id(9), location: 'p. 4', quote: 'Madrid is the capital.' }],
      options: [
        { id: 'b', text: 'Barcelona', explanation: 'No', futureIsCorrect: false },
        { id: 'm', text: 'Madrid', futureIsCorrect: true },
      ],
      correctId: 'm',
      acceptedAlternatives: ['m'], // a newer field that would give the answer away
      'x-acme-solution': 'm',
      appSpecific: { acme: { answer: 'm' } },
      customData: { key: 'm' },
    } as unknown as OQSEAnyItem;

    const pub = publicItem(item) as unknown as Record<string, any>;
    expect(pub).toEqual({
      id: id(1),
      type: 'mcq-single',
      question: 'Capital of Spain?',
      hints: ['Not Barcelona'],
      tags: ['geo'],
      assets: { map: { type: 'image', value: 'https://example.com/m.png', altText: 'Map' } },
      sources: [{ id: 'atlas', itemId: id(9), location: 'p. 4' }],
      options: [{ id: 'b', text: 'Barcelona' }, { id: 'm', text: 'Madrid' }],
      answerHidden: true,
    });
    expect(JSON.stringify(pub)).not.toMatch(/futureIsCorrect|acceptedAlternatives|x-acme|"m"\]/);
  });

  it('keeps the known shapes of nested unions (zones of diagram-label)', () => {
    const item = {
      id: id(2),
      type: 'diagram-label',
      question: 'Label it',
      targetAsset: 'img',
      labels: [{ id: 'a', text: 'A' }],
      zones: [
        { id: 'z1', type: 'rect', x: 1, y: 2, width: 3, height: 4, correctLabelId: 'a', futureColor: 'red' },
        { id: 'z2', type: 'circle', x: 5, y: 6, radius: 7, correctLabelId: 'a' },
      ],
    } as unknown as OQSEAnyItem;
    const pub = publicItem(item) as unknown as Record<string, any>;
    expect(pub.zones).toEqual([
      { id: 'z1', type: 'rect', x: 1, y: 2, width: 3, height: 4 },
      { id: 'z2', type: 'circle', x: 5, y: 6, radius: 7 },
    ]);
  });

  it('custom x- types keep their own fields and lose solution', () => {
    const item = { id: id(3), type: 'x-acme-puzzle', board: [1, 2], solution: { moves: ['a'] }, explanation: 'why' } as unknown as OQSEAnyItem;
    expect(publicItem(item)).toEqual({ id: id(3), type: 'x-acme-puzzle', board: [1, 2], answerHidden: true });
  });
});
