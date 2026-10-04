import { describe, it, expect } from 'vitest';
import type { NoteItem, OQSEFile } from './oqse';
import { parseMarkdownSet, safeParseMarkdownSet, serializeMarkdownSet, MarkdownSetError } from './markdownSet';

const META_ID = '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a00';
const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

const MERMAID = [
  '```mermaid',
  'graph TD',
  '  A["Start (t=0)"] -->|"x > 0 & y < 1"| B{"Is it \\"done\\"?"}',
  '  %% a comment # not a heading',
  '```',
].join('\n');

const LATEX = String.raw`$$
\Delta U = Q - W \quad \text{where} \quad \frac{\partial U}{\partial T}\bigg|_{V} = C_V
$$`;

function set(items: NoteItem[], meta: Partial<OQSEFile['meta']> = {}): OQSEFile {
  return {
    version: '0.2',
    meta: {
      id: META_ID,
      language: 'cs',
      title: 'Termodynamika',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      requirements: { features: ['markdown', 'latex', 'mermaid'] },
      ...meta,
    },
    items,
  };
}

const note = (n: number, extra: Partial<NoteItem> = {}): NoteItem => ({ id: id(n), type: 'note', title: `Poznámka ${n}`, content: `Obsah ${n}`, ...extra });

const roundTrip = (file: OQSEFile, options?: Parameters<typeof serializeMarkdownSet>[1]) =>
  parseMarkdownSet(serializeMarkdownSet(file, options)).file;

describe('round-trip json -> md -> json', () => {
  it('minimal set', () => {
    const file = set([note(1)]);
    expect(roundTrip(file)).toEqual(file);
  });

  it('rich set: topics, metadata, hidden content, Mermaid, LaTeX, unicode', () => {
    const file = set(
      [
        note(1, { topic: 'Základní zákony', tags: ['fyzika', 'a: b'], content: `Úvod $\\Delta U$ 🐎\n\n${MERMAID}\n\n${LATEX}`, hiddenContent: `Odpověď:\n\n${MERMAID}\n\n> citace` }),
        note(2, { topic: 'Základní zákony', difficulty: 3, hints: ['Pomůcka $Q$'], customData: { nested: { list: [1, 2] } } }),
        note(3, { topic: 'Aplikace', content: '### Podnadpis\n\nText\n\n> [!note] Jiný callout\n> zůstává v obsahu' }),
        note(4), // no topic after a topic -> reset heading
        note(5, { title: undefined, explanation: 'Víceřádkové\nvysvětlení "s uvozovkami"' }),
      ],
      { description: 'Popis sady s **Markdownem**.', tags: ['fyzika'] },
    );
    expect(roundTrip(file)).toEqual(file);
  });

  it('keeps Mermaid and LaTeX verbatim (no escaping)', () => {
    const md = serializeMarkdownSet(set([note(1, { content: `${MERMAID}\n\n${LATEX}` })]));
    expect(md).toContain(MERMAID);
    expect(md).toContain(LATEX);
  });

  it('lowers the note level automatically when content uses H2 headings', () => {
    const file = set([note(1, { content: '## Section inside the note\n\nText' })]);
    const md = serializeMarkdownSet(file);
    expect(md).toContain('noteHeadingLevel: 1');
    expect(roundTrip(file)).toEqual(file);
  });

  it('keeps topics in the metadata comment when notes are level 1', () => {
    const file = set([note(1, { topic: 'Kapitola', content: '## Sekce\n\nText' })]);
    expect(serializeMarkdownSet(file)).toMatch(/<!-- oqse: \{.*topic: Kapitola.*\} -->/);
    expect(roundTrip(file)).toEqual(file);
  });

  it('produces the canonical format', () => {
    const md = serializeMarkdownSet(
      set([note(1, { topic: 'Kapitola', tags: ['a'], hiddenContent: 'Line 1\n\nLine 2' })], { requirements: undefined, description: 'Popis' }),
    );
    expect(md).toBe(
      [
        '---',
        'oqse: "0.2"',
        `id: ${META_ID}`,
        'title: Termodynamika',
        'language: cs',
        'createdAt: 2026-01-01T00:00:00Z',
        'updatedAt: 2026-01-02T00:00:00Z',
        '---',
        'Popis',
        '',
        '# Kapitola',
        '',
        '## Poznámka 1',
        `<!-- oqse: {id: ${id(1)}, tags: [a]} -->`,
        'Obsah 1',
        '',
        '> [!hidden]-',
        '> Line 1',
        '>',
        '> Line 2',
        '',
      ].join('\n'),
    );
  });
});

describe('parseMarkdownSet', () => {
  const header = `---\noqse: "0.2"\nid: ${META_ID}\ntitle: T\nlanguage: cs\ncreatedAt: 2026-01-01T00:00:00Z\nupdatedAt: 2026-01-01T00:00:00Z\n---\n`;

  it('generates missing IDs and dates and reports them', () => {
    const { file, generated } = parseMarkdownSet('---\noqse: "0.2"\ntitle: T\nlanguage: cs\n---\n## A\nObsah A\n\n## B\n<!-- oqse: {tags: [x]} -->\nObsah B\n');
    expect(generated).toEqual(['meta.id', 'meta.createdAt', 'meta.updatedAt', 'items[0].id', 'items[1].id']);
    expect(file.items).toHaveLength(2);
    expect(file.items[1]).toMatchObject({ title: 'B', tags: ['x'], content: 'Obsah B' });
    expect(new Set(file.items.map((i) => i.id)).size).toBe(2);
  });

  it('accepts CRLF, BOM, multi-line metadata comments and a callout with a custom title', () => {
    const md = `﻿${header}## A\r\n<!-- oqse:\r\nid: ${id(1)}\r\ntags: [x]\r\n-->\r\nObsah\r\n\r\n> [!HIDDEN]+ Ukázat\r\n> Tajné\r\n`.replace(/\n/g, '\r\n').replace(/\r\r/g, '\r');
    const { file } = parseMarkdownSet(md);
    expect(file.items[0]).toMatchObject({ id: id(1), tags: ['x'], content: 'Obsah', hiddenContent: 'Tajné' });
  });

  it('does not split on headings inside code fences', () => {
    const { file } = parseMarkdownSet(`${header}## A\nText\n\n\`\`\`md\n## Not a note\n> [!hidden]-\n\`\`\`\n`);
    expect(file.items).toHaveLength(1);
    expect(file.items[0]).toMatchObject({ content: 'Text\n\n```md\n## Not a note\n> [!hidden]-\n```' });
  });

  it.each([
    ['missing frontmatter', 'Body', /must start with "---"/],
    ['missing version', `---\ntitle: T\n---\n## A\nx`, /OQSE version/],
    ['description in frontmatter', `---\noqse: "0.2"\ndescription: x\n---\n`, /description as text/],
    ['heading above the chapter level', `---\noqse: "0.2"\nnoteHeadingLevel: 3\ntitle: T\nlanguage: cs\n---\n# Too high\n`, /Heading level 1 is not allowed/],
    ['text directly under a chapter', `${header}# Kapitola\nloose text\n## A\nx`, /must belong to a note/],
    ['reserved key in metadata', `${header}## A\n<!-- oqse: {content: x} -->\nx`, /"content" must not be/],
    ['topic in metadata with chapters', `${header}## A\n<!-- oqse: {topic: x} -->\nx`, /comes from the chapter heading/],
    ['unterminated comment', `${header}## A\n<!-- oqse: {id: x}\nx`, /Unterminated/],
    ['hidden callout not last', `${header}## A\nx\n\n> [!hidden]-\n> y\n\nmore`, /must be the last block/],
    ['empty note content', `${header}## A\n\n## B\nx`, /Content must not be empty/],
    ['duplicate IDs', `${header}## A\n<!-- oqse: {id: ${id(1)}} -->\nx\n\n## B\n<!-- oqse: {id: ${id(1)}} -->\ny`, /Duplicate ID/],
  ])('rejects %s', (_name, md, message) => {
    expect(() => parseMarkdownSet(md)).toThrow(MarkdownSetError);
    expect(() => parseMarkdownSet(md)).toThrow(message);
  });

  it('reports the line of the offending note', () => {
    const result = safeParseMarkdownSet(`${header}## A\nx\n\n## B\n\n## C\nz`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.line).toBe(12);
  });
});

describe('serializeMarkdownSet', () => {
  it('rejects sets with other item types', () => {
    const file = { ...set([]), items: [{ id: id(1), type: 'flashcard', front: 'a', back: 'b' }] } as OQSEFile;
    expect(() => serializeMarkdownSet(file)).toThrow(/Only sets of "note" items/);
  });

  it('rejects content with H1 headings and explicit levels that would split notes', () => {
    expect(() => serializeMarkdownSet(set([note(1, { content: '# H1' })]))).toThrow(/level-1 headings/);
    expect(() => serializeMarkdownSet(set([note(1, { content: '## H2' })]), { noteHeadingLevel: 2 })).toThrow(/level-2 headings/);
  });

  it('rejects content with a top-level hidden callout or an unclosed fence', () => {
    expect(() => serializeMarkdownSet(set([note(1, { content: 'a\n\n> [!hidden]-\n> x' })]))).toThrow(/use hiddenContent/);
    expect(() => serializeMarkdownSet(set([note(1, { content: '```js\nopen' })]))).toThrow(/unclosed code fence/);
  });

  it('rejects multi-line titles and metadata containing "-->"', () => {
    expect(() => serializeMarkdownSet(set([note(1, { title: 'a\nb' })]))).toThrow(/single line/);
    expect(() => serializeMarkdownSet(set([note(1, { explanation: 'a --> b' })]))).toThrow(/must not contain "-->"/);
  });
});
