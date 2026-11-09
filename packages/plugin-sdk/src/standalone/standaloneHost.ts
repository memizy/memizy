/**
 * Standalone host: lets a game run when its HTML file is opened directly in a browser or
 * in another site's preview (development, sharing a game file). It runs in solo mode with
 * the built-in sample set or the player's own set (an OQSE file, `?set=<url>`), the game's
 * settings and progress per set, kept in `localStorage` when the page may use it. A small
 * menu (`defineGame({ standalone })`, `game.openStandaloneMenu()`) changes the set and the
 * settings; the game then starts again. Multiplayer is tested in the Memizy Plugin Lab.
 */

import type { HostApi, InitPayload, SessionResult } from '@memizy/protocol';
import { PROTOCOL_VERSION, ProtocolError, resolveSettings, settingsForMode, type PluginRuntime } from '@memizy/protocol';
import type { OQSEAnyItem, OQSEMeta, ProgressRecord } from '@memizy/oqse';
import type { Connector } from '../connection/connect';
import { sampleSetFor } from './sampleSet';
import { loadSetReader, readSet, type SetReader } from './sets';
import { openMenu, showMenuButton, type MenuPosition } from './menu';

export interface StandaloneMenuOptions {
  /** `'auto'` (default): a small button opens the menu; `'hidden'`: the game opens it (`game.openStandaloneMenu()`). */
  controls?: 'auto' | 'hidden';
  /** Where the button sits (default `'tab'`: a handle at the top centre). */
  position?: MenuPosition;
}

export interface StandaloneOptions {
  runtime: PluginRuntime | null;
  pluginId: string;
  types: readonly string[] | null;
  /** The game's choices for the menu (`defineGame({ standalone })`). */
  menu?: StandaloneMenuOptions;
  /** Starts the game again with the chosen set or settings (the SDK's own restart). */
  restart?: () => void;
  /** Tests: the set reader instead of the CDN. */
  setReader?: () => Promise<SetReader>;
}

/** The standalone connector and the function that opens its menu (`game.openStandaloneMenu`). */
export interface Standalone {
  connector: Connector;
  openMenu(): boolean;
}

const PLAYER_ID = 'standalone-player';

/** A set the player chose (kept between visits when the page may use `localStorage`). */
interface ChosenSet {
  source: 'file' | 'url';
  name: string;
  url?: string;
  meta: OQSEMeta;
  items: OQSEAnyItem[];
}

function browserLocale(): string {
  try {
    return navigator.language || 'en';
  } catch {
    return 'en';
  }
}

/** `localStorage` of this game, or memory when the page may not use it (sandboxed previews). */
function gameStorage(pluginId: string) {
  const memory = new Map<string, string>();
  const key = (scope: string) => `memizy:${pluginId}:${scope}`;
  return {
    load(scope: string): any {
      let raw: string | null | undefined;
      try {
        raw = window.localStorage.getItem(key(scope));
      } catch {
        raw = memory.get(key(scope));
      }
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    store(scope: string, value: unknown): void {
      const text = JSON.stringify(value);
      memory.set(key(scope), text);
      try {
        window.localStorage.setItem(key(scope), text);
      } catch {
        /* a sandboxed preview: memory only (until the page closes) */
      }
    },
    remove(scope: string): void {
      memory.delete(key(scope));
      try {
        window.localStorage.removeItem(key(scope));
      } catch {
        /* memory only */
      }
    },
  };
}

/** The OQSE rule of the Memizy apps (protocol 1.1): right one level up, wrong one level down. */
function nextRecord(previous: ProgressRecord | undefined, isCorrect: boolean, confidence?: number): ProgressRecord {
  const was = previous ?? { bucket: 0, stats: { attempts: 0, incorrect: 0, streak: 0 } };
  const bucket = isCorrect ? Math.min(4, Math.max(1, was.bucket) + 1) : Math.max(1, was.bucket - 1);
  return {
    ...was,
    bucket: bucket as ProgressRecord['bucket'],
    stats: { attempts: was.stats.attempts + 1, incorrect: was.stats.incorrect + (isCorrect ? 0 : 1), streak: isCorrect ? was.stats.streak + 1 : 0 },
    lastAnswer: { isCorrect, answeredAt: new Date().toISOString(), ...(confidence && { confidence: confidence as 1 | 2 | 3 | 4 }) },
  };
}

export function standaloneHost(options: StandaloneOptions): Standalone {
  const storage = gameStorage(options.pluginId);
  const locale = browserLocale();
  const reader = () => loadSetReader(options.setReader);
  /** A set from `?set=` read at the first start (also when the page may not store it). */
  let fromUrl: ChosenSet | null = null;
  let urlError: string | null = null;
  let urlChecked = false;
  let menuOpen: (() => void) | null = null;

  const current = (): ChosenSet | null => fromUrl ?? (storage.load('set') as ChosenSet | null);
  const settingDefs = () => settingsForMode(options.runtime?.settings ?? [], 'solo');

  async function readUrlSet(): Promise<void> {
    if (urlChecked) return;
    urlChecked = true;
    let url: string | null = null;
    try {
      url = new URLSearchParams(window.location.search).get('set');
    } catch {
      url = null;
    }
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const result = await readSet(text, url, options.types, await reader());
      if (!result.ok) throw new Error(result.error);
      fromUrl = { source: 'url', name: url, url, meta: result.file.meta, items: result.usable };
      storage.store('set', fromUrl);
    } catch (error) {
      urlError = `${url}: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(`[memizy standalone] The set from ?set= could not be loaded – ${urlError}`);
    }
  }

  const restart = () => options.restart?.();

  const choose = async (text: string, name: string, source: 'file' | 'url', url?: string): Promise<string | null> => {
    const result = await readSet(text, name, options.types, await reader());
    if (!result.ok) return result.error;
    const chosen: ChosenSet = { source, name, ...(url && { url }), meta: result.file.meta, items: result.usable };
    fromUrl = null;
    storage.store('set', chosen);
    restart();
    return null;
  };

  const connector: Connector = async (pluginApi) => {
    await readUrlSet();
    const chosen = current();
    const sample = sampleSetFor(options.types, locale);
    const set = chosen ? { meta: chosen.meta, items: chosen.items } : sample;
    const setId = set.meta.id;
    // Progress per set (the sample's Czech progress was kept under "progress" before SDK 1.1).
    const progress: Record<string, ProgressRecord> = storage.load(`progress:${setId}`) ?? (chosen ? null : storage.load('progress')) ?? {};
    const settings = resolveSettings(options.runtime?.settings ?? [], storage.load('settings') ?? {}, options.runtime?.unknownSettings ?? []).values;
    const init: InitPayload = {
      protocol: PROTOCOL_VERSION,
      host: { name: 'memizy-standalone', version: '1.1.0' },
      oqseVersion: '1.0',
      features: [],
      services: [],
      session: { id: `standalone-${Date.now()}`, mode: 'solo', hostAs: null, view: 'solo', self: PLAYER_ID, authority: PLAYER_ID, lateJoin: false },
      players: [{ id: PLAYER_ID, name: locale.toLowerCase().startsWith('cs') ? 'Hráč' : 'Player', isHost: true, connected: true }],
      set: structuredClone(set),
      settings,
      config: { locale, theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
      clock: { offsetMs: 0, pausedMs: 0, pausedAt: null },
      progress: structuredClone(progress),
      data: { plugin: storage.load('data:plugin'), set: storage.load(`data:set:${setId}`) },
      snapshot: null,
      seed: [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''),
    };

    const menuState = () => ({
      locale,
      title: set.meta.title,
      count: set.items.length,
      sample: !chosen,
      error: urlError,
      settings: settingDefs(),
      values: settings,
    });
    menuOpen = () =>
      openMenu(menuState(), {
        chooseFile: (text, name) => choose(text, name, 'file'),
        chooseUrl: async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) return `HTTP ${response.status}`;
            return await choose(await response.text(), url, 'url', url);
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
        chooseSample: () => {
          fromUrl = null;
          storage.remove('set');
          restart();
        },
        applySettings: (values) => {
          storage.store('settings', resolveSettings(options.runtime?.settings ?? [], values, options.runtime?.unknownSettings ?? []).values);
          restart();
        },
        resetProgress: () => {
          storage.remove(`progress:${setId}`);
          if (!chosen) storage.remove('progress');
          restart();
        },
      });
    if (options.menu?.controls !== 'hidden') showMenuButton(set.meta.title, options.menu?.position ?? 'tab', () => menuOpen?.());
    if (urlError) {
      menuOpen();
      urlError = null; // shown once
    }

    const host: HostApi = {
      hello: async () => init,
      ready: async () => {
        setTimeout(() => void pluginApi.start(), 0);
      },
      send: async () => {},
      saveSnapshot: async () => {},
      recordAnswer: async (answer) => {
        progress[answer.itemId] = nextRecord(progress[answer.itemId], answer.isCorrect, answer.confidence);
        storage.store(`progress:${setId}`, progress);
      },
      saveData: async (scope, value) => storage.store(scope === 'set' ? `data:set:${setId}` : `data:${scope}`, value),
      updateSettings: async () => {},
      getAsset: async (key) => {
        throw new ProtocolError('ASSET_NOT_FOUND', `Asset "${key}" is not available in standalone mode.`);
      },
      end: async (result) => showResult(result, locale),
      reportError: async (error) => console.error(`[memizy standalone] ${error.code}: ${error.message}`),
      service: async (name) => {
        throw new ProtocolError('SERVICE_UNAVAILABLE', `Service "${name}" is not available outside Memizy (test it in Memizy).`);
      },
      markItem: async (itemId, mark) => {
        const was = progress[itemId] ?? { bucket: 0 as const, stats: { attempts: 0, incorrect: 0, streak: 0 } };
        progress[itemId] = { ...was, starred: mark.starred };
        storage.store(`progress:${setId}`, progress);
      },
    };

    return { host, init, standalone: true, destroy: () => {} };
  };

  return {
    connector,
    openMenu: () => {
      if (!menuOpen) return false;
      menuOpen();
      return true;
    },
  };
}

/** @deprecated The connector alone (SDK 1.0): use `standaloneHost`. */
export function standaloneConnector(options: StandaloneOptions): Connector {
  return standaloneHost(options).connector;
}

function showResult(result: SessionResult, locale: string): void {
  const scores = Object.values(result.scores ?? {});
  const box = document.createElement('div');
  box.className = 'mz-standalone-result';
  const over = locale.toLowerCase().startsWith('cs') ? 'Konec hry' : 'Game over';
  box.textContent = `${over}${scores.length ? ` · ${scores.join(', ')}` : ''}${result.summary ? ` · ${result.summary}` : ''}`;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}
