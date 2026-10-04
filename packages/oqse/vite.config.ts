// vite.config.ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: false,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'OQSE',
      // One output file per source module, so bundlers can drop unused modules
      // (e.g. the plugin SDK does not need the Zod schemas).
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['zod', 'yaml', 'uuid'],
      output: { preserveModules: true, preserveModulesRoot: 'src' }
    }
  }
});