/**
 * The host side of a relayed multiplayer game. The game session (validation,
 * limits, authority) runs here in a LocalSession; players' plugin instances
 * run on their devices and are connected to the session through the relay
 * as remote endpoints.
 */

import {
  HOST_API_METHODS,
  PLUGIN_API_METHODS,
  RELAY_PROTOCOL,
  type CreateRoomResponse,
  type HostApi,
  type InitPayload,
  type PluginApi,
  type RelayErrorCode,
  type RelayPlayer,
  type RelayServerMessage,
} from '@memizy/protocol';
import type { LocalSession, PluginEndpoint, SessionEvent } from '../session';
import { RelaySocket, relayWebSocketUrl, type RelayStatus } from './socket';
import { blobToJson, serializeError, type HostToPlayer, type PlayerToHost, type RemoteLobbyState } from './messages';

export type RelayHostEvent =
  | { type: 'status'; status: RelayStatus }
  | { type: 'players'; players: RelayPlayer[] }
  | { type: 'error'; code: RelayErrorCode; message: string }
  | { type: 'closed'; reason: string };

export interface RelayHostOptions {
  /** Server base URL, e.g. `https://mp.memizy.com`. */
  serverUrl: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  /** How long a player device may take to load the game (default 20 s). */
  mountTimeoutMs?: number;
  /** Timeout of one call to a remote plugin (default 15 s). */
  callTimeoutMs?: number;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Channel {
  gen: number;
  hostApi: HostApi | null;
  pendingMount: { gen: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null;
  calls: Map<number, PendingCall>;
}

const HOST_METHODS = new Set<string>(HOST_API_METHODS);

export class RelayHost {
  readonly pin: string;
  readonly hostToken: string;
  players: RelayPlayer[] = [];
  /** The lobby/game state shown by the player apps. */
  state: RemoteLobbyState = { phase: 'lobby', appName: null, players: [], authorityConnected: true };

  private readonly options: RelayHostOptions;
  private readonly socket: RelaySocket;
  private readonly listeners = new Set<(event: RelayHostEvent) => void>();
  private readonly channels = new Map<string, Channel>();
  private bundleVersion = 0;
  private genCounter = 0;
  private callCounter = 0;
  private session: LocalSession | null = null;
  private hosting = false;
  private readonly hostingWaiters: (() => void)[] = [];
  private stopSession: (() => void) | null = null;

  private constructor(options: RelayHostOptions, room: CreateRoomResponse) {
    this.options = options;
    this.pin = room.pin;
    this.hostToken = room.hostToken;
    this.socket = new RelaySocket({
      url: relayWebSocketUrl(options.serverUrl),
      attach: () => ({ t: 'host', protocol: RELAY_PROTOCOL, pin: this.pin, hostToken: this.hostToken }),
      WebSocket: options.WebSocket,
    });
    this.socket.onStatus((status) => this.emit({ type: 'status', status }));
    this.socket.onMessage((msg) => this.onServer(msg));
  }

  /** Creates a new room on the server. */
  static async create(options: RelayHostOptions): Promise<RelayHost> {
    const response = await (options.fetch ?? fetch)(new URL('/api/rooms', options.serverUrl), { method: 'POST' });
    if (!response.ok) throw new Error(`Could not create a room (${response.status}): ${await response.text()}`);
    return new RelayHost(options, (await response.json()) as CreateRoomResponse);
  }

  /** Re-attaches to an existing room (e.g. after a page reload). */
  static resume(options: RelayHostOptions, room: CreateRoomResponse): RelayHost {
    return new RelayHost(options, room);
  }

  /** Resolves once the server confirmed the room and sent the current players. */
  whenHosting(): Promise<void> {
    if (this.hosting) return Promise.resolve();
    return new Promise((resolve) => this.hostingWaiters.push(resolve));
  }

  get status(): RelayStatus {
    return this.socket.status;
  }

  on(listener: (event: RelayHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RelayHostEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  // ==========================================================================
  // Room control
  // ==========================================================================

  /** Uploads the plugin and the set prepared for it (`LocalSession.prepared.set`). */
  async uploadBundle(pluginHtml: string, set: unknown): Promise<number> {
    const response = await (this.options.fetch ?? fetch)(new URL(`/api/rooms/${this.pin}/bundle`, this.options.serverUrl), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.hostToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginHtml, set }),
    });
    if (!response.ok) throw new Error(`Could not upload the game (${response.status}): ${await response.text()}`);
    this.bundleVersion = ((await response.json()) as { version: number }).version;
    return this.bundleVersion;
  }

  /** Allows or stops new players joining. */
  setOpen(open: boolean): void {
    this.socket.send({ t: 'open', open });
  }

  kick(playerId: string): void {
    this.socket.send({ t: 'kick', playerId });
  }

  /** Closes the room for everyone. */
  close(): void {
    this.detach();
    this.socket.send({ t: 'close' });
    this.socket.close();
  }

  /** Updates the lobby/game state shown by the player apps. */
  setState(update: Partial<RemoteLobbyState>): void {
    this.state = { ...this.state, ...update };
    this.broadcast({ k: 'state', state: this.state });
  }

  // ==========================================================================
  // Game session
  // ==========================================================================

  /**
   * Connects the session's remote players (all roster players that are relay
   * players) and keeps the session in sync with the room: presence, late joins,
   * reconnects, renames and kicks.
   */
  attach(session: LocalSession): void {
    this.detach();
    this.session = session;
    const relayIds = new Set(this.players.map((p) => p.id));
    for (const player of this.players) {
      if (!player.connected && session.players.some((p) => p.id === player.id)) session.setConnected(player.id, false);
    }
    for (const p of session.players) if (relayIds.has(p.id)) this.connectRemote(p.id);

    this.stopSession = session.on((event) => this.onSessionEvent(event));
    this.setState({ phase: 'loading', appName: session.plugin.manifest.appName, players: session.players, authorityConnected: true, result: undefined, countdown: undefined });
  }

  /** Disconnects from the session; player devices return to the lobby. */
  detach(): void {
    this.stopSession?.();
    this.stopSession = null;
    this.session = null;
    for (const [id, channel] of this.channels) this.resetChannel(id, channel);
    this.broadcast({ k: 'unmount' });
  }

  private onSessionEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'countdown':
        this.setState({ phase: 'countdown', countdown: event.secondsLeft });
        break;
      case 'started':
        this.setState({ phase: 'running', countdown: undefined });
        break;
      case 'players':
        this.setState({ players: event.players });
        break;
      case 'authority':
        this.setState({ authorityConnected: event.connected });
        break;
      case 'ended':
        this.setState({ phase: 'ended', result: event.result });
        break;
    }
  }

  private connectRemote(playerId: string): void {
    const session = this.session;
    if (!session) return;
    session.connect(playerId, this.endpointFor(playerId)).catch(() => {
      /* the device was not reachable; it reloads the instance when it comes back */
    });
  }

  /** A session endpoint whose plugin instance runs on the player's device. */
  endpointFor(playerId: string): PluginEndpoint {
    return (hostApi) =>
      new Promise<PluginApi>((resolve, reject) => {
        const channel = this.channel(playerId);
        this.resetChannel(playerId, channel);
        const gen = ++this.genCounter;
        channel.gen = gen;
        channel.hostApi = hostApi;
        const timer = setTimeout(() => {
          if (channel.pendingMount?.gen !== gen) return;
          channel.pendingMount = null;
          reject(new Error(`The device of player ${playerId} did not load the game in time.`));
        }, this.options.mountTimeoutMs ?? 20_000);
        channel.pendingMount = { gen, resolve: () => resolve(this.remotePlugin(playerId, gen)), reject, timer };
        this.sendMount(playerId, gen);
      });
  }

  private sendMount(playerId: string, gen: number): void {
    this.sendTo(playerId, { k: 'mount', gen, bundle: this.bundleVersion, locale: this.session?.config.locale ?? 'cs' });
  }

  private remotePlugin(playerId: string, gen: number): PluginApi {
    const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of PLUGIN_API_METHODS) {
      api[method] = (...args: unknown[]) => this.callRemote(playerId, gen, method, args);
    }
    return api as unknown as PluginApi;
  }

  private callRemote(playerId: string, gen: number, method: string, args: unknown[]): Promise<unknown> {
    const channel = this.channels.get(playerId);
    if (!channel || channel.gen !== gen) return Promise.reject(new Error('[SESSION_ENDED] The player instance was replaced.'));
    const player = this.players.find((p) => p.id === playerId);
    if (!player?.connected) return Promise.resolve(); // dropped like any message to a disconnected device
    const id = ++this.callCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        channel.calls.delete(id);
        reject(new Error(`[INTERNAL_ERROR] ${method} on ${playerId} timed out.`));
      }, this.options.callTimeoutMs ?? 15_000);
      channel.calls.set(id, { resolve, reject, timer });
      this.sendTo(playerId, { k: 'call', id, gen, method, args });
    });
  }

  private channel(playerId: string): Channel {
    let channel = this.channels.get(playerId);
    if (!channel) {
      channel = { gen: 0, hostApi: null, pendingMount: null, calls: new Map() };
      this.channels.set(playerId, channel);
    }
    return channel;
  }

  private resetChannel(_playerId: string, channel: Channel): void {
    if (channel.pendingMount) {
      clearTimeout(channel.pendingMount.timer);
      channel.pendingMount.reject(new Error('[SESSION_ENDED] Replaced.'));
      channel.pendingMount = null;
    }
    this.settleCalls(channel);
    channel.gen = 0;
    channel.hostApi = null;
  }

  /** Calls to a device that went away are dropped (resolved), like messages. */
  private settleCalls(channel: Channel): void {
    for (const call of channel.calls.values()) {
      clearTimeout(call.timer);
      call.resolve(undefined);
    }
    channel.calls.clear();
  }

  // ==========================================================================
  // Server and player messages
  // ==========================================================================

  private onServer(msg: RelayServerMessage): void {
    switch (msg.t) {
      case 'hosting':
        this.hosting = true;
        this.hostingWaiters.splice(0).forEach((resolve) => resolve());
        this.players = msg.players;
        this.emit({ type: 'players', players: this.players });
        this.broadcast({ k: 'state', state: this.state });
        break;
      case 'presence':
        this.onPresence(msg.player, msg.event);
        break;
      case 'from':
        void this.onPlayer(msg.from, msg.data as PlayerToHost);
        break;
      case 'error':
        this.emit({ type: 'error', code: msg.code, message: msg.message });
        break;
      case 'closed':
        this.emit({ type: 'closed', reason: msg.reason });
        break;
    }
  }

  private onPresence(player: RelayPlayer, event: 'join' | 'connect' | 'disconnect' | 'rename' | 'leave'): void {
    if (event === 'leave') this.players = this.players.filter((p) => p.id !== player.id);
    else if (this.players.some((p) => p.id === player.id)) this.players = this.players.map((p) => (p.id === player.id ? player : p));
    else this.players = [...this.players, player];
    this.emit({ type: 'players', players: this.players });

    const session = this.session;
    const inSession = session?.players.some((p) => p.id === player.id) ?? false;
    switch (event) {
      case 'join':
        if (session && !session.ended && !inSession) {
          try {
            session.addPlayer({ id: player.id, name: player.name });
            this.connectRemote(player.id);
          } catch {
            /* full or no late join: the player waits in the lobby */
          }
        }
        break;
      case 'disconnect': {
        const channel = this.channels.get(player.id);
        if (channel) this.settleCalls(channel);
        if (inSession) session!.setConnected(player.id, false);
        break;
      }
      case 'rename':
        if (inSession) session!.renamePlayer(player.id, player.name);
        break;
      case 'leave':
        this.channels.delete(player.id);
        if (inSession) {
          try {
            session!.removePlayer(player.id);
          } catch {
            /* the host's own player */
          }
        }
        break;
      case 'connect':
        break; // handled when the device says `hello` (it knows whether its instance survived)
    }
  }

  private async onPlayer(playerId: string, msg: PlayerToHost): Promise<void> {
    if (typeof msg !== 'object' || msg === null) return;
    const channel = this.channel(playerId);
    switch (msg.k) {
      case 'hello': {
        this.sendTo(playerId, { k: 'state', state: this.state });
        const session = this.session;
        if (!session || !session.players.some((p) => p.id === playerId)) return;
        if (channel.pendingMount) {
          this.sendMount(playerId, channel.pendingMount.gen);
          return;
        }
        session.setConnected(playerId, true);
        if (channel.gen === 0 || msg.gen !== channel.gen) {
          if (session.getInstance(playerId)) session.reload(playerId).catch(() => {});
          else this.connectRemote(playerId);
        }
        return;
      }
      case 'mounted':
        if (channel.pendingMount?.gen === msg.gen) {
          clearTimeout(channel.pendingMount.timer);
          const pending = channel.pendingMount;
          channel.pendingMount = null;
          pending.resolve();
        }
        return;
      case 'mount-failed':
        if (channel.pendingMount?.gen === msg.gen) {
          clearTimeout(channel.pendingMount.timer);
          const pending = channel.pendingMount;
          channel.pendingMount = null;
          pending.reject(new Error(msg.error?.message ?? 'The game could not be loaded on the device.'));
        }
        return;
      case 'result': {
        const call = channel.calls.get(msg.id);
        if (!call) return;
        channel.calls.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.ok) call.resolve(msg.value);
        else call.reject(new Error(msg.error?.message ?? 'Remote call failed'));
        return;
      }
      case 'call': {
        const reply = (result: HostToPlayer) => this.sendTo(playerId, result);
        if (msg.gen !== channel.gen || !channel.hostApi || !HOST_METHODS.has(msg.method) || !Array.isArray(msg.args)) {
          reply({ k: 'result', id: msg.id, ok: false, error: { message: '[SESSION_ENDED] This plugin instance is no longer active.' } });
          return;
        }
        try {
          const fn = channel.hostApi[msg.method as keyof HostApi] as (...args: unknown[]) => Promise<unknown>;
          let value = await fn(...msg.args);
          if (msg.method === 'hello') {
            // The set is downloaded once from the server (bundle), not sent through the relay.
            value = { ...(value as InitPayload), set: null };
            reply({ k: 'result', id: msg.id, ok: true, value, hostNow: Date.now() });
            return;
          }
          if (msg.method === 'getAsset' && value instanceof Blob) value = await blobToJson(value);
          reply({ k: 'result', id: msg.id, ok: true, value: value ?? null });
        } catch (error) {
          reply({ k: 'result', id: msg.id, ok: false, error: serializeError(error) });
        }
        return;
      }
    }
  }

  private sendTo(playerId: string, data: HostToPlayer): void {
    this.socket.send({ t: 'to', to: playerId, data });
  }

  private broadcast(data: HostToPlayer): void {
    for (const player of this.players) if (player.connected) this.sendTo(player.id, data);
  }
}
