/**
 * A minimal host page for browser tests: runs a plugin alone (LocalSession + mountPlugin,
 * the sandboxed iframe of Memizy Play) with a given set and settings. Bundled by the
 * e2e scripts with `bun build`.
 */

import { LocalSession, loadPluginFromHtml, mountPlugin } from '@memizy/host-sdk';
import { loadOQSEFile } from '@memizy/oqse';

declare global {
  interface Window {
    runGame(html: string, set: unknown, settings?: Record<string, unknown>): Promise<void>;
    sessionEvents: string[];
  }
}

window.sessionEvents = [];

window.runGame = async (html, set, settings = {}) => {
  const loaded = loadPluginFromHtml(html);
  if (!loaded.success) throw new Error(loaded.errors.join('; '));
  const file = loadOQSEFile(set);
  if (!file.success || !file.data) throw new Error('invalid set');
  const session = new LocalSession({
    plugin: loaded.plugin,
    set: file.data,
    mode: 'solo',
    players: [{ id: 'me', name: 'Tester' }],
    settings,
    locale: 'en',
  });
  session.on((e) => window.sessionEvents.push(e.type === 'pluginError' ? `pluginError:${e.code}:${e.message}` : e.type));
  await mountPlugin(session, 'me', document.getElementById('app')!);
};
