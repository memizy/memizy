import { defineConfig } from 'vitest/config';

/** Load test (not part of `bun run test`): bun x vitest run -c loadtest/vitest.config.ts */
export default defineConfig({
  test: {
    include: ['loadtest/**/*.load.ts'],
    environment: 'jsdom',
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
});
