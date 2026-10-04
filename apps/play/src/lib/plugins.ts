/**
 * Plugins in Memizy Play: built-in examples, plugin HTML (pasted or uploaded)
 * and plugins loaded from a URL. Until the SDK is published, plugin imports of
 * the CDN SDK are rewritten to the SDK served by this app.
 */

import guide from '../../../../docs/ai-plugin-guide.md?raw';

/** The import URL plugins use (docs/ai-plugin-guide.md). */
export const CDN_SDK_URL = 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';

/** The SDK built from this repository, served by Memizy Play (see vite.config.ts). */
export function localSdkUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}sdk/memizy-sdk.js`, location.origin).href;
}

export type SdkSource = 'local' | 'cdn';

/** Points the plugin's SDK import to the chosen source. */
export function withSdkSource(html: string, source: SdkSource): string {
  return source === 'local' ? html.split(CDN_SDK_URL).join(localSdkUrl()) : html;
}

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

export const EXAMPLE_PLUGINS: ExamplePlugin[] = [{ key: 'quiz-race', title: 'Quiz Race (AI guide example)', html: guideExample() }];

export const AI_GUIDE = guide;

export async function fetchPluginHtml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
}
