import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROTOCOL_VERSION,
  negotiateProtocolVersion,
  isProtocolSupported,
  compareProtocolVersions,
  ProtocolError,
  toProtocolError,
  findNonJson,
  assertJsonWithin,
  RateLimiter,
  LIMITS,
  SettingDefinitionSchema,
  resolveSettings,
  localize,
  safeParsePluginManifest,
  readPluginManifestFromHtml,
  extractManifestFromHtml,
  parseHostCall,
  HOST_API_ARGS,
  HOST_API_METHODS,
  type SettingDefinition,
 settingsForMode
} from './index';

const root = resolve(import.meta.dirname, '../../..');

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function manifest(memizy: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    version: '0.2',
    id: 'https://example.com/plugins/test',
    appName: 'Test',
    capabilities: { actions: ['render'], types: ['mcq-single'] },
    appSpecific: { memizy },
    ...extra,
  };
}

const multiplayer = { players: { min: 2, max: 40 }, hostAs: ['presenter', 'player'] };

// ----------------------------------------------------------------------------

describe('version negotiation', () => {
  it('negotiates the lower minor of the same major', () => {
    expect(negotiateProtocolVersion('1.0', '1.3')).toBe('1.0');
    expect(negotiateProtocolVersion('1.4', '1.2')).toBe('1.2');
    expect(negotiateProtocolVersion('2.0', '1.9')).toBeNull();
    expect(negotiateProtocolVersion('1', '1.0')).toBeNull();
  });

  it('checks whether a host can run a plugin before loading it', () => {
    expect(isProtocolSupported('1.0')).toBe(true);
    expect(isProtocolSupported('1.1', '1.0')).toBe(false);
    expect(isProtocolSupported('2.0', '1.5')).toBe(false);
    expect(PROTOCOL_VERSION).toBe('1.0');
    expect(compareProtocolVersions('1.10', '1.9')).toBeGreaterThan(0);
  });
});

describe('errors', () => {
  it('keep their code after crossing the iframe boundary as a plain Error', () => {
    const original = new ProtocolError('RATE_LIMITED', 'Too many messages');
    const transported = new Error(original.message); // Penpal keeps only name + message
    const restored = toProtocolError(transported);
    expect(restored.code).toBe('RATE_LIMITED');
    expect(restored.detail).toBe('Too many messages');
  });

  it('turn unknown codes and foreign errors into INTERNAL_ERROR', () => {
    expect(toProtocolError(new Error('[SOMETHING_NEW] x')).code).toBe('INTERNAL_ERROR');
    expect(toProtocolError('boom').code).toBe('INTERNAL_ERROR');
  });
});

describe('limits', () => {
  it('accepts only plain JSON', () => {
    expect(findNonJson({ a: [1, 'x', true, null, { b: 2 }] })).toBeNull();
    expect(findNonJson({ a: undefined })).toMatch(/\$\.a is a undefined/);
    expect(findNonJson({ f: () => 1 })).toMatch(/function/);
    expect(findNonJson({ n: NaN })).toMatch(/finite/);
    expect(findNonJson({ d: new Date() })).toMatch(/plain object/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(findNonJson(cyclic)).toMatch(/circular/);
    const shared = { x: 1 };
    expect(findNonJson({ a: shared, b: shared })).toBeNull(); // shared, not circular
  });

  it('enforces size limits with the right error code', () => {
    expect(assertJsonWithin({ a: 'x' }, LIMITS.messageBytes, 'MESSAGE_TOO_LARGE', 'message')).toBeLessThan(20);
    const big = 'x'.repeat(LIMITS.messageBytes);
    expect(() => assertJsonWithin(big, LIMITS.messageBytes, 'MESSAGE_TOO_LARGE', 'message')).toThrow(/\[MESSAGE_TOO_LARGE\]/);
    expect(() => assertJsonWithin({ a: undefined }, 100, 'DATA_TOO_LARGE', 'data')).toThrow(/\[INVALID_ARGUMENT\]/);
    expect(assertJsonWithin('č', 10, 'DATA_TOO_LARGE', 'data')).toBe(4); // UTF-8 bytes incl. quotes
  });

  it('rate limiter allows the burst, then the sustained rate', () => {
    let t = 0;
    const limiter = new RateLimiter(LIMITS.messagesPerSecond, LIMITS.messageBurst, () => t);
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (limiter.tryTake()) allowed++;
    expect(allowed).toBe(60);
    t += 1000;
    allowed = 0;
    for (let i = 0; i < 100; i++) if (limiter.tryTake()) allowed++;
    expect(allowed).toBe(30);
  });
});

describe('settings', () => {
  const defs: SettingDefinition[] = [
    { id: 'time', type: 'number', label: 'Time', default: 20, min: 5, max: 120 },
    { id: 'sound', type: 'boolean', label: { cs: 'Zvuk', en: 'Sound' }, default: true },
    { id: 'map', type: 'select', label: 'Map', default: 'eu', options: [{ value: 'eu', label: 'Europe' }, { value: 'cz', label: 'Česko' }] },
    { id: 'title', type: 'text', label: 'Title', default: '', maxLength: 10 },
  ];

  it('validates definitions', () => {
    for (const def of defs) expect(SettingDefinitionSchema.safeParse(def).success).toBe(true);
    expect(SettingDefinitionSchema.safeParse({ ...defs[0], default: 500 }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[0], min: 50, max: 10 }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[2], default: 'us' }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[2], options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }], default: 'a' }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[3], default: 'way too long text' }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[0], id: '1bad' }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...defs[0], type: 'color' }).success).toBe(false);
  });

  it('resolves values with defaults and reports problems', () => {
    expect(resolveSettings(defs)).toEqual({ values: { time: 20, sound: true, map: 'eu', title: '' }, errors: [] });
    const result = resolveSettings(defs, { time: 300, map: 'cz', extra: 1 });
    expect(result.values).toEqual({ time: 20, sound: true, map: 'cz', title: '' });
    expect(result.errors).toEqual(['time: must be at most 120', 'extra: unknown setting']);
  });

  it('localizes labels', () => {
    expect(localize({ cs: 'Zvuk', en: 'Sound' }, 'cs-CZ')).toBe('Zvuk');
    expect(localize({ cs: 'Zvuk', en: 'Sound' }, 'de')).toBe('Sound');
    expect(localize({ cs: 'Zvuk' }, 'de')).toBe('Zvuk');
    expect(localize('Plain', 'cs')).toBe('Plain');
  });
});

describe('plugin manifest', () => {
  it('derives runtime defaults and views', () => {
    const solo = safeParsePluginManifest(manifest({ protocol: '1.0', modes: { solo: {} } }));
    expect(solo.success && solo.runtime).toEqual({
      protocol: '1.0',
      solo: true,
      multiplayer: null,
      settings: [],
      settingsScreen: null,
      orientation: 'any',
      views: ['solo'],
      permissions: { network: [], devices: [] },
      services: [],
    });

    const all = safeParsePluginManifest(manifest({ protocol: '1.0', modes: { solo: {}, multiplayer }, settingsScreen: { size: 'large' } }));
    expect(all.success && all.runtime.views).toEqual(['solo', 'board', 'controller', 'settings']);
    expect(all.success && all.runtime.multiplayer?.lateJoin).toBe(true);

    const party = safeParsePluginManifest(manifest({ protocol: '1.0', modes: { multiplayer: { ...multiplayer, hostAs: ['player'], lateJoin: false } } }));
    expect(party.success && party.runtime.views).toEqual(['controller']);
    expect(party.success && party.runtime.multiplayer?.lateJoin).toBe(false);
  });

  it('keeps unknown keys of the original manifest', () => {
    const data = manifest({ protocol: '1.0', modes: { solo: {} }, futureKey: 1 }, { registry: { isStandaloneFile: true } });
    const result = safeParsePluginManifest(data);
    expect(result.success && result.manifest).toBe(data);
  });

  it.each([
    ['missing Memizy block', { ...manifest({}), appSpecific: {} }, /Missing the Memizy runtime block/],
    ['no modes', manifest({ protocol: '1.0', modes: {} }), /declare "solo" and\/or "multiplayer"/],
    ['bad protocol', manifest({ protocol: '1', modes: { solo: {} } }), /MAJOR.MINOR/],
    ['settingsScreen without multiplayer', manifest({ protocol: '1.0', modes: { solo: {} }, settingsScreen: { size: 'compact' } }), /only used in the multiplayer lobby/],
    ['players min > max', manifest({ protocol: '1.0', modes: { multiplayer: { ...multiplayer, players: { min: 5, max: 2 } } } }), /min must not be greater/],
    ['empty hostAs', manifest({ protocol: '1.0', modes: { multiplayer: { ...multiplayer, hostAs: [] } } }), /hostAs must contain/],
    ['duplicate setting ids', manifest({ protocol: '1.0', modes: { solo: {} }, settings: [
      { id: 'a', type: 'boolean', label: 'A', default: true },
      { id: 'a', type: 'boolean', label: 'B', default: false },
    ] }), /Setting ids must be unique/],
    ['invalid OQSEM part', { ...manifest({ protocol: '1.0', modes: { solo: {} } }), id: 'not-a-url' }, /^id/],
  ])('rejects %s', (_name, data, message) => {
    const result = safeParsePluginManifest(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join('\n')).toMatch(message);
  });

  it('reads the manifest from HTML without executing it', () => {
    const json = JSON.stringify(manifest({ protocol: '1.0', modes: { solo: {} } }));
    const html = `<!doctype html><head><script id="m" type='application/oqse-manifest+json'>${json}</script></head>`;
    expect(readPluginManifestFromHtml(html).success).toBe(true);
    expect(extractManifestFromHtml('<p>nothing</p>')).toMatchObject({ success: false });
    expect(extractManifestFromHtml('<script type="application/oqse-manifest+json">{oops</script>')).toMatchObject({ success: false });
  });
});

describe('documentation examples stay valid', () => {
  it('SPEC.md manifest example', () => {
    const spec = readFileSync(resolve(root, 'packages/protocol/SPEC.md'), 'utf8');
    const result = readPluginManifestFromHtml(spec);
    expect(result.success ? [] : result.errors).toEqual([]);
  });

  it('AI guide: manifest snippet and the complete example plugin', () => {
    const guide = readFileSync(resolve(root, 'docs/ai-plugin-guide.md'), 'utf8').replace(/\r\n/g, '\n');
    const snippet = /## 3\. Manifest[\s\S]*?```json\n([\s\S]*?)```/.exec(guide)![1];
    const snippetResult = safeParsePluginManifest(JSON.parse(snippet));
    expect(snippetResult.success ? [] : snippetResult.errors).toEqual([]);

    const example = /## 8\. Complete Example[\s\S]*?```html\n([\s\S]*?)```/.exec(guide)![1];
    const exampleResult = readPluginManifestFromHtml(example);
    expect(exampleResult.success ? [] : exampleResult.errors).toEqual([]);
  });
});

describe('host call validation', () => {
  it('covers every Host API method', () => {
    expect(Object.keys(HOST_API_ARGS).sort()).toEqual([...HOST_API_METHODS].sort());
  });

  it('accepts valid calls and rejects invalid ones with INVALID_ARGUMENT', () => {
    expect(parseHostCall('send', [{ to: 'authority', data: { type: 'answer' } }])).toHaveLength(1);
    expect(parseHostCall('saveData', ['set', { level: 3 }])).toEqual(['set', { level: 3 }]);
    expect(parseHostCall('getAsset', ['map'])).toEqual(['map']);
    expect(parseHostCall('recordAnswer', [{ itemId: 'x', isCorrect: true, confidence: 3 }])).toHaveLength(1);
    expect(() => parseHostCall('send', [{ to: 'nobody-list', data: 1 }])).toThrow(/\[INVALID_ARGUMENT\] send:/);
    expect(() => parseHostCall('saveData', ['global', {}])).toThrow(/INVALID_ARGUMENT/);
    expect(() => parseHostCall('recordAnswer', [{ itemId: 'x', isCorrect: true, confidence: 5 }])).toThrow(/INVALID_ARGUMENT/);
    expect(() => parseHostCall('resize', [{ height: -1 }])).toThrow(/INVALID_ARGUMENT/);
    expect(() => parseHostCall('hello', [{ protocol: 'one', sdk: {}, plugin: {}, features: [] }])).toThrow(/INVALID_ARGUMENT/);
  });
});

describe('setting modes (RC2)', () => {
  it('validates modes and filters settings for a mode', () => {
    const solo = { id: 'enemy', type: 'select', label: 'Enemy', default: 'normal', options: [{ value: 'normal', label: 'Normal' }], modes: ['solo'] };
    const both = { id: 'time', type: 'number', label: 'Time', default: 20 };
    expect(SettingDefinitionSchema.safeParse(solo).success).toBe(true);
    expect(SettingDefinitionSchema.safeParse({ ...both, modes: [] }).success).toBe(false);
    expect(SettingDefinitionSchema.safeParse({ ...both, modes: ['party'] }).success).toBe(false);
    const defs = [solo, both] as { id: string; modes?: string[] }[];
    expect(settingsForMode(defs, 'solo').map((d) => d.id)).toEqual(['enemy', 'time']);
    expect(settingsForMode(defs, 'multiplayer').map((d) => d.id)).toEqual(['time']);
  });
});
