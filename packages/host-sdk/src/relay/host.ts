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
import type { PreparedSet } from '../plugin';
import { RelaySocket, relayWebSocketUrl, type RelayStatus } from './socket';
import { blobToJson, serializeError, type HostToPlayer, type PlayerToHost, type RemoteLobbyState } from './messages';

export type RelayHostEvent =
  | { type: 'status'; status: RelayStatus }
  | { type: 'players'; players: RelayPlayer[] }
  /** A continued game: who has which place changed. */
  | { type: 'seats'; seats: HostSeat[] }
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

/** A place in a continued game: an earlier player and the room player who has it now. */
export interface HostSeat {
  /** The player ID in the session (from the saved game). */
  id: string;
  name: string;
  /** The room player on this place, or `null` when it is free. */
  playerId: string | null;
}

export interface AttachOptions {
  /**
   * A continued (saved) game: the session's players are the places of the earlier
   * game, with their old IDs (the game state refers to them). Room players take a
   * place on their device (or join as new players when the game allows late joins);
   * the host can change it with `assignSeat`. Until then a place is disconnected.
   */
  seats?: boolean;
  /** Places already taken (room player ID -> session player ID), e.g. after a reload of the host page. */
  taken?: Record<string, string>;
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
  /** The place of each room player in the session: room player ID -> session player ID. */
  private readonly seatOf = new Map<string, string>();
  /** A continued game (see `AttachOptions.seats`). */
  private seatsMode = false;

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

  /**
   * Uploads the plugin and its set for the players' devices. Only `prepared.publicSet`
   * (items without answers, SPEC 4.4) leaves this machine: anyone with the PIN can
   * download the bundle. Prepare the set with the seed passed as `shuffleSeed`.
   */
  async uploadBundle(pluginHtml: string, prepared: PreparedSet): Promise<number> {
    const set = prepared.publicSet;
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

  /**
   * Leaves the room without closing it (the page is going away). The room and its
   * players stay on the server, so the host can come back (reload) or take it over.
   */
  disconnect(): void {
    this.detach();
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
   * Connects the session's remote players and keeps the session in sync with the
   * room: presence, late joins, reconnects, renames and kicks. In a new game the
   * session's players are room players (same IDs); for a continued game pass
   * `{ seats: true }` (see `AttachOptions`).
   */
  attach(session: LocalSession, options: AttachOptions = {}): void {
    this.detach();
    this.session = session;
    this.seatsMode = options.seats === true;
    const isPlace = (id: string) => session.players.some((p) => p.id === id && !p.isHost);
    const inRoom = (id: string) => this.players.some((p) => p.id === id);
    if (this.seatsMode) {
      for (const [playerId, seat] of Object.entries(options.taken ?? {})) {
        if (inRoom(playerId) && isPlace(seat) && this.relayIdOf(seat) === null) this.seatOf.set(playerId, seat);
      }
    } else {
      for (const player of this.players) if (isPlace(player.id)) this.seatOf.set(player.id, player.id);
    }
    // Places without a connected device are disconnected (their messages are dropped).
    for (const p of session.players) {
      if (p.isHost) continue;
      const relayId = this.relayIdOf(p.id);
      if (!this.players.find((r) => r.id === relayId)?.connected) session.setConnected(p.id, false);
    }
    for (const seat of this.seatOf.values()) this.connectRemote(seat);

    this.stopSession = session.on((event) => this.onSessionEvent(event));
    this.setState({ phase: 'loading', appName: session.plugin.manifest.appName, players: session.players, authorityConnected: true, result: undefined, countdown: undefined, ...this.seatState() });
    if (this.seatsMode) for (const player of this.players) if (player.connected) this.sendSeat(player.id);
  }

  /** Disconnects from the session; player devices return to the lobby. */
  detach(): void {
    this.stopSession?.();
    this.stopSession = null;
    this.session = null;
    for (const [id, channel] of this.channels) this.resetChannel(id, channel);
    this.seatOf.clear();
    if (this.seatsMode) {
      this.seatsMode = false;
      this.state = { ...this.state, seats: undefined, newPlayers: undefined };
      this.broadcast({ k: 'state', state: this.state }); // devices leave the place choice
    }
    this.broadcast({ k: 'unmount' });
  }

  // ==========================================================================
  // Places in a continued game
  // ==========================================================================

  /** The places of a continued game and who has them (empty for a new game). */
  get seats(): HostSeat[] {
    const session = this.session;
    if (!this.seatsMode || !session) return [];
    return session.players.filter((p) => !p.isHost).map((p) => ({ id: p.id, name: p.name, playerId: this.relayIdOf(p.id) }));
  }

  /** Which room player has which place (room player ID -> session player ID); keep it to re-attach after a reload. */
  get seatAssignments(): Record<string, string> {
    return Object.fromEntries(this.seatOf);
  }

  /**
   * A continued game: puts a room player on a place (`null` = takes the place away).
   * Whoever had that place before loses it and chooses again.
   */
  assignSeat(playerId: string, seat: string | null): void {
    const session = this.session;
    if (!this.seatsMode || !session) throw new Error('Places can be assigned only in a continued game.');
    if (!this.players.some((p) => p.id === playerId)) throw new Error(`Unknown room player "${playerId}".`);
    if (seat !== null && !session.players.some((p) => p.id === seat && !p.isHost)) throw new Error(`Unknown place "${seat}".`);
    if ((this.seatOf.get(playerId) ?? null) === seat) return;
    this.unseat(playerId);
    if (seat !== null) {
      const holder = this.relayIdOf(seat);
      if (holder !== null) this.unseat(holder);
      this.seat(playerId, seat);
    }
    this.seatsChanged();
  }

  private relayIdOf(seat: string): string | null {
    for (const [playerId, s] of this.seatOf) if (s === seat) return playerId;
    return null;
  }

  private seatState(): Pick<RemoteLobbyState, 'seats' | 'newPlayers'> {
    const session = this.session;
    if (!this.seatsMode || !session) return { seats: undefined, newPlayers: undefined };
    const multiplayer = session.plugin.runtime.multiplayer;
    return {
      seats: this.seats.map((s) => ({ id: s.id, name: s.name, taken: s.playerId !== null })),
      newPlayers: !session.ended && !!multiplayer?.lateJoin && session.players.length < multiplayer.players.max,
    };
  }

  private seatsChanged(): void {
    if (!this.seatsMode) return;
    this.setState(this.seatState());
    this.emit({ type: 'seats', seats: this.seats });
  }

  /** Tells a device its place (and the place's nickname). */
  private sendSeat(playerId: string): void {
    const seat = this.seatOf.get(playerId) ?? null;
    const name = seat === null ? undefined : this.session?.players.find((p) => p.id === seat)?.name;
    this.sendTo(playerId, { k: 'seat', seat, ...(name !== undefined && { name }) });
  }

  private seat(playerId: string, seat: string): void {
    this.seatOf.set(playerId, seat);
    const connected = this.players.find((p) => p.id === playerId)?.connected ?? false;
    this.session?.setConnected(seat, connected);
    if (connected) this.connectRemote(seat);
    this.sendSeat(playerId);
  }

  private unseat(playerId: string): void {
    const seat = this.seatOf.get(playerId);
    if (seat === undefined) return;
    this.seatOf.delete(playerId);
    const channel = this.channels.get(seat);
    if (channel) this.resetChannel(seat, channel);
    this.channels.delete(seat);
    this.session?.disconnect(seat);
    this.session?.setConnected(seat, false);
    this.sendTo(playerId, { k: 'unmount' });
    this.sendSeat(playerId);
  }

  /** A device chose its place in a continued game (or to join as a new player). */
  private claim(playerId: string, seat: unknown): void {
    const session = this.session;
    const player = this.players.find((p) => p.id === playerId);
    if (!this.seatsMode || !session || session.ended || !player || this.seatOf.has(playerId)) {
      this.sendSeat(playerId);
      return;
    }
    if (seat === null) {
      try {
        session.addPlayer({ id: playerId, name: player.name });
      } catch {
        this.sendSeat(playerId); // full or no late join: the device shows the places again
        return;
      }
      this.seat(playerId, playerId);
    } else if (typeof seat === 'string' && session.players.some((p) => p.id === seat && !p.isHost) && this.relayIdOf(seat) === null) {
      this.seat(playerId, seat);
    } else {
      this.sendSeat(playerId); // taken meanwhile
      return;
    }
    this.seatsChanged();
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
        this.setState({ players: event.players, ...this.seatState() });
        if (this.seatsMode) this.emit({ type: 'seats', seats: this.seats });
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

  private sendMount(seat: string, gen: number): void {
    this.sendToSeat(seat, { k: 'mount', gen, bundle: this.bundleVersion, locale: this.session?.config.locale ?? 'en' });
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
    const relayId = this.relayIdOf(playerId);
    const player = this.players.find((p) => p.id === relayId);
    if (!player?.connected) return Promise.resolve(); // dropped like any message to a disconnected device
    const id = ++this.callCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        channel.calls.delete(id);
        reject(new Error(`[INTERNAL_ERROR] ${method} on ${playerId} timed out.`));
      }, this.options.callTimeoutMs ?? 15_000);
      channel.calls.set(id, { resolve, reject, timer });
      this.sendToSeat(playerId, { k: 'call', id, gen, method, args });
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
    const seat = this.seatOf.get(player.id) ?? null;
    switch (event) {
      case 'join':
        // A continued game: the device chooses its place first (`claim`).
        if (session && !session.ended && seat === null && !this.seatsMode) {
          try {
            session.addPlayer({ id: player.id, name: player.name });
            this.seatOf.set(player.id, player.id);
            this.connectRemote(player.id);
          } catch {
            /* full or no late join: the player waits in the lobby */
          }
        }
        break;
      case 'disconnect': {
        const channel = seat === null ? undefined : this.channels.get(seat);
        if (channel) this.settleCalls(channel);
        if (session && seat !== null) session.setConnected(seat, false);
        break;
      }
      case 'rename':
        // In a continued game the place keeps the earlier player's nickname.
        if (session && seat !== null && !this.seatsMode) session.renamePlayer(seat, player.name);
        break;
      case 'leave':
        if (seat !== null && this.seatsMode) {
          this.unseat(player.id); // the place stays in the game and is free again
          this.seatsChanged();
        } else if (seat !== null) {
          this.seatOf.delete(player.id);
          this.channels.delete(seat);
          try {
            session?.removePlayer(seat);
          } catch {
            /* the host's own player */
          }
        }
        break;
      case 'connect':
        break; // handled when the device says `hello` (it knows whether its instance survived)
    }
  }

  /** A message of the device of room player `relayId`; game messages go to its place in the session. */
  private async onPlayer(relayId: string, msg: PlayerToHost): Promise<void> {
    if (typeof msg !== 'object' || msg === null) return;
    const playerId = this.seatOf.get(relayId) ?? null;
    if (msg.k === 'hello') {
      this.sendTo(relayId, { k: 'state', state: this.state });
      if (this.seatsMode) this.sendSeat(relayId);
    } else if (msg.k === 'claim') {
      this.claim(relayId, msg.seat);
      return;
    }
    if (playerId === null) {
      if (msg.k === 'call') this.sendTo(relayId, { k: 'result', id: msg.id, ok: false, error: { message: '[SESSION_ENDED] This device has no place in the game.' } });
      return;
    }
    const channel = this.channel(playerId);
    switch (msg.k) {
      case 'hello': {
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
        const reply = (result: HostToPlayer) => this.sendTo(relayId, result);
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

  private sendTo(relayId: string, data: HostToPlayer): void {
    this.socket.send({ t: 'to', to: relayId, data });
  }

  /** Sends to the device on a place of the session (dropped when the place is free). */
  private sendToSeat(seat: string, data: HostToPlayer): void {
    const relayId = this.relayIdOf(seat);
    if (relayId !== null) this.sendTo(relayId, data);
  }

  private broadcast(data: HostToPlayer): void {
    for (const player of this.players) if (player.connected) this.sendTo(player.id, data);
  }
}
