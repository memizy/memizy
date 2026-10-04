import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [dts({ exclude: ['src/**/*.test.ts'] })],
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
