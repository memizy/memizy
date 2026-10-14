import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    dts({
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    lib: {
      entry: { index: resolve(import.meta.dirname, 'src/index.ts'), internal: resolve(import.meta.dirname, 'src/internal.ts') },
      // One output file per source module, so bundlers can drop unused modules (Zod schemas).
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['zod', '@memizy/oqse'],
      output: { preserveModules: true, preserveModulesRoot: 'src' },
    },
  },
});
