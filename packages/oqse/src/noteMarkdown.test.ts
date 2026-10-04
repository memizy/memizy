import { describe, it, expect } from 'vitest';
import type { NoteItem } from './oqse';
import {
  parseNoteMarkdown,
  safeParseNoteMarkdown,
  serializeNoteMarkdown,
  NoteMarkdownError,
} from './noteMarkdown';

const ID = '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a10';

const MERMAID = [
  '```mermaid',
  'graph TD',
  '  A["Start (t=0)"] -->|"x > 0 & y < 1"| B{"Is it \\"done\\"?"}',
  "  B -- 'yes' --> C[End]",
  '```',
].join('\n');

const LATEX = String.raw`$$
\Delta U = Q - W \quad \text{where} \quad \frac{\partial U}{\partial T}\bigg|_{V} = C_V
$$`;

const minimal: NoteItem = { id: ID, type: 'note', content: 'Hello **world**.' };

const full: NoteItem = {
  id: ID,
  type: 'note',
  title: 'První zákon: "energie" & $money$ ✨',
  tags: ['physics', 'thermo: basics'],
  topic: 'Thermodynamics',
  difficulty: 3,
  hints: ['Think about $Q$.'],
  sources: [{ id: 'src-1', location: 'page 12', quote: 'Energy: $E = mc^2$ "quoted"' }],
  customData: { nested: { list: [1, 2, 3], flag: true, empty: null } },
  appSpecific: { memizy: { color: '#ff0000' } },
  content: `# Nadpis – Žluťoučký kůň 🐎\n\nSome text with \`code\` and a quote:\n\n> A normal quote\n\n> [!note] Another callout\n> stays in content\n\n${MERMAID}\n\n${LATEX}\n\nPrice: $5 and \\$10.`,
  hiddenContent: `Answer with code:\n\n\`\`\`js\nconst x = "a\\\\b";\n\`\`\`\n\n> nested quote\n\n${MERMAID}`,
};

describe('note markdown round-trip', () => {
  it.each([
    ['minimal', minimal],
    ['full', full],
  ])('json -> md -> json is lossless (%s)', (_name, item) => {
    expect(parseNoteMarkdown(serializeNoteMarkdown(item))).toEqual(item);
  });

  it('keeps Mermaid and LaTeX verbatim in the Markdown (no escaping)', () => {
    const md = serializeNoteMarkdown(full);
    expect(md).toContain(MERMAID);
    expect(md).toContain(LATEX);
  });

  it('produces the canonical format', () => {
    const md = serializeNoteMarkdown({
      id: ID,
      type: 'note',
      title: 'Title',
      tags: ['a'],
      content: 'Body',
      hiddenContent: 'Line 1\n\nLine 2',
    });
    expect(md).toBe(
      `---\nid: ${ID}\ntitle: Title\ntags:\n  - a\n---\nBody\n\n> [!hidden]-\n> Line 1\n>\n> Line 2\n`,
    );
  });

  it('does not treat a hidden callout inside a code fence as hiddenContent', () => {
    const item: NoteItem = {
      id: ID,
      type: 'note',
      content: 'Example:\n\n````markdown\n> [!hidden]-\n> secret\n````',
    };
    const md = serializeNoteMarkdown(item);
    expect(parseNoteMarkdown(md)).toEqual(item);
  });

  it('ignores leading and trailing blank lines', () => {
    const parsed = parseNoteMarkdown(`---\nid: ${ID}\n---\n\n\nBody\n\n\n`);
    expect(parsed.content).toBe('Body');
  });
});

describe('parseNoteMarkdown', () => {
  it('accepts CRLF line endings and a BOM', () => {
    const md = `﻿---\r\nid: ${ID}\r\n---\r\nBody\r\n\r\n> [!hidden]-\r\n> Secret\r\n`;
    expect(parseNoteMarkdown(md)).toEqual({ id: ID, type: 'note', content: 'Body', hiddenContent: 'Secret' });
  });

  it('accepts the callout case-insensitively, open or folded, with a custom title', () => {
    const md = `---\nid: ${ID}\n---\nBody\n\n> [!HIDDEN]+ Show answer\n> Secret\n`;
    expect(parseNoteMarkdown(md).hiddenContent).toBe('Secret');
  });

  it('accepts an explicit type: note', () => {
    expect(parseNoteMarkdown(`---\nid: ${ID}\ntype: note\n---\nBody\n`).type).toBe('note');
  });

  it.each([
    ['missing frontmatter', 'Body only', /must start with "---"/],
    ['unterminated frontmatter', `---\nid: ${ID}\nBody`, /missing closing/],
    ['invalid YAML', `---\nid: [unclosed\n---\nBody`, /Invalid YAML/],
    ['frontmatter not a mapping', `---\n- a\n---\nBody`, /YAML mapping/],
    ['content in frontmatter', `---\nid: ${ID}\ncontent: x\n---\nBody`, /"content" must not be/],
    ['other item type', `---\nid: ${ID}\ntype: flashcard\n---\nBody`, /Only "note" items/],
    ['two hidden callouts', `---\nid: ${ID}\n---\nA\n\n> [!hidden]-\n> x\n\n> [!hidden]-\n> y`, /Only one/],
    ['callout not last', `---\nid: ${ID}\n---\nA\n\n> [!hidden]-\n> x\n\nMore text`, /must be the last block/],
    ['callout not after blank line', `---\nid: ${ID}\n---\nA\n> [!hidden]-\n> x`, /preceded by a blank line/],
    ['invalid id', `---\nid: not-a-uuid\n---\nBody`, /Invalid note/],
  ])('rejects %s', (_name, md, message) => {
    expect(() => parseNoteMarkdown(md)).toThrow(NoteMarkdownError);
    expect(() => parseNoteMarkdown(md)).toThrow(message);
  });

  it('reports the line number of the offending line', () => {
    const result = safeParseNoteMarkdown(`---\nid: ${ID}\n---\nA\n\n> [!hidden]-\n> x\nplain`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.line).toBe(8);
  });
});

describe('serializeNoteMarkdown', () => {
  it('rejects content with a top-level hidden callout', () => {
    expect(() =>
      serializeNoteMarkdown({ id: ID, type: 'note', content: 'A\n\n> [!hidden]-\n> x' }),
    ).toThrow(/use hiddenContent instead/);
  });

  it('rejects content ending inside an unclosed code fence', () => {
    expect(() => serializeNoteMarkdown({ id: ID, type: 'note', content: '```js\nopen' })).toThrow(/unclosed code fence/);
  });

  it('omits an empty hiddenContent', () => {
    expect(serializeNoteMarkdown({ id: ID, type: 'note', content: 'A', hiddenContent: '  \n' })).not.toContain('[!hidden]');
  });
});
