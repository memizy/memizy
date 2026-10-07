import { describe, expect, it } from 'vitest';
import { displayItem, publicItem, seededRandom } from '@memizy/protocol';
import type { OQSEAnyItem } from '@memizy/oqse';
import { checkAnswer } from './checkAnswer';

const ch = (...ids: string[]) => ids.map((id) => ({ id, text: `T-${id}` }));

const items = {
  mcq: { id: 'm1', type: 'mcq-single', question: 'Q', options: [...ch('a', 'b', 'd'), { id: 'c', text: 'T-c', explanation: 'because-c' }], correctId: 'c', explanation: 'because' },
  multi: { id: 'm2', type: 'mcq-multi', question: 'Q', options: ch('a', 'b', 'c', 'd', 'e'), correctIds: ['a', 'd'] },
  fixed: { id: 'm3', type: 'mcq-single', question: 'Q', options: ch('a', 'b', 'all'), correctId: 'all', shuffle: false },
  tf: { id: 't', type: 'true-false', question: 'Q', correctAnswer: true },
  short: { id: 's', type: 'short-answer', question: 'Q', correctAnswers: ['Praha'] },
  sort: { id: 'o', type: 'sort-items', question: 'Q', items: ch('i1', 'i2', 'i3', 'i4'), correctOrder: ['i1', 'i2', 'i3', 'i4'] },
  pairs: { id: 'p', type: 'match-pairs', prompts: ch('cz', 'sk', 'at'), matches: ch('praha', 'bratislava', 'viden'), pairs: { cz: 'praha', sk: 'bratislava', at: 'viden' } },
  complex: { id: 'c', type: 'match-complex', leftItems: ch('l0', 'l1'), rightItems: ch('r0', 'r1', 'r2'), connections: [['l0', 'r1'], ['l1', 'r2']] },
  timeline: { id: 'tl', type: 'timeline', question: 'Q', events: [{ id: 'e1', text: 'A', date: '1900-01-01' }, { id: 'e2', text: 'B', date: '1950-01-01' }, { id: 'e3', text: 'C', date: '2000-01-01' }] },
  categorize: { id: 'cat', type: 'categorize', question: 'Q', categories: ch('x', 'y'), items: [{ id: 'i1', text: 'a', correctCategoryId: 'x' }, { id: 'i2', text: 'b', correctCategoryId: 'y' }] },
  select: { id: 'fs', type: 'fill-in-select', text: 'Hlavní město je <blank:c />.', blanks: { c: { options: ch('brno', 'praha', 'ostrava'), correctId: 'praha' } } },
  blanks: { id: 'fb', type: 'fill-in-blanks', text: 'Voda je <blank:w />.', blanks: { w: ['H2O'] } },
  diagram: { id: 'd', type: 'diagram-label', question: 'Q', targetAsset: 'img', labels: ch('srdce', 'plice', 'jatra'), zones: [{ id: 'z1', type: 'rect', x: 0, y: 0, width: 1, height: 1, correctLabelId: 'jatra' }] },
  typed: { id: 'dt', type: 'diagram-label', question: 'Q', targetAsset: 'img', requireTyping: true, labels: ch('srdce'), zones: [{ id: 'z1', type: 'rect', x: 0, y: 0, width: 1, height: 1, correctLabelId: 'srdce' }] },
  matrix: { id: 'mx', type: 'matrix', question: 'Q', rows: ch('r'), columns: ch('k'), correctCells: [['r', 'k']] },
  numeric: { id: 'n', type: 'numeric-input', question: 'Q', correctAnswer: 9.81, tolerance: 0.1 },
  flash: { id: 'f', type: 'flashcard', front: 'term', back: 'definition' },
  note: { id: 'nt', type: 'note', content: 'shown', hiddenContent: 'secret' },
  pin: { id: 'pi', type: 'pin-on-image', question: 'Q', targetAsset: 'img', hotspots: [{ type: 'circle', x: 50, y: 50, radius: 5 }] },
  custom: { id: 'x', type: 'x-anything', secret: 42 },
} as unknown as Record<string, OQSEAnyItem>;

/** The right answer (IDs do not change with the order). */
const rightAnswers: Record<string, unknown> = {
  m1: 'c',
  m2: ['a', 'd'],
  m3: 'all',
  o: ['i1', 'i2', 'i3', 'i4'],
  p: { cz: 'praha', sk: 'bratislava', at: 'viden' },
  c: [['l0', 'r1'], ['l1', 'r2']],
  tl: ['e1', 'e2', 'e3'],
  cat: { i1: 'x', i2: 'y' },
  fs: { c: 'praha' },
  d: { z1: 'jatra' },
  mx: [['r', 'k']],
};

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const LISTS = ['options', 'items', 'prompts', 'matches', 'leftItems', 'rightItems', 'events', 'labels', 'blanks'];
const withoutLists = (item: object) => JSON.stringify(Object.fromEntries(Object.entries(item).filter(([k]) => !LISTS.includes(k))));

describe('display order (SPEC 4.4)', () => {
  it('only moves the lists: the same answers stay right', () => {
    for (let seed = 0; seed < 40; seed++) {
      const random = seededRandom(`s${seed}`);
      for (const original of Object.values(items)) {
        const shown = displayItem(original, random) as any;
        const answer = rightAnswers[original.id];
        if (answer !== undefined) expect(checkAnswer(shown, answer), `${original.type} seed ${seed}`).toBe(true);
        expect(withoutLists(shown)).toBe(withoutLists(original));
      }
    }
  });

  it('mixes positions, but never shows items already sorted or events in order; respects shuffle: false', () => {
    const positions = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const random = seededRandom(`p${seed}`);
      positions.add(ids((displayItem(items.mcq, random) as any).options).indexOf('c'));
      expect(ids((displayItem(items.sort, random) as any).items)).not.toEqual(['i1', 'i2', 'i3', 'i4']);
      expect(ids((displayItem(items.timeline, random) as any).events)).not.toEqual(['e1', 'e2', 'e3']);
      expect(ids((displayItem(items.fixed, random) as any).options)).toEqual(['a', 'b', 'all']);
    }
    expect(positions.size).toBe(4);
  });
});

describe('public items', () => {
  /** What must not be in the public copy of each item. */
  const secrets: Record<string, string[]> = {
    m1: ['because', 'correctId'],
    m2: ['correctIds'],
    m3: ['correctId'],
    t: ['correctAnswer'],
    s: ['Praha', 'correctAnswers'],
    o: ['correctOrder'],
    p: ['"pairs":'],
    c: ['connections'],
    tl: ['1900', '1950', 'date'],
    cat: ['correctCategoryId'],
    fs: ['correctId'],
    fb: ['H2O'],
    d: ['correctLabelId'],
    dt: ['srdce'],
    mx: ['correctCells'],
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
    expect(ids(pub('mcq').options).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(pub('sort').items).toHaveLength(4);
    expect(pub('pairs').matches).toHaveLength(3);
    expect(Object.keys(pub('blanks').blanks)).toEqual(['w']);
    expect(pub('select').blanks.c.options).toHaveLength(3);
    expect(pub('timeline').events.map((e: any) => e.text).sort()).toEqual(['A', 'B', 'C']);
    expect(pub('diagram').zones[0]).toMatchObject({ id: 'z1', type: 'rect', width: 1 });
    expect(pub('diagram').labels).toHaveLength(3);
    expect(pub('flash').front).toBe('term');
    expect(pub('note').content).toBe('shown');
    expect(pub('custom').secret).toBe(42); // custom types pass unchanged
  });

  it('checkAnswer refuses an item without its answer', () => {
    expect(() => checkAnswer(publicItem(items.mcq), 'c')).toThrow(/without its answer/);
  });
});
