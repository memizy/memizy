import { describe, it, expect } from 'vitest';
import type { NoteItem, OQSEFile } from './oqse';
import { parseMarkdownSet, safeParseMarkdownSet, serializeMarkdownSet, MarkdownSetError } from './markdownSet';
import { shiftHeadings } from './markdownUtils';
import { prepareRichTextForDisplay } from './richTextProcessor';

const META_ID = '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a00';
const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

const MERMAID = [
  '```mermaid',
  'graph TD',
  '  A["Start (t=0)"] -->|"x > 0 & y < 1"| B{"Is it \\"done\\"?"}',
  '  %% a comment',
  '# not a heading inside a fence',
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

  it('rich set: topics, metadata, hidden content, Mermaid, LaTeX, unicode, relative headings', () => {
    const file = set(
      [
        note(1, { topic: 'Základní zákony', tags: ['fyzika', 'a: b'], content: `Úvod $\\Delta U$ 🐎\n\n## Odvození\n\n${MERMAID}\n\n${LATEX}`, hiddenContent: `## Odpověď\n\n${MERMAID}\n\n> citace` }),
        note(2, { topic: 'Základní zákony', difficulty: 3, hints: ['Pomůcka $Q$'], customData: { nested: { list: [1, 2] } } }),
        note(3, { topic: 'Aplikace', content: '### Podnadpis\n\nText\n\n> [!note] Jiný callout\n> zůstává v obsahu' }),
        note(4), // no topic after a topic -> empty chapter heading resets it
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

  it('shifts headings inside notes relative to the note level', () => {
    const md = serializeMarkdownSet(set([note(1, { content: '## Sekce\n\n### Podsekce', hiddenContent: '## Skrytá sekce' })]));
    expect(md).toContain('\n#### Sekce\n');
    expect(md).toContain('\n##### Podsekce');
    expect(md).toContain('> #### Skrytá sekce');
  });

  it('falls back to a lower note level when content headings are too deep', () => {
    const file = set([note(1, { topic: 'Kapitola', content: '##### Hluboko' })]);
    const md = serializeMarkdownSet(file);
    expect(md).toContain('noteHeadingLevel: 2');
    expect(md).toContain('title: Termodynamika'); // no title heading at level 2
    expect(roundTrip(file)).toEqual(file);

    const deepest = set([note(1, { topic: 'Kapitola', content: '###### Nejhlouběji' })]);
    expect(serializeMarkdownSet(deepest)).toContain('noteHeadingLevel: 1');
    expect(roundTrip(deepest)).toEqual(deepest);
  });

  it('produces the canonical format', () => {
    const md = serializeMarkdownSet(
      set([note(1, { topic: 'Kapitola', tags: ['a'], content: 'Obsah 1\n\n## Sekce', hiddenContent: 'Line 1\n\nLine 2' })], { requirements: undefined, description: 'Popis' }),
    );
    expect(md).toBe(
      [
        '---',
        'oqse: "0.2"',
        `id: ${META_ID}`,
        'language: cs',
        'createdAt: 2026-01-01T00:00:00Z',
        'updatedAt: 2026-01-02T00:00:00Z',
        '---',
        '# Termodynamika',
        '',
        'Popis',
        '',
        '## Kapitola',
        '',
        '### Poznámka 1',
        `<!-- oqse: {id: ${id(1)}, tags: [a]} -->`,
        'Obsah 1',
        '',
        '#### Sekce',
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
  const header = `---\noqse: "0.2"\nid: ${META_ID}\nlanguage: cs\ncreatedAt: 2026-01-01T00:00:00Z\nupdatedAt: 2026-01-01T00:00:00Z\n---\n# T\n`;

  it('parses the conventional structure and generates missing IDs and dates', () => {
    const { file, generated } = parseMarkdownSet(
      '---\noqse: "0.2"\nlanguage: cs\n---\n# Termodynamika\n\nÚvod.\n\n## Zákony\n\n### A\nObsah A\n\n#### Detail\n\n### B\n<!-- oqse: {tags: [x]} -->\nObsah B\n',
    );
    expect(generated).toEqual(['meta.id', 'meta.createdAt', 'meta.updatedAt', 'items[0].id', 'items[1].id']);
    expect(file.meta).toMatchObject({ title: 'Termodynamika', description: 'Úvod.' });
    expect(file.items[0]).toMatchObject({ title: 'A', topic: 'Zákony', content: 'Obsah A\n\n## Detail' });
    expect(file.items[1]).toMatchObject({ title: 'B', topic: 'Zákony', tags: ['x'], content: 'Obsah B' });
  });

  it('accepts the title only in the frontmatter (no title heading)', () => {
    const { file } = parseMarkdownSet('---\noqse: "0.2"\ntitle: T\nlanguage: cs\n---\nPopis\n\n## K\n\n### A\nx\n');
    expect(file.meta).toMatchObject({ title: 'T', description: 'Popis' });
  });

  it('supports noteHeadingLevel 2 (chapters #, notes ##)', () => {
    const { file } = parseMarkdownSet('---\noqse: "0.2"\nnoteHeadingLevel: 2\ntitle: T\nlanguage: cs\n---\n# K\n\n## A\nx\n\n### Sekce\n');
    expect(file.items[0]).toMatchObject({ title: 'A', topic: 'K', content: 'x\n\n## Sekce' });
  });

  it('accepts CRLF, BOM, multi-line metadata comments and a callout with a custom title', () => {
    const md = `﻿${header}### A\n<!-- oqse:\nid: ${id(1)}\ntags: [x]\n-->\nObsah\n\n> [!HIDDEN]+ Ukázat\n> Tajné\n`.replace(/\n/g, '\r\n');
    const { file } = parseMarkdownSet(md);
    expect(file.items[0]).toMatchObject({ id: id(1), tags: ['x'], content: 'Obsah', hiddenContent: 'Tajné' });
  });

  it('does not split on headings inside code fences', () => {
    const { file } = parseMarkdownSet(`${header}### A\nText\n\n\`\`\`md\n## Not a chapter\n> [!hidden]-\n\`\`\`\n`);
    expect(file.items).toHaveLength(1);
    expect(file.items[0]).toMatchObject({ content: 'Text\n\n```md\n## Not a chapter\n> [!hidden]-\n```' });
  });

  it.each([
    ['missing frontmatter', 'Body', /must start with "---"/],
    ['missing version', `---\ntitle: T\n---\n### A\nx`, /OQSE version/],
    ['description in frontmatter', `---\noqse: "0.2"\ndescription: x\n---\n`, /description as text/],
    ['title heading differs from frontmatter', `---\noqse: "0.2"\ntitle: A\nlanguage: cs\n---\n# B\n### N\nx`, /differs from "title"/],
    ['two title headings', `${header}### A\nx\n# Second`, /must come before|Only one/],
    ['text before the title heading', `---\noqse: "0.2"\nlanguage: cs\n---\nIntro\n# T\n### A\nx`, /before the set title/],
    ['only chapters, no notes (hint)', `${header}## A\nx`, /No note headings found.*noteHeadingLevel/],
    ['heading above the title level', `---\noqse: "0.2"\nnoteHeadingLevel: 4\ntitle: T\nlanguage: cs\n---\n# Too high\n`, /Heading level 1 is not allowed/],
    ['text directly under a chapter', `${header}## Kapitola\nloose text\n### A\nx`, /must belong to a note/],
    ['reserved key in metadata', `${header}### A\n<!-- oqse: {content: x} -->\nx`, /"content" must not be/],
    ['topic in metadata with chapters', `${header}### A\n<!-- oqse: {topic: x} -->\nx`, /comes from the chapter heading/],
    ['unterminated comment', `${header}### A\n<!-- oqse: {id: x}\nx`, /Unterminated/],
    ['hidden callout not last', `${header}### A\nx\n\n> [!hidden]-\n> y\n\nmore`, /must be the last block/],
    ['empty note content', `${header}### A\n\n### B\nx`, /Content must not be empty/],
    ['duplicate IDs', `${header}### A\n<!-- oqse: {id: ${id(1)}} -->\nx\n\n### B\n<!-- oqse: {id: ${id(1)}} -->\ny`, /Duplicate ID/],
  ])('rejects %s', (_name, md, message) => {
    expect(() => parseMarkdownSet(md)).toThrow(MarkdownSetError);
    expect(() => parseMarkdownSet(md)).toThrow(message);
  });

  it('reports the line of the offending note', () => {
    const result = safeParseMarkdownSet(`${header}### A\nx\n\n### B\n\n### C\nz`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.line).toBe(12);
  });
});

describe('serializeMarkdownSet', () => {
  it('rejects sets with other item types', () => {
    const file = { ...set([]), items: [{ id: id(1), type: 'flashcard', front: 'a', back: 'b' }] } as OQSEFile;
    expect(() => serializeMarkdownSet(file)).toThrow(/Only sets of "note" items/);
  });

  it('rejects level-1 headings in note content and explicit levels that cannot fit', () => {
    expect(() => serializeMarkdownSet(set([note(1, { content: '# H1' })]))).toThrow(/must start at level 2/);
    expect(() => serializeMarkdownSet(set([note(1, { content: '##### H5' })]), { noteHeadingLevel: 3 })).toThrow(/cannot represent/);
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

describe('heading helpers', () => {
  it('shiftHeadings shifts ATX headings outside code fences and clamps to 1-6', () => {
    expect(shiftHeadings('## A\n```\n## code\n```\n###### B\n#hashtag', 2)).toBe('#### A\n```\n## code\n```\n###### B\n#hashtag');
    expect(shiftHeadings('## A', -5)).toBe('# A');
  });

  it('prepareRichTextForDisplay applies headingOffset', () => {
    const html = prepareRichTextForDisplay('## Sekce', undefined, { markdownParser: (md) => md, headingOffset: 1 });
    expect(html).toBe('### Sekce');
  });
});
