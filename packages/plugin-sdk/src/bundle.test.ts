// @vitest-environment node
/**
 * The self-contained bundle plugins import from jsDelivr (`…/plugin-sdk@1`) runs in a
 * plain browser module: it must not import anything and must not use Node globals
 * (mutative 2 reads `process.env.NODE_ENV`; the bundle config replaces it).
 */

import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('browser bundle', () => {
  it('is self-contained and free of Node globals', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'memizy-sdk-bundle-'));
    try {
      await build({
        configFile: resolve(import.meta.dirname, '../vite.bundle.config.ts'),
        build: { outDir },
        logLevel: 'silent',
      });
      const code = readFileSync(join(outDir, 'memizy-sdk.bundle.js'), 'utf8');
      expect(code).not.toMatch(/\bprocess\.(env|versions|platform)\b/);
      expect(code).not.toMatch(/\brequire\(/);
      expect(code).not.toMatch(/^\s*import\s[^(]/m); // no static imports of other modules
      expect(code).toContain('defineGame');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
