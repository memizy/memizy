import { defineConfig, type Plugin } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const SDK_BUNDLE = fileURLToPath(new URL('../../packages/plugin-sdk/dist/bundle/memizy-sdk.bundle.js', import.meta.url));
const SDK_PATH = 'sdk/memizy-sdk.js';

/**
 * Where Play is served: `/play/` on memizy.com (same origin as the main app →
 * shared local storage), `/` on its own subdomain (PLAY_BASE=/ for play.memizy.com).
 */
const BASE = process.env.PLAY_BASE ?? '/play/';

/**
 * Serves the locally built plugin SDK (until it is published to npm/CDN, the Lab
 * rewrites plugin imports to it). Plugin iframes have an opaque origin, so the
 * file needs `Access-Control-Allow-Origin: *`.
 */
function localSdk(): Plugin {
  const read = () => {
    if (!existsSync(SDK_BUNDLE)) throw new Error('Build the plugin SDK first: bun run --filter "@memizy/plugin-sdk" build');
    return readFileSync(SDK_BUNDLE, 'utf8');
  };
  return {
    name: 'memizy-local-sdk',
    configureServer(server) {
      server.middlewares.use(`${BASE}${SDK_PATH}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-store');
        res.end(read());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: SDK_PATH, source: read() });
      // Cloudflare Pages: plugin iframes have an opaque origin, so the SDK needs CORS.
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [`${BASE}${SDK_PATH}`, '  Access-Control-Allow-Origin: *', '  Cache-Control: public, max-age=300', ''].join('\n'),
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [vue(), tailwindcss(), localSdk()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5180,
    // The Lab embeds docs/ai-plugin-guide.md from the monorepo.
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  test: {
    environment: 'jsdom',
  },
});
