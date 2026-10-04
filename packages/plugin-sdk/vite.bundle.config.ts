import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Self-contained ES module (all dependencies included) for hosts that serve the
 * SDK themselves (the Plugin Lab before publishing, offline use).
 */
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist/bundle',
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      fileName: () => 'memizy-sdk.bundle.js',
      formats: ['es'],
    },
  },
});
