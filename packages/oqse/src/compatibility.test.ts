import { describe, it, expect } from 'vitest';
import type { OQSEFile } from './oqse';
import type { OQSEManifest } from './manifest';
import { checkCompatibility } from './compatibility';

const id = (n: number) => `0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a${String(n).padStart(2, '0')}`;

const file: OQSEFile = {
  version: '0.2',
  meta: {
    id: id(0),
    language: 'cs',
    title: 'T',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    requirements: { features: ['markdown', 'latex'], latexPackages: ['mhchem'], itemProperties: ['hints'] },
    assets: { map: { type: 'image', value: 'https://a/map.webp', mimeType: 'image/webp', altText: 'Map' } },
  },
  items: [
    { id: id(1), type: 'note', content: 'x' },
    { id: id(2), type: 'mcq-single', question: 'Q', options: ['a', 'b'], correctIndex: 0, assets: { snd: { type: 'audio', value: 'https://a/s.mp3' } } },
  ],
};

const manifest = (capabilities: Partial<OQSEManifest['capabilities']>, extra: Partial<OQSEManifest> = {}): OQSEManifest => ({
  version: '0.2',
  id: 'https://example.com/player',
  appName: 'Player',
  capabilities: { actions: ['render'], ...capabilities },
  ...extra,
});

describe('checkCompatibility', () => {
  it('passes when everything is supported', () => {
    const report = checkCompatibility(
      file,
      manifest({ types: ['*'], assets: { image: ['*'], audio: ['*'] }, features: ['markdown', 'latex'], latexPackages: ['mhchem'], itemProperties: ['hints'] }),
    );
    expect(report).toMatchObject({ compatible: true, missingProperties: [], unverifiedAssets: [] });
  });

  it('reports every missing capability', () => {
    const report = checkCompatibility(file, manifest({ types: ['note'], assets: { image: ['image/png'] }, features: ['markdown'] }, { minOqseVersion: '0.3' }));
    expect(report.compatible).toBe(false);
    expect(report.versionCompatible).toBe(false);
    expect(report.unsupportedTypes).toEqual(['mcq-single']);
    expect(report.unsupportedAssets.map((a) => a.path)).toEqual(['meta.assets.map', 'items[1].assets.snd']);
    expect(report.missingFeatures).toEqual(['latex']);
    expect(report.missingLatexPackages).toEqual(['mhchem']);
    expect(report.missingProperties).toEqual(['hints']);
  });

  it('treats [] like null and cannot verify assets without mimeType', () => {
    const report = checkCompatibility(file, manifest({ types: ['*'], assets: { image: [], audio: ['audio/mpeg'] }, features: ['markdown', 'latex'], latexPackages: ['mhchem'] }));
    expect(report.unsupportedAssets.map((a) => a.path)).toEqual(['meta.assets.map']);
    expect(report.unverifiedAssets.map((a) => a.path)).toEqual(['items[1].assets.snd']);
  });
});
