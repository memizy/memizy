/**
 * Plugins in Memizy Play: built-in examples, plugin HTML (pasted or uploaded)
 * and plugins loaded from a URL. With the local SDK source (the Lab default), plugin
 * imports of the CDN SDK are rewritten to the SDK built from this repository.
 */

import guide from '../../../../docs/ai-plugin-guide.md?raw';
import pirates from '@/data/plugins/pirates-of-memizy.html?raw';
import babis from '@/data/plugins/babis-vs-alzak.html?raw';
import civhrad from '@/data/plugins/civhrad.html?raw';

/** The import URL plugins use (docs/ai-plugin-guide.md): our self-contained bundle via jsDelivr. */
export const CDN_SDK_URL = 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1';

/**
 * Any jsDelivr URL of the SDK: `@1`, the older `@1/+esm`, an exact version (`@1.0.0-rc.5`)
 * or a file path in the package, up to the closing quote.
 */
const CDN_SDK_URL_RE = /https:\/\/cdn\.jsdelivr\.net\/npm\/@memizy\/plugin-sdk@[^'"`\s]*/g;

/** The SDK built from this repository, served by Memizy Play (see vite.config.ts). */
export function localSdkUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}sdk/memizy-sdk.js`, location.origin).href;
}

export type SdkSource = 'local' | 'cdn';

/** Points the plugin's SDK import to the chosen source (`local`: every CDN URL of the SDK). */
export function withSdkSource(html: string, source: SdkSource): string {
  return source === 'local' ? html.replace(CDN_SDK_URL_RE, localSdkUrl()) : html;
}

/** Which game a page has chosen: a built-in one, the Lab's code, or a URL. */
export type PluginChoice = { kind: 'example'; key: string } | { kind: 'lab' } | { kind: 'url'; url: string };

export interface ExamplePlugin {
  key: string;
  title: string;
  html: string;
}

function guideExample(): string {
  const match = /## 8\. Complete Example[\s\S]*?```html\n([\s\S]*?)```/.exec(guide.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('The example plugin was not found in the AI guide.');
  return match[1];
}

/** The built-in games offered in Play public menus (hosting, playing alone, the Lab's "Insert a game"). */
export const EXAMPLE_PLUGINS: ExamplePlugin[] = [
  { key: 'pirates', title: 'Pirates of Memizy 🏴‍☠️', html: pirates },
  { key: 'civhrad', title: 'Hexagon Empires / Civhrad 🏰', html: civhrad },
];

/** Hidden/parody games accessible via URL parameters (e.g. ?plugin=kobliha), not shown in public menus. */
export const HIDDEN_PLUGINS: ExamplePlugin[] = [
  { key: 'kobliha', title: 'Kobliha vs. Zelenáč 🍩👽', html: babis },
  { key: 'babis', title: 'Kobliha vs. Zelenáč 🍩👽', html: babis },
];

/** All known built-in plugins (public and hidden). */
export const ALL_PLUGINS: ExamplePlugin[] = [...EXAMPLE_PLUGINS, ...HIDDEN_PLUGINS];

export function findPlugin(key: string): ExamplePlugin | undefined {
  return ALL_PLUGINS.find((p) => p.key === key);
}

/**
 * The complete example of the AI guide (section 8). Not offered in the menus: it is the
 * canonical pattern for AIs, kept working by the tests.
 */
export const GUIDE_EXAMPLE: ExamplePlugin = { key: 'quiz-race', title: 'Quiz Race (AI guide example)', html: guideExample() };

/** A remembered choice of a game: accepts public or hidden key, otherwise falls back to first example. */
export function exampleKey(key: string): string {
  return ALL_PLUGINS.some((p) => p.key === key) ? key : EXAMPLE_PLUGINS[0].key;
}

export const AI_GUIDE = guide;

export async function fetchPluginHtml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
}
