/**
 * Test router: a minimal multi-instance host for end-to-end tests of
 * `defineGame` (each instance gets a Connector; messages are routed between them).
 */

import type { HostApi, InitPayload, PluginApi, Player, SettingsUpdate, AnswerRecord, DataScope } from '@memizy/protocol';
import { BOARD_ADDRESS } from '@memizy/protocol';
import type { OQSEAnyItem } from '@memizy/oqse';
import type { Connector } from '../connection/connect';

export interface RouterOptions {
  mode?: 'solo' | 'multiplayer';
  hostAs?: 'presenter' | 'player' | null;
  players?: string[];
  items: OQSEAnyItem[];
  settings?: Record<string, unknown>;
  view?: 'settings';
}

export class LocalRouter {
  readonly plugins = new Map<string, PluginApi>();
  readonly settingsUpdates: SettingsUpdate[] = [];
  readonly records: AnswerRecord[] = [];
  readonly saved: { address: string; scope: DataScope; value: unknown }[] = [];
  readonly errors: string[] = [];
  readonly players: Player[];
  readonly authority: string;
  private readonly options: RouterOptions;

  constructor(options: RouterOptions) {
    this.options = options;
    const mode = options.mode ?? 'multiplayer';
    const ids = options.players ?? (mode === 'solo' ? ['me'] : ['anna', 'ben']);
    const hostAs = options.hostAs ?? (mode === 'solo' ? null : 'presenter');
    this.players = ids.map((id, i) => ({ id, name: id.toUpperCase(), isHost: hostAs === 'player' && i === 0, connected: true }));
    this.authority = mode === 'solo' || hostAs === 'player' ? ids[0] : BOARD_ADDRESS;
  }

  connector(address: string): Connector {
    return async (pluginApi) => {
      this.plugins.set(address, pluginApi);
      const mode = this.options.mode ?? 'multiplayer';
      const hostAs = this.options.hostAs ?? (mode === 'solo' ? null : 'presenter');
      const init: InitPayload = {
        protocol: '1.0',
        host: { name: 'test-router', version: '0' },
        oqseVersion: '0.3',
        features: [],
        session: {
          id: 'e2e',
          mode,
          hostAs,
          view: this.options.view ?? (mode === 'solo' ? 'solo' : address === BOARD_ADDRESS ? 'board' : 'controller'),
          self: address,
          authority: this.authority,
          lateJoin: false,
        },
        players: this.players,
        set: { meta: { id: 's', language: 'cs', title: 'S', createdAt: '2026-01-01', updatedAt: '2026-01-01' }, items: structuredClone(this.options.items) },
        settings: this.options.settings ?? {},
        config: { locale: 'cs', theme: 'light' },
        clock: { offsetMs: 0 },
        progress: {},
        data: { plugin: null, set: null },
        snapshot: null,
      };
      const route = (target: string, data: unknown) => {
        const plugin = this.plugins.get(target);
        if (plugin) setTimeout(() => void plugin.deliver({ from: address, data: structuredClone(data), sentAt: Date.now() }), 0);
      };
      const host: HostApi = {
        hello: async () => init,
        ready: async () => {},
        send: async ({ to, data }) => {
          if (to === 'authority') route(this.authority, data);
          else for (const target of to === 'all' ? [...this.plugins.keys()].filter((a) => a !== address) : to) route(target, data);
        },
        saveSnapshot: async () => {},
        recordAnswer: async (answer) => void this.records.push(answer),
        saveProgress: async () => {},
        saveData: async (scope, value) => void this.saved.push({ address, scope, value }),
        updateSettings: async (update) => void this.settingsUpdates.push(update),
        getAsset: async () => new Blob(['x']),
        end: async () => {},
        resize: async () => {},
        reportError: async (error) => void this.errors.push(`${address} ${error.code}: ${error.message}`),
        exit: async () => {},
      };
      return { host, init, standalone: false, destroy: () => this.plugins.delete(address) };
    };
  }

  /** Countdown finished: start the game on the authority. */
  async start(): Promise<void> {
    await this.plugins.get(this.authority)?.start();
  }
}

export const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
