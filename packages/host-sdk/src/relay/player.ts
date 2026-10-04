/**
 * The player side of a relayed multiplayer game: joins a room, shows the
 * lobby state and runs this player's plugin instance in a sandboxed iframe,
 * bridging its calls to the host's session through the relay.
 */

import {
  HOST_API_METHODS,
  PLUGIN_API_METHODS,
  RELAY_PROTOCOL,
  type HostApi,
  type InitPayload,
  type PluginApi,
  type RelayBundle,
  type RelayErrorCode,
  type RelayServerMessage,
} from '@memizy/protocol';
import { extractManifestFromHtml } from '@memizy/protocol';
import { createPluginFrame } from '../frame';
import { RelaySocket, relayWebSocketUrl, type RelayStatus } from './socket';
import { isSerializedBlob, jsonToBlob, serializeError, type HostToPlayer, type PlayerToHost, type RemoteLobbyState } from './messages';

export type RelayPlayerEvent =
  | { type: 'status'; status: RelayStatus }
  | { type: 'joined'; playerId: string; token: string; name: string }
  | { type: 'state'; state: RemoteLobbyState }
  | { type: 'host'; connected: boolean }
  /** The plugin instance was created (`true`) or removed (`false`). */
  | { type: 'frame'; active: boolean }
  | { type: 'error'; code: RelayErrorCode | 'MOUNT_FAILED'; message: string; fatal: boolean }
  | { type: 'closed'; reason: 'host' | 'expired' | 'kicked' };

export interface RelayPlayerOptions {
  serverUrl: string;
  pin: string;
  name: string;
  /** Token from an earlier `joined` event: rejoin as the same player. */
  token?: string;
  /** Where the plugin iframe goes (called when the game starts). */
  container: () => HTMLElement | null;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  callTimeoutMs?: number;
  /** Creates the plugin instance (default: a sandboxed iframe; tests connect the SDK directly). */
  createFrame?: FrameFactory;
}

export type FrameFactory = (html: string, title: string, hostApi: HostApi, doc: Document) => RemoteFrame;

export interface RemoteFrame {
  readonly iframe: HTMLElement;
  readonly plugin: Promise<PluginApi>;
  destroy(): void;
}

interface Pending {
  method: string;
  sentAt: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PLUGIN_METHODS = new Set<string>(PLUGIN_API_METHODS);

export class RelayPlayer {
  playerId: string | null = null;
  token: string | null;
  name: string;
  state: RemoteLobbyState | null = null;
  hostConnected = true;

  private readonly options: RelayPlayerOptions;
  private readonly socket: RelaySocket;
  private readonly listeners = new Set<(event: RelayPlayerEvent) => void>();
  private bundle: { version: number; data: RelayBundle } | null = null;
  private frame: RemoteFrame | null = null;
  private plugin: PluginApi | null = null;
  private gen = 0;
  private callCounter = 0;
  private readonly pending = new Map<number, Pending>();
  /** Host clock minus local clock (ms). */
  private skewMs = 0;
  private mountQueue: Promise<void> = Promise.resolve();

  constructor(options: RelayPlayerOptions) {
    this.options = options;
    this.token = options.token ?? null;
    this.name = options.name;
    this.socket = new RelaySocket({
      url: relayWebSocketUrl(options.serverUrl),
      attach: () => ({ t: 'join', protocol: RELAY_PROTOCOL, pin: options.pin, name: this.name, token: this.token ?? undefined }),
      WebSocket: options.WebSocket,
    });
    this.socket.onStatus((status) => this.emit({ type: 'status', status }));
    this.socket.onMessage((msg) => this.onServer(msg));
  }

  get status(): RelayStatus {
    return this.socket.status;
  }

  on(listener: (event: RelayPlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RelayPlayerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  rename(name: string): void {
    this.name = name;
    this.socket.send({ t: 'rename', name });
  }

  /** Reconnect right away (e.g. the page became visible again). */
  reconnectNow(): void {
    this.socket.reconnectNow();
  }

  /** Leaves (the token stays valid for a rejoin until the room closes). */
  leave(): void {
    this.destroyFrame();
    this.socket.close();
  }

  // ==========================================================================
  // Server
  // ==========================================================================

  private onServer(msg: RelayServerMessage): void {
    switch (msg.t) {
      case 'joined':
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.name = msg.name;
        this.hostConnected = msg.hostConnected;
        this.emit({ type: 'joined', playerId: msg.playerId, token: msg.token, name: msg.name });
        this.up({ k: 'hello', gen: this.plugin ? this.gen : 0 });
        break;
      case 'host-presence':
        this.hostConnected = msg.connected;
        this.emit({ type: 'host', connected: msg.connected });
        if (msg.connected) this.up({ k: 'hello', gen: this.plugin ? this.gen : 0 });
        break;
      case 'data':
        void this.onHost(msg.data as HostToPlayer);
        break;
      case 'error':
        this.emit({ type: 'error', code: msg.code, message: msg.message, fatal: msg.fatal });
        break;
      case 'closed':
        this.destroyFrame();
        this.emit({ type: 'closed', reason: msg.reason });
        break;
    }
  }

  private up(data: PlayerToHost): boolean {
    return this.socket.send({ t: 'up', data });
  }

  // ==========================================================================
  // Host
  // ==========================================================================

  private async onHost(msg: HostToPlayer): Promise<void> {
    if (typeof msg !== 'object' || msg === null) return;
    switch (msg.k) {
      case 'state':
        this.state = msg.state;
        this.emit({ type: 'state', state: msg.state });
        return;
      case 'mount':
        this.mountQueue = this.mountQueue.then(() => this.mount(msg.gen, msg.bundle));
        return;
      case 'unmount':
        this.destroyFrame();
        return;
      case 'result': {
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (!msg.ok) {
          call.reject(new Error(msg.error?.message ?? 'Host call failed'));
          return;
        }
        let value = msg.value;
        if (call.method === 'hello' && this.bundle) {
          if (msg.hostNow !== undefined) {
            const now = Date.now();
            this.skewMs = msg.hostNow + (now - call.sentAt) / 2 - now;
          }
          const init = value as InitPayload;
          value = { ...init, set: structuredClone(this.bundle.data.set), clock: { offsetMs: init.clock.offsetMs + this.skewMs } };
        } else if (isSerializedBlob(value)) {
          value = jsonToBlob(value);
        }
        call.resolve(value);
        return;
      }
      case 'call': {
        const reply = (data: PlayerToHost) => this.up(data);
        if (msg.gen !== this.gen || !this.plugin || !PLUGIN_METHODS.has(msg.method)) {
          reply({ k: 'result', id: msg.id, ok: false, error: { message: '[SESSION_ENDED] No active plugin instance.' } });
          return;
        }
        let args = msg.args;
        if (msg.method === 'clockChanged') {
          const clock = args[0] as { offsetMs: number };
          args = [{ offsetMs: clock.offsetMs + this.skewMs }];
        }
        try {
          const fn = this.plugin[msg.method as keyof PluginApi] as (...a: unknown[]) => Promise<unknown>;
          const value = await fn(...args);
          reply({ k: 'result', id: msg.id, ok: true, value: value ?? null });
        } catch (error) {
          reply({ k: 'result', id: msg.id, ok: false, error: serializeError(error) });
        }
        return;
      }
    }
  }

  private async ensureBundle(version: number): Promise<RelayBundle> {
    if (this.bundle?.version === version) return this.bundle.data;
    const response = await (this.options.fetch ?? fetch)(new URL(`/api/rooms/${this.options.pin}/bundle`, this.options.serverUrl));
    if (!response.ok) throw new Error(`Could not download the game (${response.status}).`);
    const data = (await response.json()) as RelayBundle;
    this.bundle = { version: Number(response.headers.get('X-Bundle-Version') ?? version), data };
    return data;
  }

  private async mount(gen: number, bundleVersion: number): Promise<void> {
    this.destroyFrame();
    this.gen = gen;
    try {
      const bundle = await this.ensureBundle(bundleVersion);
      if (this.gen !== gen) return;
      const container = this.options.container();
      if (!container) throw new Error('No place for the game on this page.');
      const manifest = extractManifestFromHtml(bundle.pluginHtml);
      const title = manifest.success ? String((manifest.data as { appName?: unknown }).appName ?? 'Game') : 'Game';
      const frame = (this.options.createFrame ?? createPluginFrame)(bundle.pluginHtml, title, this.hostApiFor(gen), container.ownerDocument);
      this.frame = frame;
      container.replaceChildren(frame.iframe);
      this.emit({ type: 'frame', active: true });
      const plugin = await frame.plugin;
      if (this.gen !== gen) return;
      this.plugin = plugin;
      this.up({ k: 'mounted', gen });
    } catch (error) {
      if (this.gen !== gen) return;
      this.emit({ type: 'error', code: 'MOUNT_FAILED', message: (error as Error).message, fatal: false });
      this.up({ k: 'mount-failed', gen, error: serializeError(error) });
    }
  }

  private hostApiFor(gen: number): HostApi {
    const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of HOST_API_METHODS) {
      api[method] = (...args: unknown[]) => {
        if (this.gen !== gen) return Promise.reject(new Error('[SESSION_ENDED] This plugin instance was replaced.'));
        const id = ++this.callCounter;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`[INTERNAL_ERROR] The host did not answer ${method} in time.`));
          }, this.options.callTimeoutMs ?? 15_000);
          this.pending.set(id, { method, sentAt: Date.now(), resolve, reject, timer });
          if (!this.up({ k: 'call', id, gen, method, args })) {
            // Offline: plugin messages are dropped like on a lost connection; the SDK re-syncs later.
            clearTimeout(timer);
            this.pending.delete(id);
            if (method === 'hello') reject(new Error('[INTERNAL_ERROR] Offline.'));
            else resolve(undefined);
          }
        });
      };
    }
    return api as unknown as HostApi;
  }

  private destroyFrame(): void {
    const hadFrame = this.frame !== null;
    this.frame?.destroy();
    this.frame?.iframe.remove();
    this.frame = null;
    this.plugin = null;
    this.gen = 0;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('[SESSION_ENDED] The plugin instance was closed.'));
    }
    this.pending.clear();
    if (hadFrame) this.emit({ type: 'frame', active: false });
  }
}
