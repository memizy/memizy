/**
 * LocalSession: runs one game session whose plugin instances all live in the
 * same page (the Plugin Lab, solo games in the app, tests). It implements the
 * host side of the Memizy Plugin Protocol (SPEC sections 3–8): validation and
 * limits of every call, routing of messages, the start barrier, authority
 * outages, snapshots, learning progress and plugin data.
 *
 * Multiplayer across devices uses the same model with a relay transport
 * (multiplayer server); its session class will expose the same API.
 */

import {
  BOARD_ADDRESS,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  RateLimiter,
  assertJsonWithin,
  negotiateProtocolVersion,
  parseHostCall,
  resolveSettings,
  toProtocolError,
  type AnswerRecord,
  type DataScope,
  type HostApi,
  type HostAs,
  type InitPayload,
  type Player,
  type PluginApi,
  type PluginRuntime,
  type PluginView,
  type SessionEndReason,
  type SessionResult,
  type Theme,
} from '@memizy/protocol';
import { resolveAsset, type OQSEFile, type ProgressRecord } from '@memizy/oqse';
import { leitner, type LearningAlgorithm } from './learning';
import { MemoryStorage, type HostStorage } from './storage';
import { prepareSetForPlugin, type LoadedPlugin, type PreparedSet } from './plugin';

export interface SessionPlayer {
  id: string;
  name: string;
  isHost?: boolean;
}

export interface SessionConfig {
  plugin: LoadedPlugin;
  /** The study set, loaded with `loadOQSEFile`. */
  set: OQSEFile;
  mode: 'solo' | 'multiplayer';
  /** Multiplayer only: how the host takes part. */
  hostAs?: HostAs;
  /** Solo: exactly one player (default: a player called "Player"). Multiplayer: the roster. */
  players?: SessionPlayer[];
  /** Setting values (defaults are applied; invalid values throw). */
  settings?: Record<string, unknown>;
  storage?: HostStorage;
  algorithm?: LearningAlgorithm;
  /** Loader for assets that are not absolute URLs (e.g. files of an `.oqse` package). */
  loadAsset?: (key: string, itemId: string | undefined) => Promise<Blob>;
  /** Maps a player to the key of their stored progress and data (default: the player ID). */
  userKeyFor?: (playerId: string) => string;
  config?: Partial<Theme>;
  sessionId?: string;
  host?: { name: string; version: string };
  /** Max wait for all instances to be ready before the countdown (default 15 s). */
  readyTimeoutMs?: number;
  /** Countdown before the game starts in multiplayer (default 3 s; 0 = none). */
  countdownMs?: number;
  /**
   * The session was already running (e.g. the host page was reloaded; pass the
   * same `sessionId` and a persistent `storage`). The authority resumes from its
   * last snapshot; without a snapshot the game starts again right away.
   */
  resume?: boolean;
}

export type SessionEvent =
  | { type: 'ready'; address: string }
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'started' }
  | { type: 'settings'; values: Record<string, unknown>; valid: boolean; message?: string }
  | { type: 'answer'; playerId: string; record: ProgressRecord; answer: AnswerRecord }
  | { type: 'ended'; result: SessionResult }
  | { type: 'players'; players: Player[] }
  | { type: 'authority'; connected: boolean }
  | { type: 'traffic'; from: string; to: string; bytes: number; data: unknown }
  | { type: 'rejected'; address: string; method: string; code: string; message: string }
  | { type: 'pluginError'; address: string; code: string; message: string; context?: Record<string, unknown> }
  | { type: 'resize'; address: string; height: number | 'auto' }
  | { type: 'exit'; address: string };

/** Creates the plugin side of an instance for a given host API (iframe + Penpal, or a direct connection in tests). */
export type PluginEndpoint = (hostApi: HostApi) => PluginApi | Promise<PluginApi>;

export interface SessionInstance {
  readonly address: string;
  readonly view: PluginView;
  readonly hostApi: HostApi;
}

interface Instance extends SessionInstance {
  endpoint: PluginEndpoint;
  onDispose?: () => void;
  plugin: PluginApi | null;
  ready: boolean;
  connected: boolean;
  disposed: boolean;
  resumed: boolean;
  limiter: RateLimiter;
}

export const SETTINGS_ADDRESS = 'settings';

export class LocalSession {
  readonly id: string;
  readonly plugin: LoadedPlugin;
  readonly runtime: PluginRuntime;
  readonly mode: 'solo' | 'multiplayer';
  readonly hostAs: HostAs | null;
  readonly authority: string;
  readonly prepared: PreparedSet;
  players: Player[];
  settings: Record<string, unknown>;
  settingsValid = true;
  config: Theme;
  started = false;
  ended = false;

  private readonly options: SessionConfig;
  private readonly storage: HostStorage;
  private readonly algorithm: LearningAlgorithm;
  private readonly instances = new Map<string, Instance>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private authorityConnected = true;
  private startPromise: Promise<void> | null = null;
  private resumeStartPending = false;
  private pendingSnapshot: unknown = undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingData = new Map<string, { playerId: string; scope: DataScope; value: unknown; timer: ReturnType<typeof setTimeout> }>();

  constructor(config: SessionConfig) {
    this.options = config;
    this.id = config.sessionId ?? `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.plugin = config.plugin;
    this.runtime = config.plugin.runtime;
    this.mode = config.mode;
    this.storage = config.storage ?? new MemoryStorage();
    this.algorithm = config.algorithm ?? leitner;
    this.config = { locale: config.config?.locale ?? 'cs', theme: config.config?.theme ?? 'light' };

    if (config.mode === 'solo') {
      if (!this.runtime.solo) throw new Error('The plugin does not support solo mode.');
      this.hostAs = null;
    } else {
      if (!this.runtime.multiplayer) throw new Error('The plugin does not support multiplayer.');
      const hostAs = config.hostAs ?? this.runtime.multiplayer.hostAs[0];
      if (!this.runtime.multiplayer.hostAs.includes(hostAs)) throw new Error(`The plugin does not support hostAs "${hostAs}".`);
      this.hostAs = hostAs;
    }

    const roster = config.players ?? (config.mode === 'solo' ? [{ id: 'player', name: 'Player', isHost: true }] : []);
    if (config.mode === 'solo' && roster.length !== 1) throw new Error('A solo session has exactly one player.');
    if (new Set(roster.map((p) => p.id)).size !== roster.length) throw new Error('Player IDs must be unique.');
    if (roster.some((p) => p.id === BOARD_ADDRESS || p.id === SETTINGS_ADDRESS || p.id === 'server')) throw new Error('Player IDs "board", "settings" and "server" are reserved.');
    this.players = roster.map((p) => ({ id: p.id, name: p.name, isHost: config.mode === 'solo' ? true : p.isHost ?? false, connected: true }));

    if (config.mode === 'solo') this.authority = this.players[0].id;
    else if (this.hostAs === 'presenter') this.authority = BOARD_ADDRESS;
    else {
      const host = this.players.find((p) => p.isHost);
      if (!host) throw new Error('With hostAs "player", one player must have isHost: true.');
      this.authority = host.id;
    }

    const resolved = resolveSettings(this.runtime.settings, config.settings ?? {});
    if (resolved.errors.length > 0) throw new Error(`Invalid settings: ${resolved.errors.join('; ')}`);
    this.settings = resolved.values;
    this.prepared = prepareSetForPlugin(config.set, config.plugin.manifest);
    if (config.resume) {
      this.started = true;
      this.resumeStartPending = true;
    }
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  on(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[memizy host] session listener failed:', error);
      }
    }
  }

  // ==========================================================================
  // Instances
  // ==========================================================================

  /** The default view of an address in this session. */
  viewOf(address: string): PluginView {
    if (address === SETTINGS_ADDRESS) return 'settings';
    if (this.mode === 'solo') return 'solo';
    return address === BOARD_ADDRESS ? 'board' : 'controller';
  }

  /** Addresses that have a game instance in this session (board and players). */
  addresses(): string[] {
    return [...(this.hostAs === 'presenter' ? [BOARD_ADDRESS] : []), ...this.players.map((p) => p.id)];
  }

  /**
   * Connects a plugin instance at `address` (a player ID, `"board"`, or `"settings"`
   * for the lobby settings screen). An existing instance at the address is replaced.
   */
  async connect(address: string, endpoint: PluginEndpoint, options: { onDispose?: () => void } = {}): Promise<SessionInstance> {
    const view = this.viewOf(address);
    if (view === 'settings') {
      if (!this.runtime.multiplayer || !this.runtime.settingsScreen) throw new Error('The plugin has no settings screen (settingsScreen).');
      if (this.started) throw new Error('The settings screen is only available before the game starts.');
    } else if (!this.addresses().includes(address)) {
      throw new Error(`Unknown address "${address}" in this session.`);
    }
    if (this.ended) throw new Error('The session has ended.');

    this.disposeInstance(address);
    const instance: Instance = {
      address,
      view,
      hostApi: undefined as unknown as HostApi,
      endpoint,
      onDispose: options.onDispose,
      plugin: null,
      ready: false,
      connected: true,
      disposed: false,
      resumed: false,
      limiter: new RateLimiter(LIMITS.messagesPerSecond, LIMITS.messageBurst),
    };
    (instance as { hostApi: HostApi }).hostApi = this.createHostApi(instance);
    this.instances.set(address, instance);
    if (address === this.authority && this.started) this.setAuthorityConnected(false);
    instance.plugin = await endpoint(instance.hostApi);
    return instance;
  }

  /** Recreates the instance at `address` (like a browser reload or a reconnect). */
  async reload(address: string): Promise<SessionInstance> {
    const instance = this.instances.get(address);
    if (!instance) throw new Error(`No instance at "${address}".`);
    if (address === this.authority) await this.flushSnapshot();
    return this.connect(address, instance.endpoint, { onDispose: instance.onDispose });
  }

  /** Removes the instance at `address` (the player stays in the roster). */
  disconnect(address: string): void {
    this.disposeInstance(address);
    if (address === this.authority && this.started) this.setAuthorityConnected(false);
  }

  private disposeInstance(address: string): void {
    const instance = this.instances.get(address);
    if (!instance) return;
    instance.disposed = true;
    this.instances.delete(address);
    try {
      instance.onDispose?.();
    } catch (error) {
      console.warn('[memizy host] dispose failed:', error);
    }
  }

  getInstance(address: string): SessionInstance | undefined {
    return this.instances.get(address);
  }

  // ==========================================================================
  // Session control
  // ==========================================================================

  /**
   * Multiplayer: waits until all connected game instances are ready (or the
   * ready timeout passes), runs the countdown and starts the game on the
   * authority (SPEC 3.3). Solo games start automatically when ready.
   */
  start(): Promise<void> {
    if (this.mode === 'solo') return Promise.resolve();
    if (this.started && !this.startPromise) return Promise.resolve(); // resumed session
    if (!this.settingsValid) return Promise.reject(new Error('The settings are not valid.'));
    const count = this.players.length;
    const limits = this.runtime.multiplayer!.players;
    if (count < limits.min || count > limits.max) {
      return Promise.reject(new Error(`This plugin needs ${limits.min}–${limits.max} players (now ${count}).`));
    }
    this.startPromise ??= this.runStart();
    return this.startPromise;
  }

  private async runStart(): Promise<void> {
    this.disposeInstance(SETTINGS_ADDRESS);
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 15_000);
    const allReady = () => [...this.instances.values()].every((i) => i.ready);
    const authorityReady = () => this.instances.get(this.authority)?.ready === true;
    while (!(allReady() && authorityReady()) && (Date.now() < deadline || !authorityReady())) {
      if (this.ended) return;
      await sleep(25);
    }
    const countdownMs = this.options.countdownMs ?? 3000;
    for (let left = Math.ceil(countdownMs / 1000); left > 0; left--) {
      this.emit({ type: 'countdown', secondsLeft: left });
      await sleep(Math.min(1000, countdownMs - (Math.ceil(countdownMs / 1000) - left) * 1000));
    }
    if (this.ended) return;
    this.started = true;
    this.emit({ type: 'started' });
    await this.callPlugin(this.authority, (p) => p.start());
  }

  addPlayer(player: SessionPlayer): void {
    if (this.mode === 'solo') throw new Error('Players cannot join a solo session.');
    if (this.players.some((p) => p.id === player.id) || [BOARD_ADDRESS, SETTINGS_ADDRESS, 'server'].includes(player.id)) {
      throw new Error(`Player ID "${player.id}" is already used or reserved.`);
    }
    if (this.started && !this.runtime.multiplayer!.lateJoin) throw new Error('This game does not allow joining after the start.');
    if (this.players.length >= this.runtime.multiplayer!.players.max) throw new Error('The game is full.');
    this.players = [...this.players, { id: player.id, name: player.name, isHost: false, connected: true }];
    this.broadcastPlayers();
  }

  removePlayer(id: string): void {
    if (id === this.authority) throw new Error('The host cannot be removed.');
    this.disposeInstance(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.broadcastPlayers();
  }

  renamePlayer(id: string, name: string): void {
    this.players = this.players.map((p) => (p.id === id ? { ...p, name } : p));
    this.broadcastPlayers();
  }

  /**
   * Simulates a connection loss / recovery of an instance. Messages to and from a
   * disconnected instance are dropped; for the authority, the others are told
   * that the authority is unavailable (SPEC 6.1).
   */
  setConnected(address: string, connected: boolean): void {
    const instance = this.instances.get(address);
    if (instance) instance.connected = connected;
    if (this.players.some((p) => p.id === address)) {
      this.players = this.players.map((p) => (p.id === address ? { ...p, connected } : p));
      this.broadcastPlayers();
    }
    if (address === this.authority) this.setAuthorityConnected(connected);
    else if (connected && instance) void this.callPlugin(address, (p) => p.authorityChanged({ connected: true })); // makes the SDK re-synchronize
  }

  setConfig(config: Partial<Theme>): void {
    this.config = { ...this.config, ...config };
    for (const address of this.instances.keys()) void this.callPlugin(address, (p) => p.configChanged(this.config));
  }

  /** Ends the session for all instances (they stay mounted until the app removes them). */
  async end(reason: SessionEndReason = 'closed'): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.flushSnapshot();
    await this.flushData();
    await Promise.all([...this.instances.keys()].map((address) => this.callPlugin(address, (p) => p.sessionEnded(reason))));
  }

  // ==========================================================================
  // Host API of one instance
  // ==========================================================================

  private createHostApi(instance: Instance): HostApi {
    const call = <T>(method: string, fn: () => Promise<T> | T): Promise<T> => {
      return (async () => {
        if (instance.disposed) throw new ProtocolError('SESSION_ENDED', 'This instance has been closed.');
        if (this.ended && method !== 'reportError') throw new ProtocolError('SESSION_ENDED', 'The session has ended.');
        return fn();
      })().catch((error) => {
        const e = toProtocolError(error);
        this.emit({ type: 'rejected', address: instance.address, method, code: e.code, message: e.detail });
        throw e;
      });
    };
    const isPlayerView = () => instance.view === 'solo' || instance.view === 'controller';
    const requireView = (method: string, ok: boolean) => {
      if (!ok) throw new ProtocolError('NOT_ALLOWED_IN_VIEW', `${method} is not available in view "${instance.view}".`);
    };
    const requireAuthority = (method: string) => {
      if (instance.address !== this.authority) throw new ProtocolError('NOT_AUTHORITY', `${method} may only be called by the authority.`);
    };

    const api: HostApi = {
      hello: (...args) =>
        call('hello', async () => {
          const [handshake] = parseHostCall('hello', args);
          const negotiated = negotiateProtocolVersion(handshake.protocol, PROTOCOL_VERSION);
          if (!negotiated) {
            throw new ProtocolError('UNSUPPORTED_PROTOCOL', `The plugin speaks protocol ${handshake.protocol}; this host supports ${PROTOCOL_VERSION}.`);
          }
          if (handshake.plugin.id !== this.plugin.manifest.id) {
            this.emit({ type: 'pluginError', address: instance.address, code: 'PLUGIN_ID_MISMATCH', message: `The SDK reports plugin id "${handshake.plugin.id}", the manifest says "${this.plugin.manifest.id}".` });
          }
          return this.buildInit(instance, negotiated);
        }),

      ready: (...args) =>
        call('ready', () => {
          parseHostCall('ready', args);
          if (instance.ready) return;
          instance.ready = true;
          this.emit({ type: 'ready', address: instance.address });
          if (instance.address === this.authority) {
            if (this.mode === 'solo' && !this.started && !instance.resumed) {
              this.started = true;
              this.emit({ type: 'started' });
              void this.callPlugin(instance.address, (p) => p.start());
            } else if (this.started) {
              if (this.resumeStartPending) {
                this.resumeStartPending = false;
                // Resumed without a snapshot: nothing to continue from, start over.
                if (!instance.resumed) void this.callPlugin(instance.address, (p) => p.start());
              }
              this.setAuthorityConnected(true);
            }
          }
        }),

      send: (...args) =>
        call('send', () => {
          const [message] = parseHostCall('send', args);
          requireView('send', instance.view !== 'settings');
          const bytes = assertJsonWithin(message.data, LIMITS.messageBytes, 'MESSAGE_TOO_LARGE', 'message');
          if (!instance.limiter.tryTake()) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.messagesPerSecond} messages per second.`);
          if (!instance.connected) return; // the device is offline: the message is lost
          if (message.to === 'authority') {
            const authority = this.instances.get(this.authority);
            if (!authority || !authority.connected || !this.authorityConnected) {
              throw new ProtocolError('AUTHORITY_UNAVAILABLE', 'The host is not reachable right now.');
            }
            this.deliver(instance.address, this.authority, message.data, bytes);
            return;
          }
          const targets =
            message.to === 'all'
              ? [...this.instances.keys()].filter((a) => a !== instance.address && a !== SETTINGS_ADDRESS)
              : message.to.filter((a) => a !== SETTINGS_ADDRESS);
          for (const target of targets) this.deliver(instance.address, target, message.data, bytes);
        }),

      saveSnapshot: (...args) =>
        call('saveSnapshot', () => {
          const [snapshot] = parseHostCall('saveSnapshot', args);
          requireAuthority('saveSnapshot');
          assertJsonWithin(snapshot, LIMITS.snapshotBytes, 'SNAPSHOT_TOO_LARGE', 'snapshot');
          this.pendingSnapshot = structuredClone(snapshot);
          this.snapshotTimer ??= setTimeout(() => void this.flushSnapshot(), 1000 / LIMITS.snapshotsPerSecond);
        }),

      recordAnswer: (...args) =>
        call('recordAnswer', async () => {
          const [answer] = parseHostCall('recordAnswer', args);
          const self = this.players.some((p) => p.id === instance.address) ? instance.address : null;
          const playerId = answer.playerId ?? self;
          if (!playerId) throw new ProtocolError('INVALID_ARGUMENT', 'recordAnswer needs a playerId on the board.');
          if (playerId !== self) requireAuthority('recordAnswer for another player');
          if (!this.players.some((p) => p.id === playerId)) throw new ProtocolError('INVALID_ARGUMENT', `Unknown player "${playerId}".`);
          if (!this.prepared.set.items.some((i) => i.id === answer.itemId)) throw new ProtocolError('INVALID_ARGUMENT', `Unknown item "${answer.itemId}".`);
          const userKey = this.userKey(playerId);
          const setId = this.prepared.set.meta.id;
          const progress = await this.storage.loadProgress(userKey, setId);
          const record = this.algorithm.apply(progress[answer.itemId], answer, new Date());
          await this.storage.saveProgress(userKey, setId, { [answer.itemId]: record });
          this.emit({ type: 'answer', playerId, record, answer });
        }),

      saveProgress: (...args) =>
        call('saveProgress', async () => {
          const [records] = parseHostCall('saveProgress', args);
          requireView('saveProgress', isPlayerView());
          const known = new Set(this.prepared.set.items.map((i) => i.id));
          const unknown = Object.keys(records).filter((id) => !known.has(id));
          if (unknown.length > 0) throw new ProtocolError('INVALID_ARGUMENT', `Unknown items: ${unknown.join(', ')}.`);
          await this.storage.saveProgress(this.userKey(instance.address), this.prepared.set.meta.id, records);
        }),

      saveData: (...args) =>
        call('saveData', () => {
          const [scope, value] = parseHostCall('saveData', args);
          requireView('saveData', isPlayerView());
          assertJsonWithin(value, LIMITS.dataBytes, 'DATA_TOO_LARGE', `plugin data (${scope})`);
          const key = `${instance.address}|${scope}`;
          const pending = this.pendingData.get(key);
          if (pending) pending.value = structuredClone(value);
          else {
            const entry = {
              playerId: instance.address,
              scope,
              value: structuredClone(value),
              timer: setTimeout(() => void this.flushData(key), 1000 / LIMITS.dataWritesPerSecond),
            };
            this.pendingData.set(key, entry);
          }
        }),

      updateSettings: (...args) =>
        call('updateSettings', () => {
          const [update] = parseHostCall('updateSettings', args);
          requireView('updateSettings', instance.view === 'settings');
          const { values, errors } = resolveSettings(this.runtime.settings, update.values);
          this.settings = values;
          this.settingsValid = update.valid && errors.length === 0;
          const message = update.message ?? errors[0];
          this.emit({ type: 'settings', values, valid: this.settingsValid, ...(message && { message }) });
        }),

      getAsset: (...args) =>
        call('getAsset', async () => {
          const [key, itemId] = parseHostCall('getAsset', args);
          const item = itemId ? this.options.set.items.find((i) => i.id === itemId) : undefined;
          const media = resolveAsset(key, item, this.options.set.meta);
          if (!media) throw new ProtocolError('ASSET_NOT_FOUND', `Asset "${key}" does not exist.`);
          if (this.options.loadAsset) return this.options.loadAsset(key, itemId);
          if (/^https?:/i.test(media.value)) {
            const response = await fetch(media.value);
            if (response.ok) return response.blob();
          }
          throw new ProtocolError('ASSET_NOT_FOUND', `Asset "${key}" cannot be loaded by this host.`);
        }),

      end: (...args) =>
        call('end', async () => {
          const [result] = parseHostCall('end', args);
          requireAuthority('end');
          this.emit({ type: 'ended', result });
        }),

      resize: (...args) =>
        call('resize', () => {
          const [request] = parseHostCall('resize', args);
          this.emit({ type: 'resize', address: instance.address, height: request.height });
        }),

      reportError: (...args) =>
        call('reportError', () => {
          const [error] = parseHostCall('reportError', args);
          this.emit({ type: 'pluginError', address: instance.address, code: error.code, message: error.message, ...(error.context && { context: error.context }) });
        }),

      exit: (...args) =>
        call('exit', () => {
          parseHostCall('exit', args);
          this.emit({ type: 'exit', address: instance.address });
        }),
    };
    return api;
  }

  private async buildInit(instance: Instance, protocol: string): Promise<InitPayload> {
    const playerView = instance.view === 'solo' || instance.view === 'controller';
    const setId = this.prepared.set.meta.id;
    const userKey = playerView ? this.userKey(instance.address) : null;
    const pluginId = this.plugin.manifest.id;
    if (instance.address === this.authority) await this.flushSnapshot(); // the latest snapshot may still be pending
    const snapshot = instance.address === this.authority ? await this.storage.loadSnapshot(this.id) : null;
    instance.resumed = snapshot !== null;
    return {
      protocol,
      host: this.options.host ?? { name: '@memizy/host-sdk', version: '1.0.0-rc.2' },
      oqseVersion: '0.2',
      features: [],
      session: {
        id: this.id,
        mode: this.mode,
        hostAs: this.hostAs,
        view: instance.view,
        self: instance.address,
        authority: this.authority,
        lateJoin: this.started && instance.view !== 'settings',
      },
      players: this.players,
      set: structuredClone(this.prepared.set),
      settings: { ...this.settings },
      config: this.config,
      clock: { offsetMs: 0 },
      progress: userKey ? await this.storage.loadProgress(userKey, setId) : {},
      data: userKey
        ? {
            plugin: (this.pendingDataValue(instance.address, 'plugin') ?? (await this.storage.loadData(userKey, pluginId, 'plugin', setId))) ?? null,
            set: (this.pendingDataValue(instance.address, 'set') ?? (await this.storage.loadData(userKey, pluginId, 'set', setId))) ?? null,
          }
        : { plugin: null, set: null },
      snapshot,
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private userKey(playerId: string): string {
    return this.options.userKeyFor?.(playerId) ?? playerId;
  }

  private deliver(from: string, to: string, data: unknown, bytes: number): void {
    const target = this.instances.get(to);
    if (!target || !target.connected || !target.plugin) return;
    this.emit({ type: 'traffic', from, to, bytes, data });
    const copy = structuredClone(data);
    setTimeout(() => void this.callPlugin(to, (p) => p.deliver({ from, data: copy, sentAt: Date.now() })), 0);
  }

  private broadcastPlayers(): void {
    this.emit({ type: 'players', players: this.players });
    for (const address of this.instances.keys()) void this.callPlugin(address, (p) => p.playersChanged(this.players));
  }

  private setAuthorityConnected(connected: boolean): void {
    if (this.authorityConnected === connected) return;
    this.authorityConnected = connected;
    this.emit({ type: 'authority', connected });
    for (const address of this.instances.keys()) {
      if (address !== this.authority && address !== SETTINGS_ADDRESS) void this.callPlugin(address, (p) => p.authorityChanged({ connected }));
    }
  }

  private async callPlugin(address: string, fn: (plugin: PluginApi) => Promise<void>): Promise<void> {
    const instance = this.instances.get(address);
    if (!instance?.plugin || instance.disposed) return;
    try {
      await fn(instance.plugin);
    } catch (error) {
      this.emit({ type: 'pluginError', address, code: 'PLUGIN_CALL_FAILED', message: toProtocolError(error).detail });
    }
  }

  private async flushSnapshot(): Promise<void> {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    if (this.pendingSnapshot === undefined) return;
    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = undefined;
    await this.storage.saveSnapshot(this.id, snapshot);
  }

  private pendingDataValue(playerId: string, scope: DataScope): unknown {
    return this.pendingData.get(`${playerId}|${scope}`)?.value;
  }

  private async flushData(onlyKey?: string): Promise<void> {
    const entries = onlyKey ? [[onlyKey, this.pendingData.get(onlyKey)] as const] : [...this.pendingData.entries()];
    for (const [key, entry] of entries) {
      if (!entry) continue;
      clearTimeout(entry.timer);
      this.pendingData.delete(key);
      await this.storage.saveData(this.userKey(entry.playerId), this.plugin.manifest.id, entry.scope, this.prepared.set.meta.id, entry.value);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
