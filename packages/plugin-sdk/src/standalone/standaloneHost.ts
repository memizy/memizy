/**
 * Standalone mock host: lets a plugin run when its HTML file is opened directly
 * in a browser (development, previews). It always runs in solo mode with sample
 * data; progress and saved data are kept in localStorage when available.
 * Multiplayer is tested in the Plugin Lab.
 */

import type { HostApi, InitPayload, SessionResult } from '@memizy/protocol';
import { PROTOCOL_VERSION, ProtocolError, resolveSettings, type PluginRuntime } from '@memizy/protocol';
import type { ProgressRecord } from '@memizy/oqse';
import type { Connector } from '../connection/connect';
import { SAMPLE_META, sampleItemsFor } from './sampleSet';

export interface StandaloneOptions {
  runtime: PluginRuntime | null;
  pluginId: string;
  types: readonly string[] | null;
}

const PLAYER_ID = 'standalone-player';

export function standaloneConnector(options: StandaloneOptions): Connector {
  return async (pluginApi) => {
    const storageKey = (scope: string) => `memizy:${options.pluginId}:${scope}`;
    const load = (scope: string): any => {
      try {
        const raw = window.localStorage.getItem(storageKey(scope));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const store = (scope: string, value: unknown) => {
      try {
        window.localStorage.setItem(storageKey(scope), JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    };

    const progress: Record<string, ProgressRecord> = load('progress') ?? {};
    const items = sampleItemsFor(options.types);
    const init: InitPayload = {
      protocol: PROTOCOL_VERSION,
      host: { name: 'memizy-standalone', version: '1.0.0' },
      oqseVersion: '0.2',
      features: [],
      session: { id: `standalone-${Date.now()}`, mode: 'solo', hostAs: null, view: 'solo', self: PLAYER_ID, authority: PLAYER_ID, lateJoin: false },
      players: [{ id: PLAYER_ID, name: 'Hráč', isHost: true, connected: true }],
      set: { meta: SAMPLE_META, items },
      settings: resolveSettings(options.runtime?.settings ?? []).values,
      config: { locale: navigator.language || 'cs', theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
      clock: { offsetMs: 0 },
      progress,
      data: { plugin: load('data:plugin'), set: load('data:set') },
      snapshot: null,
    };

    showBanner(options.runtime);

    const host: HostApi = {
      hello: async () => init,
      ready: async () => {
        setTimeout(() => void pluginApi.start(), 0);
      },
      send: async () => {},
      saveSnapshot: async () => {},
      recordAnswer: async (answer) => {
        const previous = progress[answer.itemId] ?? { bucket: 0, stats: { attempts: 0, incorrect: 0, streak: 0 } };
        const bucket = answer.isCorrect ? Math.min(4, Math.max(1, previous.bucket) + 1) : 1;
        progress[answer.itemId] = {
          ...previous,
          bucket: bucket as ProgressRecord['bucket'],
          stats: {
            attempts: previous.stats.attempts + 1,
            incorrect: previous.stats.incorrect + (answer.isCorrect ? 0 : 1),
            streak: answer.isCorrect ? previous.stats.streak + 1 : 0,
          },
          lastAnswer: { isCorrect: answer.isCorrect, answeredAt: new Date().toISOString(), ...(answer.confidence && { confidence: answer.confidence }) },
        };
        store('progress', progress);
        console.info(`[memizy standalone] answer ${answer.itemId}: ${answer.isCorrect ? 'correct' : 'wrong'} → bucket ${bucket}`);
      },
      saveProgress: async (records) => {
        Object.assign(progress, records);
        store('progress', progress);
      },
      saveData: async (scope, value) => store(`data:${scope}`, value),
      updateSettings: async () => {},
      getAsset: async (key) => {
        throw new ProtocolError('ASSET_NOT_FOUND', `Asset "${key}" is not available in standalone mode.`);
      },
      end: async (result) => showResult(result),
      resize: async () => {},
      reportError: async (error) => console.error(`[memizy standalone] ${error.code}: ${error.message}`),
      exit: async () => console.info('[memizy standalone] exit requested'),
    };

    return { host, init, standalone: true, destroy: () => {} };
  };
}

function showBanner(runtime: PluginRuntime | null): void {
  const banner = document.createElement('div');
  banner.className = 'mz-standalone-banner';
  const modes = runtime ? [runtime.solo && 'solo', runtime.multiplayer && 'multiplayer'].filter(Boolean).join(' + ') : 'invalid manifest';
  banner.textContent = `Memizy standalone preview · solo with sample data · plugin supports: ${modes}. Test multiplayer in the Memizy Plugin Lab.`;
  document.body.appendChild(banner);
}

function showResult(result: SessionResult): void {
  const scores = Object.values(result.scores ?? {});
  const box = document.createElement('div');
  box.className = 'mz-standalone-result';
  box.textContent = `Game over${scores.length ? ` · score ${scores.join(', ')}` : ''}${result.summary ? ` · ${result.summary}` : ''}`;
  document.body.appendChild(box);
}

