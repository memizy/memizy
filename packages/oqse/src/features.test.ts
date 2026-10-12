import { describe, it, expect } from 'vitest';
import { detectFeatures, effectiveFeatures, looksLikeLatex } from './features';
import type { OQSEAnyItem, OQSEMeta } from './oqse';

const meta = (extra: Partial<OQSEMeta> = {}) => ({ id: 'm', language: 'cs', title: 'T', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...extra }) as OQSEMeta;
const note = (content: string, extra: Record<string, unknown> = {}) => ({ id: 'n', type: 'note', content, ...extra }) as unknown as OQSEAnyItem;
const detect = (content: string, m = meta()) => detectFeatures({ meta: m, items: [note(content)] });

describe('detectFeatures', () => {
  it('finds Markdown constructs, not plain text', () => {
    expect(detect('Just a sentence, with snake_case and 2 * 3 * 4.')).toEqual([]);
    for (const text of ['## Heading', 'Some **bold**', 'An *emphasis*', 'An _emphasis_', '~~old~~', '- item', '1. first', '> quote', '[link](https://x.org)', 'Use `code`', '| a | b |\n| --- | --- |', '---']) {
      expect(detect(text), text).toEqual(['markdown']);
    }
  });

  it('finds blocks by the language of fenced code', () => {
    expect(detect('```mermaid\ngraph LR\n```')).toEqual(['markdown', 'mermaid']);
    expect(detect('```smiles\nCCO\n```\n\n```abc\nX:1\n```')).toEqual(['markdown', 'smiles', 'abc-notation']);
    expect(detect('```java\nint x;\n```')).toEqual(['markdown', 'syntax-highlighting']);
    expect(detect('```\nplain\n```')).toEqual(['markdown']);
  });

  it('finds raw HTML, but not sub, sup and br', () => {
    expect(detect('A <span>b</span>')).toEqual(['html']);
    expect(detect('H<sub>2</sub>O')).toEqual([]);
  });

  it('detects rtl from the languages and never latex', () => {
    expect(detect('שלום', meta({ language: 'he' }))).toEqual(['rtl']);
    expect(detectFeatures({ meta: meta(), items: [note('x', { lang: 'ar-EG' })] })).toEqual(['rtl']);
    expect(detect('$x^2$')).toEqual([]);
  });

  it('with latex, formulas are not read as Markdown', () => {
    expect(detect('$a_1 + b_1$', meta({ requirements: { features: ['latex'] } }))).toEqual([]);
  });

  it('effective features are the declared and the detected ones', () => {
    const m = meta({ requirements: { features: ['latex', 'x-mine'] } });
    expect(effectiveFeatures({ meta: m, items: [note('**bold** $x$')] })).toEqual(['latex', 'x-mine', 'markdown']);
  });
});

describe('looksLikeLatex', () => {
  it('is a heuristic for formulas between $', () => {
    expect(looksLikeLatex('Area $\\pi r^2$')).toBe(true);
    expect(looksLikeLatex('$$\\frac{a}{b}$$')).toBe(true);
    expect(looksLikeLatex('It costs $5 and $10.')).toBe(false);
    expect(looksLikeLatex('Run `echo $PATH_x$` in a shell')).toBe(false);
  });
});
