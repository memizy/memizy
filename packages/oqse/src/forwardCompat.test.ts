/**
 * Forward compatibility: a file written by a later OQSE 1.x version must load in this
 * version, lose nothing when saved again, and never be rejected for a value of an open
 * field (OQSE "Open Values", "Error Handling", "Versioning and Compatibility").
 */

import { describe, it, expect } from 'vitest';
import { loadOQSEFile, safeValidateOQSEFile, withUnsupportedItems } from './fileValidation';
import { MAX_JSON_DEPTH } from './utils';
import { safeValidateOQSEProgress } from './progressValidation';
import { safeValidateOQSEManifest } from './manifestValidation';
import { safeValidateOQSEHeader } from './headerValidation';
import { checkCompatibility } from './compatibility';
import type { OQSEManifest } from './manifest';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;
const mcq = (n: number) => ({ id: id(n), type: 'mcq-single', question: `Q${n}?`, options: [{ id: 'x', text: 'x' }, { id: 'y', text: 'y' }], correctId: 'y' });
const set = (meta: Record<string, unknown> = {}, items: unknown[] = [mcq(1)]) => ({
  version: '1.1',
  meta: { id: id(0), language: 'en', title: 'Set', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...meta },
  items,
});
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('sets of a later 1.x version', () => {
  it('keep unknown keys of the root, meta, items and choices', () => {
    const file = set({ futureMeta: { a: 1 } }, [{ ...mcq(1), futureField: true, options: [{ id: 'x', text: 'x', futureHint: 'h' }, { id: 'y', text: 'y' }] }]);
    (file as Record<string, unknown>).futureRoot = 1;
    for (const result of [loadOQSEFile(file), safeValidateOQSEFile(file)]) {
      expect(result.success).toBe(true);
      const data = result.data as unknown as Record<string, any>;
      expect(data.futureRoot).toBe(1);
      expect(data.meta.futureMeta).toEqual({ a: 1 });
      expect(data.items[0].futureField).toBe(true);
      expect(data.items[0].options[0].futureHint).toBe('h');
    }
  });

  it('values of open fields are warnings, never errors, and are kept', () => {
    const video = { type: 'video', value: 'https://example.com/v.mp4', subtitles: [{ lang: 'en', value: 'https://example.com/c.vtt', kind: 'chapters' }] };
    const file = set(
      { assets: { doc: { type: 'document', value: 'https://example.com/a.pdf', altText: 'A' }, v: video } },
      [{ ...mcq(1), pedagogy: { bloomLevel: 'synthesize', cognitiveLoad: 'extreme' }, assets: { d: { type: 'hologram', value: 'https://example.com/h' } } }],
    );
    for (const result of [loadOQSEFile(file), safeValidateOQSEFile(file)]) {
      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
      expect(codes(result.warnings).filter((c) => c === 'UNKNOWN_VALUE')).toHaveLength(5);
      expect(result.data!.meta.assets!.doc.type).toBe('document');
      expect(result.data!.items[0].pedagogy!.bloomLevel).toBe('synthesize');
    }
  });

  it('a closed list still rejects other values', () => {
    const timeline = { id: id(2), type: 'timeline', question: 'Q', events: [{ id: 'a', text: 'A', date: '2000-01-01', precision: 'decade' }, { id: 'b', text: 'B', date: '2010-01-01' }] };
    const result = loadOQSEFile(set({}, [mcq(1), timeline]));
    expect(result.data!.items).toHaveLength(1);
    expect(codes(result.errors)).toContain('INVALID_ITEM');
  });

  it('items of unknown types are kept unchanged and written back in place', () => {
    const future = { id: id(2), type: 'audio-response', question: 'Say it', expected: ['hola'] };
    const file = set({}, [mcq(1), future, mcq(3)]);
    const loaded = loadOQSEFile(file);
    expect(loaded.success).toBe(true);
    expect(loaded.data!.items.map((item) => item.id)).toEqual([id(1), id(3)]);
    expect(loaded.unsupportedItems).toEqual([{ index: 1, item: future }]);
    expect(codes(loaded.warnings)).toContain('UNKNOWN_ITEM_TYPE');

    const strict = safeValidateOQSEFile(file);
    expect(strict.success).toBe(true); // a warning, not an error: an editor can save the set
    expect(strict.unsupportedItems).toHaveLength(1);
    const saved = withUnsupportedItems(strict.data!, strict.unsupportedItems);
    expect((saved.items as { id: string }[]).map((item) => item.id)).toEqual([id(1), id(2), id(3)]);
    expect((saved.items as unknown[])[1]).toEqual(future);
  });

  it('an unknown type keeps the common rules (ID, duplicates, a type name)', () => {
    const result = loadOQSEFile(set({}, [mcq(1), { id: id(1), type: 'audio-response' }, { id: 'nope', type: 'audio-response' }, { id: id(4), type: 'Audio Response' }]));
    expect(result.unsupportedItems).toEqual([]);
    expect(codes(result.errors)).toEqual(['DUPLICATE_ID', 'INVALID_ITEM', 'INVALID_ITEM']);
  });

  it('dangling references may point to items of unknown types', () => {
    const result = safeValidateOQSEFile(set({}, [{ ...mcq(1), relatedItems: [id(2)] }, { id: id(2), type: 'audio-response' }]));
    expect(result.errors).toEqual([]);
  });

  it('unknown OQSE tags do not break an item', () => {
    const result = safeValidateOQSEFile(set({}, [{ ...mcq(1), question: 'Define <term:photosynthesis />' }]));
    expect(result.success).toBe(true);
  });
});

describe('sources', () => {
  const lesson = { id: 'course', kind: 'lesson', title: 'Spanish A2', set: id(0) };
  const note = { id: id(5), type: 'note', content: 'The preterite is used for completed actions.' };

  it('the 1.0 shape: kind, locators, a lesson in this set with a quote', () => {
    const sources = [
      { id: 'wiki', kind: 'web', title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Raptor' },
      { id: 'book', kind: 'book', title: 'Physics', isbn: '978-80-7196-123-4', url: 'https://example.com/physics.pdf', mimeType: 'application/pdf' },
      { id: 'paper', kind: 'article', title: 'Paper', doi: '10.1038/s41586-021-04106-z' },
      lesson,
    ];
    const item = { ...mcq(1), sources: [{ id: 'course', itemId: id(5), location: 'Lesson 2', quote: 'completed actions' }, { id: 'book', location: 'page 42' }] };
    const result = safeValidateOQSEFile(set({ sourceMaterials: sources }, [item, note]));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('a lesson item that does not exist in this set is a dangling reference', () => {
    const file = set({ sourceMaterials: [lesson] }, [{ ...mcq(1), sources: [{ id: 'course', itemId: id(9) }] }]);
    expect(codes(safeValidateOQSEFile(file).errors)).toEqual(['DANGLING_REFERENCE']);
    const loaded = loadOQSEFile(file);
    expect(loaded.data!.items[0].sources).toEqual([{ id: 'course' }]);
    // In another set the item cannot be checked here: applications ignore what they cannot resolve.
    const other = set({ sourceMaterials: [{ ...lesson, set: id(50) }] }, [{ ...mcq(1), sources: [{ id: 'course', itemId: id(9) }] }]);
    expect(safeValidateOQSEFile(other).errors).toEqual([]);
  });

  it('the release-candidate shape is not converted here (scripts/migrate-oqse does it): the source stays, cited by its title', () => {
    const result = loadOQSEFile(set({ sourceMaterials: [{ id: 'a', type: 'url', value: 'https://example.com', title: 'Web' }] }));
    expect(result.success).toBe(true);
    expect(result.data!.meta.sourceMaterials).toEqual([{ id: 'a', type: 'url', value: 'https://example.com', title: 'Web' }]);
    expect(codes(result.warnings)).toContain('SOURCE_WITHOUT_LOCATOR');
  });

  it('a bad source never makes the set unreadable; unknown kinds and missing locators are warnings', () => {
    const sources = [
      { id: 'bad', title: 'Bad', doi: 'not-a-doi' },
      { id: 'future', kind: 'podcast', title: 'Future', url: 'https://example.com/p' },
      { id: 'printed', kind: 'book', title: 'An old script' },
    ];
    const loaded = loadOQSEFile(set({ sourceMaterials: sources }));
    expect(loaded.success).toBe(true);
    expect(loaded.data!.meta.sourceMaterials!.map((s) => s.id)).toEqual(['future', 'printed']);
    expect(codes(loaded.errors)).toEqual(['INVALID_SOURCE']);
    expect(codes(loaded.warnings)).toEqual(expect.arrayContaining(['UNKNOWN_VALUE', 'SOURCE_WITHOUT_LOCATOR']));
  });
});

describe('real-world data never makes a set unreadable for an optional detail', () => {
  const deep = (levels: number) => {
    let value: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < levels; i++) value = { next: value };
    return value;
  };

  it('accepts BCP 47 tags with numeric regions and variants, and converts underscores', () => {
    for (const language of ['es-419', 'en-gb', 'zh-Hant-TW', 'de-CH-1996', 'yue']) {
      expect(safeValidateOQSEFile(set({ language })).errors, language).toEqual([]);
    }
    const loaded = loadOQSEFile(set({ language: 'cs_CZ' }, [{ ...mcq(1), lang: 'en_US' }]));
    expect(loaded.data!.meta.language).toBe('cs-CZ');
    expect(loaded.data!.items[0].lang).toBe('en-US');
    expect(codes(loaded.warnings).filter((c) => c === 'LANGUAGE_NORMALIZED')).toHaveLength(2);
  });

  it('accepts RFC 3339 times with any fraction of a second (databases write microseconds)', () => {
    const result = safeValidateOQSEFile(set({ createdAt: '2026-01-01T00:00:00.123456Z', updatedAt: '2026-01-02T00:00:00.5+01:00' }));
    expect(result.errors).toEqual([]);
  });

  it('removes an invalid optional meta field or entry instead of refusing the set', () => {
    const result = loadOQSEFile(
      set({
        author: { name: 'A', email: 'a(at)b.cz' },
        licenseUrl: 'see the website',
        description: 'x'.repeat(5001),
        tags: ['a'],
        tagDefinitions: { a: { wikidataId: 'q42' }, b: { wikidataId: 'Q42' } },
        assets: { ok: { type: 'image', value: 'https://example.com/a.png', altText: 'A' }, bad: { type: 'image' } },
      }),
    );
    expect(result.success).toBe(true);
    const meta = result.data!.meta as unknown as Record<string, any>;
    expect([meta.author, meta.licenseUrl, meta.description]).toEqual([undefined, undefined, undefined]);
    expect(Object.keys(meta.tagDefinitions)).toEqual(['b']);
    expect(Object.keys(meta.assets)).toEqual(['ok']);
    expect(new Set(codes(result.errors))).toEqual(new Set(['INVALID_META_FIELD']));
    // A required field still has to be right.
    expect(loadOQSEFile(set({ createdAt: 'yesterday' })).success).toBe(false);
  });

  it('allows deep free-form data up to the fixed depth limit', () => {
    expect(loadOQSEFile(set({ customData: deep(8) }, [{ ...mcq(1), appSpecific: { memizy: deep(10) } }])).success).toBe(true);
    expect(codes(loadOQSEFile(set({ customData: deep(MAX_JSON_DEPTH) })).errors)).toEqual(['SECURITY_LIMIT']);
  });

  it('accepts subtitles from any URI (a format the application cannot read is not offered)', () => {
    const video = { type: 'video', value: 'https://example.com/v.mp4', subtitles: [{ lang: 'en', value: 'https://api.example.com/subtitles?id=1' }] };
    expect(safeValidateOQSEFile(set({ assets: { v: video } })).errors).toEqual([]);
  });
});

describe('progress, manifests and headers of a later 1.x version', () => {
  const progress = () => ({
    version: '1.1',
    meta: { setId: id(0), exportedAt: '2026-01-01T00:00:00Z', futureMeta: 1 },
    futureRoot: 1,
    records: {
      [id(1)]: {
        bucket: 2,
        starred: true,
        futureField: 'x',
        stats: { attempts: 1, incorrect: 0, streak: 1, futureStat: 3 },
        lastAnswer: { isCorrect: false, answeredAt: '2026-01-01T00:00:00Z', answer: ['x'], futureAnswerField: 1 },
      },
    },
  });

  it('OQSEP keeps starred, the last answer and unknown keys', () => {
    const result = safeValidateOQSEProgress(progress());
    expect(result.success).toBe(true);
    const data = result.data as unknown as Record<string, any>;
    const record = data.records[id(1)];
    expect(record.starred).toBe(true);
    expect(record.lastAnswer.answer).toEqual(['x']);
    expect([data.futureRoot, data.meta.futureMeta, record.futureField, record.stats.futureStat, record.lastAnswer.futureAnswerField]).toEqual([1, 1, 'x', 3, 1]);
  });

  it('OQSEP accepts records of any item ID (generated items) and fractions of seconds', () => {
    const p = progress();
    (p.records as Record<string, unknown>)['lichess-00AbC'] = { bucket: 1, stats: { attempts: 1, incorrect: 0, streak: 1 } };
    p.meta.exportedAt = '2026-01-01T00:00:00.123456Z';
    expect(safeValidateOQSEProgress(p).success).toBe(true);
  });

  it('OQSEP limits the stored answer to 4 KB', () => {
    const big = progress();
    big.records[id(1)].lastAnswer.answer = ['x'.repeat(5000)];
    expect(safeValidateOQSEProgress(big).success).toBe(false);
  });

  it('OQSEM accepts and keeps types, actions, asset categories and keys it does not know', () => {
    const manifest = {
      version: '1.1',
      id: 'https://example.com/app',
      appName: 'App',
      studyMode: 'tournament',
      futureTop: { a: 1 },
      capabilities: { actions: ['render', 'review'], types: ['mcq-single', 'audio-response'], assets: { image: ['*'], document: ['application/pdf'] } },
    };
    const result = safeValidateOQSEManifest(manifest);
    expect(result.success).toBe(true);
    const data = result.data as unknown as Record<string, any>;
    expect(data.futureTop).toEqual({ a: 1 });
    expect(data.capabilities.assets.document).toEqual(['application/pdf']);
    expect(data.capabilities.types).toContain('audio-response');
  });

  it('OQSEH keeps unknown keys', () => {
    const result = safeValidateOQSEHeader({ id: id(0), title: 'T', language: 'en', updatedAt: '2026-01-01T00:00:00Z', url: 'https://example.com/s.json', futureKey: 1 });
    expect(result.success).toBe(true);
    expect((result.data as unknown as Record<string, unknown>).futureKey).toBe(1);
  });

  it('a media type of a later version is not an incompatibility (it falls back to a link)', () => {
    const file = loadOQSEFile(set({ assets: { doc: { type: 'document', value: 'https://example.com/a.pdf', altText: 'A' } } })).data!;
    const manifest = { version: '1.0', id: 'https://example.com/app', appName: 'A', capabilities: { actions: ['render'], types: ['mcq-single'] } } as OQSEManifest;
    expect(checkCompatibility(file, manifest).unsupportedAssets).toEqual([]);
  });
});
