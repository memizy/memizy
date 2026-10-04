import { describe, it, expect } from 'vitest';
import {
  loadOQSEFile,
  safeValidateOQSEFile,
  validateOQSEFile,
  OQSEValidationError,
} from './fileValidation';
import { resolveAsset } from './assets';
import { findRawHtml, prepareRichTextForDisplay } from './richTextProcessor';

const META_ID = '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a00';
const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

function file(items: unknown[], meta: Record<string, unknown> = {}) {
  return {
    version: '0.2',
    meta: {
      id: META_ID,
      language: 'cs',
      title: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...meta,
    },
    items,
  };
}

const note = (n: number, extra: Record<string, unknown> = {}) => ({ id: id(n), type: 'note', content: `Note ${n}`, ...extra });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('forward compatibility', () => {
  it('preserves unknown keys on root, meta and items', () => {
    const input = { ...file([note(1, { futureField: { a: 1 } })], { futureMeta: true }), futureRoot: 'x' };
    const result = validateOQSEFile(input) as unknown as Record<string, any>;
    expect(result.futureRoot).toBe('x');
    expect(result.meta.futureMeta).toBe(true);
    expect(result.items[0].futureField).toEqual({ a: 1 });
  });

  it('accepts custom x- item types and keeps their fields', () => {
    const custom = { id: id(1), type: 'x-code-challenge', language: 'js', tests: ['a'] };
    const result = validateOQSEFile(file([custom]));
    expect(result.items[0]).toEqual(custom);
  });

  it('does not mutate the input', () => {
    const input = file([note(1, { relatedItems: [id(9)] })]);
    const copy = structuredClone(input);
    loadOQSEFile(input);
    expect(input).toEqual(copy);
  });
});

describe('loadOQSEFile (best effort)', () => {
  it('skips an invalid item and loads the rest', () => {
    const result = loadOQSEFile(file([note(1), { id: id(2), type: 'note' }, note(3)]));
    expect(result.success).toBe(true);
    expect(result.data!.items.map((i) => i.id)).toEqual([id(1), id(3)]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'INVALID_ITEM', itemId: id(2), path: 'items[1].content' });
  });

  it('skips unknown non-prefixed item types with a warning', () => {
    const result = loadOQSEFile(file([note(1), { id: id(2), type: 'quiz' }]));
    expect(result.data!.items).toHaveLength(1);
    expect(codes(result.warnings)).toContain('UNKNOWN_ITEM_TYPE');
  });

  it('removes dangling references with a warning', () => {
    const result = loadOQSEFile(file([note(1, { relatedItems: [id(2), id(9)], dependencyItems: [id(1)] }), note(2)]));
    expect(result.data!.items[0].relatedItems).toEqual([id(2)]);
    expect(result.data!.items[0].dependencyItems).toEqual([]);
    expect(codes(result.warnings).filter((c) => c === 'DANGLING_REFERENCE')).toHaveLength(2);
  });

  it('drops duplicate IDs (keeps the first) and rejects an item reusing meta.id', () => {
    const result = loadOQSEFile(file([note(1), note(1, { content: 'dup' }), { ...note(5), id: META_ID }]));
    expect(result.data!.items).toHaveLength(1);
    expect(result.data!.items[0]).toMatchObject({ content: 'Note 1' });
    expect(codes(result.errors)).toEqual(['DUPLICATE_ID', 'DUPLICATE_ID']);
  });

  it('normalizes uppercase asset keys and reports collisions', () => {
    const img = { type: 'image', value: 'https://example.com/a.png', altText: 'a' };
    const ok = loadOQSEFile(file([note(1, { content: '<asset:Map />', assets: { Map: img } })]));
    expect(Object.keys(ok.data!.items[0].assets!)).toEqual(['map']);
    expect(codes(ok.warnings)).toContain('ASSET_KEY_NORMALIZED');
    expect(codes(ok.warnings)).not.toContain('MISSING_ASSET');

    const collision = loadOQSEFile(file([note(1, { assets: { Map: img, map: img } })]));
    expect(collision.data!.items).toHaveLength(0);
    expect(codes(collision.errors)).toContain('ASSET_KEY_COLLISION');
  });

  it('removes a missing thumbnail with a warning', () => {
    const result = loadOQSEFile(file([], { thumbnail: 'cover' }));
    expect(result.data!.meta.thumbnail).toBeUndefined();
    expect(codes(result.warnings)).toContain('MISSING_THUMBNAIL_ASSET');
  });

  it('fails only on critical errors', () => {
    expect(loadOQSEFile({ version: '0.2' }).success).toBe(false);
    expect(loadOQSEFile({ ...file([]), version: 'v1' }).success).toBe(false);
    expect(loadOQSEFile(file([], { title: '' })).success).toBe(false);
    const future = loadOQSEFile({ ...file([note(1)]), version: '1.0' });
    expect(future.success).toBe(true);
    expect(codes(future.warnings)).toContain('UNSUPPORTED_VERSION');
  });
});

describe('strict validation', () => {
  it('treats recoverable problems as errors', () => {
    const result = safeValidateOQSEFile(file([note(1, { relatedItems: [id(9)] })]));
    expect(result.success).toBe(false);
    expect(codes(result.errors)).toEqual(['DANGLING_REFERENCE']);
  });

  it('rejects duplicate item IDs', () => {
    expect(safeValidateOQSEFile(file([note(1), note(1)])).success).toBe(false);
  });

  it('throws OQSEValidationError with structured issues', () => {
    try {
      validateOQSEFile(file([{ id: id(1), type: 'flashcard', front: 'x' }]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OQSEValidationError);
      expect((e as OQSEValidationError).errors[0]).toMatchObject({ code: 'INVALID_ITEM', path: 'items[0].back' });
    }
  });

  it('requires targetAsset to exist with the right media type', () => {
    const base = { id: id(1), type: 'pin-on-image', question: 'Q', targetAsset: 'map', hotspots: [{ type: 'circle', x: 1, y: 1, radius: 1 }] };
    expect(codes(safeValidateOQSEFile(file([base])).errors)).toEqual(['MISSING_TARGET_ASSET']);
    const audio = { map: { type: 'audio', value: 'https://example.com/a.mp3' } };
    expect(codes(safeValidateOQSEFile(file([{ ...base, assets: audio }])).errors)).toEqual(['INVALID_TARGET_ASSET']);
    const image = { map: { type: 'image', value: 'https://example.com/a.png', altText: 'Map' } };
    expect(safeValidateOQSEFile(file([base], { assets: image })).success).toBe(true);
  });

  it('requires unique internal IDs within timeline and categorize items', () => {
    const timeline = {
      id: id(1),
      type: 'timeline',
      question: 'Q',
      events: [
        { id: 'a', text: 'A', date: '1900-01-01' },
        { id: 'a', text: 'B', date: '1910-01-01' },
      ],
    };
    expect(codes(safeValidateOQSEFile(file([timeline])).errors)).toEqual(['DUPLICATE_ID']);
  });

  it('warns about missing <asset:key /> references and shadowed global assets', () => {
    const img = { type: 'image', value: 'https://example.com/a.png', altText: 'a' };
    const result = safeValidateOQSEFile(file([note(1, { content: '<asset:nope /> <asset:map />', assets: { map: img } })], { assets: { map: img } }));
    expect(result.success).toBe(true);
    expect(codes(result.warnings).sort()).toEqual(['ASSET_SHADOWED', 'MISSING_ASSET']);
  });
});

describe('note heading convention', () => {
  it('warns when note content uses level-1 headings', () => {
    const result = safeValidateOQSEFile(file([note(1, { content: '# Title again' }), note(2, { content: '## Section' })]));
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => [w.code, w.path])).toEqual([['NOTE_HEADING_LEVEL', 'items[0].content']]);
  });
});

describe('raw HTML (Tier 1)', () => {
  it('rejects raw HTML unless the html feature is declared', () => {
    const html = note(1, { content: 'Hello <span style="color:red">red</span>' });
    expect(codes(safeValidateOQSEFile(file([html])).errors)).toEqual(['RAW_HTML_NOT_ALLOWED']);
    expect(safeValidateOQSEFile(file([html], { requirements: { features: ['markdown', 'html'] } })).success).toBe(true);
  });

  it('does not flag LaTeX inequalities, code, autolinks or OQSE tags', () => {
    const text = [
      'Inequality $a<b$ and $c>d$, display $$x<y>z$$',
      'Code `<div>` and',
      '```html\n<div class="x"></div>\n```',
      'Link <https://example.com> and <mail@example.com>',
      'Image <asset:map /> and comment <!-- note -->',
    ].join('\n');
    expect(findRawHtml(text, { latex: true })).toBeNull();
    expect(findRawHtml('Real <b>bold</b>', { latex: true })).toBe('<b>');
  });
});

describe('rich text tokens', () => {
  it('survive a Markdown parser that treats __x__ as bold', () => {
    // Minimal stand-in for marked / markdown-it emphasis handling.
    const markdownParser = (md: string) => md.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    const html = prepareRichTextForDisplay('See <asset:Map />', undefined, {
      markdownParser,
      assetReplacer: (key) => `<img data-key="${key}">`,
    });
    expect(html).toBe('See <img data-key="map">');
  });
});

describe('resolveAsset', () => {
  it('prefers item assets, falls back to meta assets, ignores case', () => {
    const a = { type: 'image' as const, value: 'https://a', altText: 'a' };
    const b = { type: 'image' as const, value: 'https://b', altText: 'b' };
    expect(resolveAsset('MAP', { assets: { map: a } }, { assets: { map: b } })).toBe(a);
    expect(resolveAsset('map', { assets: {} }, { assets: { map: b } })).toBe(b);
    expect(resolveAsset('none', undefined, undefined)).toBeUndefined();
  });
});
