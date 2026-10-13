import { describe, expect, it } from 'vitest';
import { safeValidateOQSEFile } from '@memizy/oqse';
import { loadPluginFromHtml, prepareSetForPlugin } from '@memizy/host-sdk';
import { BUILTIN_SETS } from './sets';
import { EXAMPLE_PLUGINS, GUIDE_EXAMPLE, exampleKey, localSdkUrl, withSdkSource, CDN_SDK_URL } from './plugins';
import { generateNames } from './names';
import { buildCreatePrompt } from './prompt';

describe('built-in sets', () => {
  it.each(BUILTIN_SETS.map((s) => [s.title, s] as const))('%s is strictly valid without warnings', (_title, set) => {
    expect(set.warnings).toEqual([]);
    const strict = safeValidateOQSEFile(set.file);
    expect(strict.success, JSON.stringify(strict.errors)).toBe(true);
    expect(strict.warnings).toEqual([]);
    expect(set.file.items.length).toBeGreaterThan(0);
  });

  it('have unique keys and item ids', () => {
    expect(new Set(BUILTIN_SETS.map((s) => s.key)).size).toBe(BUILTIN_SETS.length);
    const ids = BUILTIN_SETS.flatMap((s) => s.file.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('example plugins', () => {
  it.each([...EXAMPLE_PLUGINS, GUIDE_EXAMPLE].map((p) => [p.key, p] as const))('%s loads, plays alone and in multiplayer, and handles the sample sets', (_key, example) => {
    const result = loadPluginFromHtml(withSdkSource(example.html, 'local'));
    expect(result.success, result.success ? '' : result.errors.join('; ')).toBe(true);
    if (!result.success) return;
    expect(result.plugin.html).toContain(localSdkUrl());
    expect(result.plugin.html).not.toContain('cdn.jsdelivr.net/npm/@memizy/plugin-sdk');
    expect(result.plugin.runtime.solo).toBeTruthy();
    expect(result.plugin.runtime.multiplayer).toBeTruthy();
    if (result.plugin.runtime.set === 'none') return; // a game without questions (Civhrad)
    const animals = BUILTIN_SETS[0];
    expect(prepareSetForPlugin(animals.file, result.plugin.manifest).set.items.length).toBeGreaterThan(0);
  });

  it('offers the full games, not the guide example; an old remembered choice falls back', () => {
    expect(EXAMPLE_PLUGINS.map((p) => p.key)).toEqual(['pirates', 'babis', 'civhrad']);
    expect(exampleKey('quiz-race')).toBe('pirates');
    expect(exampleKey('civhrad')).toBe('civhrad');
  });
});

describe('SDK source', () => {
  it('rewrites every CDN URL of the SDK to the local one, and nothing else', () => {
    const local = localSdkUrl();
    const html = [
      `import { defineGame } from '${CDN_SDK_URL}';`,
      `import * as SDK from "https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm";`,
      'import { x } from `https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1.0.0-rc.5/dist/bundle/memizy-sdk.bundle.js`;',
      `import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';`,
    ].join('\n');
    expect(withSdkSource(html, 'local')).toBe([
      `import { defineGame } from '${local}';`,
      `import * as SDK from "${local}";`,
      `import { x } from \`${local}\`;`,
      `import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';`,
    ].join('\n'));
    expect(withSdkSource(html, 'cdn')).toBe(html);
  });
});

describe('helpers', () => {
  it('generates distinct names', () => {
    const names = generateNames(8);
    expect(new Set(names).size).toBe(8);
  });

  it('builds the prompt with the guide, the idea and the set types', () => {
    const prompt = buildCreatePrompt('Car race', BUILTIN_SETS[0].file);
    expect(prompt).toContain('defineGame');
    expect(prompt).toContain('Car race');
    expect(prompt).toContain('mcq-single');
  });
});
