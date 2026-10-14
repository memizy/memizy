import { describe, expect, it } from 'bun:test';
import { safeValidateOQSEFile } from '../../packages/oqse/dist/index.js';
import { migrateMarkdownSet, migratePluginHtml, migrateSet, SCHEMA_URL } from './migrate';

const meta = { id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a00', language: 'cs', title: 'Test', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

describe('migrateSet', () => {
  it('converts a 0.2 set to a strictly valid 1.0 set', () => {
    const v02 = {
      $schema: 'https://cdn.jsdelivr.net/npm/@memizy/oqse@0.2/schemas/oqse-v0.2.json',
      version: '0.2',
      meta,
      items: [
        { id: id(1), type: 'mcq-single', question: 'Capital?', options: ['Brno', 'Praha'], correctIndex: 1, optionExplanations: ['No.', ''] },
        { id: id(2), type: 'sort-items', question: 'Sort', items: ['one', 'two', 'three'] },
        { id: id(3), type: 'match-pairs', question: 'Match', prompts: ['cz', 'sk'], matches: ['Praha', 'Bratislava'] },
        { id: id(4), type: 'short-answer', question: 'Capital?', correctAnswers: ['Praha'], trimWhitespace: true },
      ],
    };
    const { result, changes } = migrateSet(v02);
    expect(result.version).toBe('1.0');
    expect(result.$schema).toBe(SCHEMA_URL);
    expect(result.items[0]).toMatchObject({ options: [{ id: 'a', text: 'Brno', explanation: 'No.' }, { id: 'b', text: 'Praha' }], correctId: 'b' });
    expect(result.items[1].correctOrder).toEqual(['i1', 'i2', 'i3']);
    expect(result.items[2].pairs).toEqual({ p1: 'm1', p2: 'm2' });
    expect(result.items[3]).not.toHaveProperty('trimWhitespace');
    expect(changes).toContain('version 0.2 → 1.0');
    expect(safeValidateOQSEFile(result)).toMatchObject({ success: true, errors: [] });
    expect(v02.version).toBe('0.2'); // the input is not changed
  });

  it('converts 0.3: range, altText, features; reports what needs a human', () => {
    const v03 = {
      version: '0.3',
      meta: { ...meta, assets: { cover: { type: 'image', value: 'https://example.com/cover_photo.jpg' } } },
      items: [
        { id: id(1), type: 'numeric-input', question: 'How many?', correctAnswer: 0, range: { min: 100, max: 120 } },
        { id: id(2), type: 'short-answer', question: '**Which** word?', correctAnswers: ['byt', 'být'] },
        { id: id(3), type: 'note', content: 'Area $\\pi r^2$' },
      ],
    };
    const { result, review } = migrateSet(v03);
    expect(result.items[0]).toEqual({ id: id(1), type: 'numeric-input', question: 'How many?', correctAnswer: 110, tolerance: 10 });
    expect(result.meta.assets.cover.altText).toBe('cover photo');
    expect(result.meta.requirements.features).toEqual(['markdown']);
    expect(review.join('\n')).toMatch(/"byt" and "být" differ only in diacritics/);
    expect(review.join('\n')).toMatch(/looks like a LaTeX formula/);
    expect(review.join('\n')).toMatch(/cover photo/);
    expect(safeValidateOQSEFile(result).success).toBe(true);
  });

  it('converts 0.1: renamed fields and math → latex, then the later steps', () => {
    const v01 = {
      version: '0.1',
      meta: { ...meta, requirements: { features: ['markdown', 'math'] } },
      items: [
        { id: id(1), type: 'true-false', question: 'Earth is round.', answer: true },
        { id: id(2), type: 'short-answer', question: 'Capital?', answers: ['Praha'] },
        { id: id(3), type: 'mcq-single', question: 'Which $x^2$?', options: ['1', '4'], correctIndex: 1, shuffleOptions: false },
        { id: id(4), type: 'math-input', question: 'Simplify', correctAnswer: '$2x+2$', alternativeAnswers: ['$$2+2x$$'] },
      ],
    };
    const { result, review } = migrateSet(v01);
    expect(result.meta.requirements.features).toEqual(['markdown', 'latex']);
    expect(result.items[0]).toMatchObject({ correctAnswer: true });
    expect(result.items[1]).toMatchObject({ correctAnswers: ['Praha'] });
    expect(result.items[2]).toMatchObject({ shuffle: false, correctId: 'b' });
    expect(result.items[3]).toMatchObject({ correctAnswers: ['2x+2', '2+2x'] });
    expect(result.items[3]).not.toHaveProperty('alternativeAnswers');
    expect(review).toEqual([]); // latex is declared now
    expect(safeValidateOQSEFile(result)).toMatchObject({ success: true, errors: [] });
  });

  it('match-complex: lists of a 0.2 set and of a 1.0 release candidate become prompts / matches', () => {
    const meta = { id: id(0), language: 'en', title: 'Engines', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const old02 = { version: '0.2', meta, items: [{ id: id(1), type: 'match-complex', leftItems: ['Starship', 'Falcon 9'], rightItems: ['Raptor', 'Merlin'], connections: [[0, 0], [1, 1]] }] };
    const rc = { version: '1.0', meta, items: [{ id: id(2), type: 'match-complex', leftItems: [{ id: 's', text: 'Starship' }], rightItems: [{ id: 'r', text: 'Raptor' }], connections: [['s', 'r']] }] };
    for (const input of [old02, rc]) {
      const { result, changes } = migrateSet(input);
      const item = result.items[0];
      expect(Object.keys(item)).toEqual(['id', 'type', 'prompts', 'matches', 'connections']);
      expect(item.connections.every(([p, m]: [string, string]) => item.prompts.some((c: { id: string }) => c.id === p) && item.matches.some((c: { id: string }) => c.id === m))).toBe(true);
      expect(changes).toContain('match-complex: leftItems / rightItems → prompts / matches');
      expect(safeValidateOQSEFile(result).success).toBe(true);
    }
  });

  it('leaves a 1.0 set unchanged', () => {
    const v10 = { version: '1.0', meta, items: [{ id: id(1), type: 'note', content: 'Plain text.' }] };
    expect(migrateSet(v10)).toMatchObject({ result: v10, changes: [], review: [] });
  });
});

describe('migrateMarkdownSet and migratePluginHtml', () => {
  it('changes the version of an OQSE Markdown set', () => {
    expect(migrateMarkdownSet('---\noqse: "0.3"\nlanguage: cs\n---\n# T\n').result).toBe('---\noqse: "1.0"\nlanguage: cs\n---\n# T\n');
  });

  it('changes the manifest version of a plugin and notes the "note" workaround', () => {
    const html = '<script type="application/oqse-manifest+json">{ "version": "0.2", "pluginVersion": "0.2", "capabilities": { "types": ["note"] } }</script><p>"version": "0.2"</p>';
    const { result, changes, review } = migratePluginHtml(html);
    expect(result).toBe('<script type="application/oqse-manifest+json">{ "version": "1.0", "pluginVersion": "0.2", "capabilities": { "types": ["note"] } }</script><p>"version": "0.2"</p>');
    expect(changes).toEqual(['manifest version 0.2 → 1.0']);
    expect(review[0]).toMatch(/"set": "none"/);
  });
});
