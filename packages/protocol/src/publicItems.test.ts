import { describe, it, expect } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { prepareDisplaySet, publicItem } from './items';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6d${String(n).padStart(2, '0')}`;

describe('display order (SPEC 4.4)', () => {
  const mcq = (n: number) => ({ id: id(20 + n), type: 'mcq-single', question: `Q${n}`, options: 'abcdefgh'.split('').map((c) => ({ id: c, text: c })), correctId: 'a' }) as unknown as OQSEAnyItem;
  const meta = { id: id(19), language: 'en', title: 'S', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as never;
  const orders = (items: OQSEAnyItem[]) =>
    Object.fromEntries(prepareDisplaySet({ meta, items }, 'secret').set.items.map((item) => [item.id, (item as any).options.map((o: any) => o.id).join('')]));

  it('each item keeps its order when other items are edited, added or removed', () => {
    const all = [mcq(1), mcq(2), mcq(3), mcq(4)];
    const before = orders(all);
    const edited = structuredClone(all);
    (edited[0] as any).question = 'Changed';
    const after = orders([mcq(0), ...edited.slice(0, 2), ...edited.slice(3)]); // one added, one removed, one edited
    for (const item of [all[0], all[1], all[3]]) expect(after[item.id]).toBe(before[item.id]);
    expect(new Set(Object.values(before)).size).toBeGreaterThan(1); // the items are shuffled differently
  });
});

describe('public items keep only known fields (SPEC 4.4, OQSE "Hiding answers safely")', () => {
  it('removes fields of a newer version or of vendors, also nested, and free-form data', () => {
    const item = {
      id: id(1),
      type: 'mcq-single',
      question: 'Capital of Spain? <asset:map />',
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
      question: 'Capital of Spain? <asset:map />',
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

  it('keeps only the media the public texts use: no picture of the answer', () => {
    const card = {
      id: id(4),
      type: 'flashcard',
      front: 'Which bone? <asset:xray />',
      back: '<asset:labelled /> The femur.',
      explanation: 'See <asset:diagram />',
      assets: {
        xray: { type: 'image', value: 'https://example.com/xray.png', altText: 'X-ray' },
        labelled: { type: 'image', value: 'https://example.com/femur-labelled.png', altText: 'Femur' },
        diagram: { type: 'image', value: 'https://example.com/diagram.png', altText: 'Diagram' },
      },
    } as unknown as OQSEAnyItem;
    expect(Object.keys((publicItem(card) as any).assets)).toEqual(['xray']);
    const diagram = { id: id(5), type: 'diagram-label', question: 'Label it', targetAsset: 'Heart', labels: [{ id: 'a', text: 'A' }], zones: [], assets: { heart: { type: 'image', value: 'https://e.com/h.png', altText: 'H' } } } as unknown as OQSEAnyItem;
    expect(Object.keys((publicItem(diagram) as any).assets)).toEqual(['heart']);
    const set = prepareDisplaySet({
      meta: { id: id(6), language: 'en', title: 'S', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', thumbnail: 'cover', description: 'With <asset:intro />',
        assets: { cover: { type: 'image', value: 'https://e.com/c.png', altText: 'C' }, intro: { type: 'image', value: 'https://e.com/i.png', altText: 'I' }, answer: { type: 'image', value: 'https://e.com/a.png', altText: 'A' } } } as never,
      items: [{ id: id(7), type: 'flashcard', front: 'Q', back: '<asset:answer />' } as never],
    });
    expect(Object.keys(set.publicSet.meta.assets!)).toEqual(['cover', 'intro']);
    expect(Object.keys(set.set.meta.assets!)).toEqual(['cover', 'intro', 'answer']); // the authority keeps everything
  });

  it('custom x- types keep their own fields and lose solution', () => {
    const item = { id: id(3), type: 'x-acme-puzzle', board: [1, 2], solution: { moves: ['a'] }, explanation: 'why' } as unknown as OQSEAnyItem;
    expect(publicItem(item)).toEqual({ id: id(3), type: 'x-acme-puzzle', board: [1, 2], answerHidden: true });
  });
});
