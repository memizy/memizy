import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [dts({ exclude: ['src/**/*.test.ts'] })],
  define: { __HOST_SDK_VERSION__: JSON.stringify(pkg.version) },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['@memizy/oqse', '@memizy/protocol', 'penpal'],
      output: { preserveModules: true, preserveModulesRoot: 'src' },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
