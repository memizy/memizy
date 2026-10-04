import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [dts({ exclude: ['src/**/*.test.ts', 'src/test/**'] })],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      fileName: 'memizy-sdk',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['@memizy/oqse', '@memizy/protocol', 'penpal', 'mutative', 'marked', 'dompurify'],
    },
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
  },
});
