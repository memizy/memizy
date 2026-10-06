import { describe, expect, it } from 'vitest';
import { displayItem, publicItem, prepareDisplaySet, seededRandom } from '@memizy/protocol';
import type { OQSEAnyItem } from '@memizy/oqse';
import { checkAnswer } from './checkAnswer';

const items = {
  mcq: { id: 'm1', type: 'mcq-single', question: 'Q', options: ['a', 'b', 'c', 'd'], correctIndex: 2, optionExplanations: ['ea', 'eb', 'ec', 'ed'], explanation: 'because' },
  multi: { id: 'm2', type: 'mcq-multi', question: 'Q', options: ['a', 'b', 'c', 'd', 'e'], correctIndices: [0, 3] },
  fixed: { id: 'm3', type: 'mcq-single', question: 'Q', options: ['a', 'b', 'all of the above'], correctIndex: 2, shuffle: false },
  tf: { id: 't', type: 'true-false', question: 'Q', correctAnswer: true },
  short: { id: 's', type: 'short-answer', question: 'Q', correctAnswers: ['Praha'] },
  sort: { id: 'o', type: 'sort-items', question: 'Q', items: ['1', '2', '3', '4'] },
  pairs: { id: 'p', type: 'match-pairs', prompts: ['CZ', 'SK', 'AT'], matches: ['Praha', 'Bratislava', 'Vídeň'] },
  complex: { id: 'c', type: 'match-complex', leftItems: ['L0', 'L1'], rightItems: ['R0', 'R1', 'R2'], connections: [[0, 1], [1, 2]] },
  timeline: { id: 'tl', type: 'timeline', question: 'Q', events: [{ id: 'e1', text: 'A', date: '1900' }, { id: 'e2', text: 'B', date: '1950' }, { id: 'e3', text: 'C', date: '2000' }] },
  categorize: { id: 'cat', type: 'categorize', question: 'Q', categories: ['X', 'Y'], items: [{ id: 'i1', text: 'a', correctCategoryIndex: 0 }, { id: 'i2', text: 'b', correctCategoryIndex: 1 }] },
  select: { id: 'fs', type: 'fill-in-select', text: 'Hlavní město je {{c}}.', blanks: { c: { options: ['Brno', 'Praha', 'Ostrava'], correctIndex: 1 } } },
  blanks: { id: 'fb', type: 'fill-in-blanks', text: 'Voda je {{w}}.', blanks: { w: ['H2O'] } },
  diagram: { id: 'd', type: 'diagram-label', question: 'Q', targetAsset: 'img', labels: ['srdce', 'plíce', 'játra'], zones: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1, correctLabelIndex: 2 }] },
  numeric: { id: 'n', type: 'numeric-input', question: 'Q', correctAnswer: 9.81, tolerance: 0.1 },
  flash: { id: 'f', type: 'flashcard', front: 'term', back: 'definition' },
  note: { id: 'nt', type: 'note', content: 'shown', hiddenContent: 'secret' },
  pin: { id: 'pi', type: 'pin-on-image', question: 'Q', targetAsset: 'img', hotspots: [{ type: 'circle', x: 50, y: 50, radius: 5 }] },
  custom: { id: 'x', type: 'x-anything', secret: 42 },
} as unknown as Record<string, OQSEAnyItem>;

/** The right answer for an item in display order (what a player who knows it would send). */
function rightAnswer(item: any): unknown {
  switch (item.type) {
    case 'mcq-single': return item.correctIndex;
    case 'mcq-multi': return item.correctIndices;
    case 'sort-items': return item.correctOrder ?? item.items.map((_: unknown, i: number) => i);
    case 'match-pairs': return item.correctMatches ?? item.prompts.map((_: unknown, i: number) => i);
    case 'match-complex': return item.connections;
    case 'timeline': return item.correctOrder;
    case 'categorize': return Object.fromEntries(item.items.map((e: any) => [e.id, e.correctCategoryIndex]));
    case 'fill-in-select': return Object.fromEntries(Object.entries(item.blanks).map(([k, b]: [string, any]) => [k, b.correctIndex]));
    case 'diagram-label': return Object.fromEntries(item.zones.map((z: any, i: number) => [i, z.correctLabelIndex]));
    default: return undefined;
  }
}

describe('display order (SPEC 4.4)', () => {
  it('keeps the meaning of every item: the same right answer in text, checkAnswer agrees', () => {
    for (let seed = 0; seed < 40; seed++) {
      const random = seededRandom(`s${seed}`);
      for (const original of Object.values(items)) {
        const shown = displayItem(original, random) as any;
        const o = original as any;
        switch (o.type) {
          case 'mcq-single':
            expect(shown.options[shown.correctIndex]).toBe(o.options[o.correctIndex]);
            expect(shown.optionExplanations?.[shown.correctIndex]).toBe(o.optionExplanations?.[o.correctIndex]);
            break;
          case 'mcq-multi':
            expect(shown.correctIndices.map((i: number) => shown.options[i]).sort()).toEqual(o.correctIndices.map((i: number) => o.options[i]).sort());
            break;
          case 'sort-items':
            expect(shown.correctOrder.map((i: number) => shown.items[i])).toEqual(o.items);
            expect(shown.items).not.toEqual(o.items); // never already sorted
            expect(checkAnswer(shown, shown.items.map((_: unknown, i: number) => i))).toBe(false);
            break;
          case 'match-pairs':
            expect(shown.prompts.map((p: string, i: number) => `${p}=${shown.matches[shown.correctMatches[i]]}`).sort()).toEqual(o.prompts.map((p: string, i: number) => `${p}=${o.matches[i]}`).sort());
            break;
          case 'match-complex':
            expect(shown.connections.map(([l, r]: number[]) => `${shown.leftItems[l]}-${shown.rightItems[r]}`).sort()).toEqual(o.connections.map(([l, r]: number[]) => `${o.leftItems[l]}-${o.rightItems[r]}`).sort());
            break;
          case 'fill-in-select':
            expect(shown.blanks.c.options[shown.blanks.c.correctIndex]).toBe('Praha');
            break;
          case 'diagram-label':
            expect(shown.labels[shown.zones[0].correctLabelIndex]).toBe('játra');
            break;
        }
        if (o.id === 'm3') expect(shown.options).toEqual(o.options); // shuffle: false is respected
        const answer = rightAnswer(shown);
        if (answer !== undefined) expect(checkAnswer(shown, answer), `${o.type} seed ${seed}`).toBe(true);
      }
    }
  });

  it('mixes the position of the right option', () => {
    const positions = new Set(Array.from({ length: 30 }, (_, s) => (displayItem(items.mcq, seededRandom(`p${s}`)) as any).correctIndex));
    expect(positions.size).toBe(4);
  });

  it('the original order (no seed) still checks as before', () => {
    const { set } = prepareDisplaySet({ meta: {} as any, items: [items.sort, items.pairs, items.timeline] });
    expect(checkAnswer(set.items[0], [0, 1, 2, 3])).toBe(true);
    expect(checkAnswer(set.items[1], [0, 1, 2])).toBe(true);
    expect(checkAnswer(set.items[2], ['e1', 'e2', 'e3'])).toBe(true);
  });
});

describe('public items', () => {
  /** What must not be in the public copy of each item. */
  const secrets: Record<string, string[]> = {
    m1: ['because', 'ec', 'correctIndex', 'optionExplanations'],
    m2: ['correctIndices'],
    m3: ['correctIndex'],
    t: ['correctAnswer'],
    s: ['Praha', 'correctAnswers'],
    o: ['correctOrder'],
    p: ['correctMatches'],
    c: ['connections'],
    tl: ['1900', '1950', 'correctOrder'],
    cat: ['correctCategoryIndex'],
    fs: ['correctIndex'],
    fb: ['H2O'],
    d: ['correctLabelIndex'],
    n: ['9.81'],
    f: ['definition'],
    nt: ['secret'],
    pi: ['circle'],
  };

  it('contain nothing that gives the answer away', () => {
    for (const original of Object.values(items)) {
      if ((original as any).type.startsWith('x-')) continue;
      const pub = publicItem(displayItem(original, seededRandom('x'))) as any;
      expect(pub.answerHidden).toBe(true);
      const text = JSON.stringify(pub);
      for (const secret of secrets[pub.id]) expect(text, `${pub.type} leaks ${secret}`).not.toContain(secret);
    }
  });

  it('keep what a player needs to answer', () => {
    const pub = (key: string) => publicItem(displayItem(items[key], seededRandom('k'))) as any;
    expect(pub('mcq').options).toHaveLength(4);
    expect(pub('sort').items).toHaveLength(4);
    expect(pub('pairs').matches).toHaveLength(3);
    expect(Object.keys(pub('blanks').blanks)).toEqual(['w']);
    expect(pub('select').blanks.c.options).toHaveLength(3);
    expect(pub('timeline').events.map((e: any) => e.text).sort()).toEqual(['A', 'B', 'C']);
    expect(pub('diagram').zones[0]).toMatchObject({ type: 'rect', width: 1 });
    expect(pub('flash').front).toBe('term');
    expect(pub('note').content).toBe('shown');
    expect(pub('custom').secret).toBe(42); // custom types pass unchanged
  });

  it('checkAnswer refuses an item without its answer', () => {
    expect(() => checkAnswer(publicItem(items.mcq), 2)).toThrow(/without its answer/);
  });
});
