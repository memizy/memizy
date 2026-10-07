/**
 * What a plugin may reach outside its sandbox (SPEC 8.4): a Content Security Policy for
 * the iframe built from the declared `permissions.network`, and the iframe `allow`
 * attribute from `permissions.devices`. Shared by every host (also the relay player).
 */

import type { PluginRuntime } from './pluginRuntime';

/** CDNs plugins load libraries from (scripts, styles, fonts, data files). */
export const LIBRARY_ORIGINS = ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://esm.sh'];

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/** Device permissions a plugin may declare, and their iframe `allow` names. */
export const PLUGIN_DEVICES = ['camera', 'microphone', 'geolocation', 'serial', 'bluetooth'] as const;
export type PluginDevice = (typeof PLUGIN_DEVICES)[number];

/**
 * The Content Security Policy of a plugin iframe.
 *
 * - Scripts only inline (the plugin itself), from the library CDNs and from the host
 *   (`hostOrigin`, which serves the SDK in development and in Memizy Play).
 * - Network requests (`fetch`, WebSocket…) only to the CDNs and the declared
 *   `permissions.network` origins.
 * - Images and media may come from any https URL (study sets link them), so an image
 *   URL can still carry data out: the policy blocks data channels, not every leak.
 */
export function pluginContentPolicy(runtime: Pick<PluginRuntime, 'permissions'> | null, hostOrigin: string | null): string {
  const host = hostOrigin && /^https?:\/\//.test(hostOrigin) ? [hostOrigin] : [];
  const network = runtime?.permissions.network ?? [];
  const list = (...parts: string[][]) => [...new Set(parts.flat())].join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: ${list(LIBRARY_ORIGINS, host)}`,
    `style-src 'unsafe-inline' ${list(LIBRARY_ORIGINS, FONT_ORIGINS, host)}`,
    `font-src data: ${list(LIBRARY_ORIGINS, FONT_ORIGINS, host)}`,
    'img-src data: blob: https:',
    'media-src data: blob: https:',
    `connect-src data: blob: ${list(LIBRARY_ORIGINS, host, network)}`,
    `worker-src blob: ${list(LIBRARY_ORIGINS, host)}`,
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** The iframe `allow` attribute for the declared devices (empty when none). */
export function pluginAllowAttribute(runtime: Pick<PluginRuntime, 'permissions'> | null): string {
  return (runtime?.permissions.devices ?? []).map((device) => `${device} *`).join('; ');
}

/** Puts the policy into the plugin HTML as the first element of `<head>` (before any script). */
export function injectContentPolicy(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + `<head>${meta}</head>` + html.slice(doctype[0].length);
  return `<head>${meta}</head>${html}`;
}
