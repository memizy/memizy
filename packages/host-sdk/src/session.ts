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
  FINISH_REQUEST_FEATURE,
  PICK_ITEMS_FEATURE,
  REVEAL_ITEMS_FEATURE,
  SET_CHANGES_FEATURE,
  CHOOSE_SET_FEATURE,
  SETTINGS_ADDRESS,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  compareProtocolVersions,
  negotiateProtocolVersion,
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
  type HostConfig,
  type SessionClock,
} from '@memizy/protocol';
import {
  RateLimiter,
  assertJsonWithin,
  parseHostCall,
} from '@memizy/protocol/internal';
import { resolveAsset, type OQSEFile, type ProgressRecord } from '@memizy/oqse';
import { isNew, leitner, pickItems, type LearningAlgorithm, type PickHistoryEntry, type PickOrder, type StudyMode } from './learning';
import { MemoryStorage, type HostStorage } from './storage';
import { prepareSetForPlugin, type LoadedPlugin, type PreparedSet } from './plugin';
import { HOST_SDK_VERSION } from './version';
import { personalHostApi, personalSetInfo, type PersonalSet } from './personal';

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
  /**
   * How a player studies (learn it fast / remember it long-term, an exam date) for
   * `pickItems`; default: learn it fast.
   */
  studyModeFor?: (playerId: string) => StudyMode | undefined;
  /** How a player's next items are chosen for `pickItems`: by progress (default) or a pass in the set's order (`PickOrder`). */
  pickOrderFor?: (playerId: string) => PickOrder | undefined;
  /**
   * Whose questions (SPEC 3.4, protocol 1.1; the plugin must list it in
   * `modes.multiplayer.sets`): `personal` – every player their own set, checked on their
   * device; the authority gets the outcomes and no items. Default `shared`.
   */
  sets?: 'shared' | 'personal';
  /** Personal sets: the set of a player whose instance runs in this page (e.g. the host playing along). */
  personalSetFor?: (playerId: string) => PersonalSet | null;
  /** Language of the app (default `'en'`). */
  locale?: string;
  /** Theme of the app (default `'light'`). */
  theme?: HostConfig['theme'];
  sessionId?: string;
  /**
   * Secret seed of the display order of options, pairs… (SPEC 4.4; default: random). Pass the
   * seed used for the relay bundle so all devices agree, and the same seed again to continue a
   * saved game; `null` keeps the set's order. Never derive it from the session id or the PIN:
   * a player could undo the shuffle.
   */
  shuffleSeed?: string | null;
  /**
   * Secret seed of the game's random numbers, given only to the authority (SPEC 4.2;
   * default: 128 random bits). Pass one only to replay a game or in tests.
   */
  seed?: string;
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
  restore?: boolean;
  /** When resuming: the pauses so far (from the `paused` events), so timers stay right. */
  clock?: { pausedMs?: number; pausedAt?: number | null };
  /**
   * Memizy services this host offers (SPEC 5.3), by name. A plugin may call those it
   * declares in `services`; payloads and results are JSON. Throw a `ProtocolError` to
   * reject a call with a specific code.
   */
  services?: Record<string, ServiceHandler>;
  /**
   * The game asks for another set (`chooseSet`, protocol 1.1): show the app's set picker and
   * resolve the chosen set (loaded with `loadOQSEFile`), or `null` when the person cancelled.
   * Without it the host does not offer the feature `choose-set`.
   */
  chooseSet?: () => Promise<OQSEFile | null>;
}

/** Handles one service call. `playerId` is null on the board. */
export type ServiceHandler = (payload: unknown, context: { playerId: string | null; address: string; pluginId: string; setId: string }) => Promise<unknown>;

export type SessionEvent =
  | { type: 'ready'; address: string }
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'started' }
  | { type: 'settings'; values: Record<string, unknown>; valid: boolean; message?: string }
  /**
   * A recorded answer. `record` is the updated learning progress (null for a generated item,
   * which is not repeated, and for an ungraded answer); `ungraded`: an answer that is not
   * checked automatically (`open-ended`, SPEC 5.1) – kept for a teacher, repetition unchanged.
   * `setId` + `answer.itemId` identify the item (OQSE: an item ID alone is not unique across
   * sets); `skills` / `tags` come from the item (for statistics).
   */
  | { type: 'answer'; playerId: string; setId: string; record: ProgressRecord | null; answer: AnswerRecord; generated: boolean; ungraded: boolean; skills: string[]; tags: string[] }
  /** A player starred or unstarred an item from inside the game (`markItem`, protocol 1.1). */
  | { type: 'marked'; playerId: string; setId: string; itemId: string; starred: boolean }
  /** The set of the running game changed (`changeSet`; save it with the game). */
  | { type: 'setChanged'; setId: string; title: string }
  /** The game reported its result (`end(result)`); the session itself ends with `end()`. */
  | { type: 'result'; result: SessionResult }
  | { type: 'players'; players: Player[] }
  | { type: 'authority'; connected: boolean }
  | { type: 'traffic'; from: string; to: string; bytes: number; data: unknown }
  | { type: 'rejected'; address: string; method: string; code: string; message: string }
  | { type: 'pluginError'; address: string; code: string; message: string; context?: Record<string, unknown> }
  /** The host paused or resumed the game (store `clock` to resume a reloaded host). */
  | { type: 'paused'; paused: boolean; clock: { pausedMs: number; pausedAt: number | null } };


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
  /** `hello` was called (it may be called once per instance). */
  greeted: boolean;
  /** Features both sides listed (SPEC 8.3). */
  features: string[];
  limiter: RateLimiter;
  serviceLimiter: RateLimiter;
  answerLimiter: RateLimiter;
  assetLimiter: RateLimiter;
  errorLimiter: RateLimiter;
}


/** Features this host offers (SPEC 8.3) in a negotiated protocol version. */
function hostFeatures(protocol: string, chooseSet: boolean): string[] {
  if (compareProtocolVersions(protocol, '1.1') < 0) return [];
  return [FINISH_REQUEST_FEATURE, PICK_ITEMS_FEATURE, REVEAL_ITEMS_FEATURE, SET_CHANGES_FEATURE, ...(chooseSet ? [CHOOSE_SET_FEATURE] : [])];
}

/** Deep copy of JSON data that also works for proxies (which structuredClone rejects). */
function plainCopy<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export class LocalSession {
  readonly id: string;
  /** Secret seed of the game's random numbers (only the authority gets it). */
  private readonly seed: string;
  readonly plugin: LoadedPlugin;
  readonly runtime: PluginRuntime;
  readonly mode: 'solo' | 'multiplayer';
  readonly hostAs: HostAs | null;
  readonly authority: string;
  private preparedSet: PreparedSet;
  /** The set prepared for the plugin (changes with `changeSet`). */
  get prepared(): PreparedSet {
    return this.preparedSet;
  }
  /** The display-order seed (a changed set is shuffled with the same one). */
  private readonly shuffleSeed: string | undefined;
  /** Called with the new set before the instances hear about it (the relay uploads it first). */
  private beforeSetChange: ((prepared: PreparedSet) => Promise<void>) | null = null;
  private choosingSet = false;
  private roster: Player[];
  private settingValues: Record<string, unknown>;
  private settingsOk = true;
  private hostConfig: HostConfig;
  private isStarted = false;
  private isEnded = false;
  /** Pauses of the game (game time = session time without them). */
  private pauseState: { pausedMs: number; pausedAt: number | null } = { pausedMs: 0, pausedAt: null };

  private readonly options: SessionConfig;
  private readonly storage: HostStorage;
  private readonly algorithm: LearningAlgorithm;
  /** This game's answers per player, oldest first (for `pickItems`: mistakes back soon, new items' pace). */
  private readonly answerHistory = new Map<string, PickHistoryEntry[]>();
  /** Items the authority revealed (`revealItems`): to every instance, and per player. */
  private readonly revealedAll = new Set<string>();
  private readonly revealedTo = new Map<string, Set<string>>();

  /** Whether the authority revealed this item to this instance (its hidden media may be fetched). */
  private isRevealedTo(itemId: string, address: string): boolean {
    return this.revealedAll.has(itemId) || !!this.revealedTo.get(address)?.has(itemId);
  }
  private readonly instances = new Map<string, Instance>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private authorityConnected = true;
  private startPromise: Promise<void> | null = null;
  private resumeStartPending = false;
  private pendingSnapshot: unknown = undefined;
  /** The game has a result (`end(result)` or `end('finished')`): its snapshot is gone for good. */
  private finished = false;
  /** The authority called `end(result)`; later calls are ignored. */
  private hasResult = false;
  /** After the end, snapshots live only here: a reloaded authority still shows the end screen. */
  private finishedSnapshot: unknown = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingData = new Map<string, { playerId: string; scope: DataScope; value: unknown; timer: ReturnType<typeof setTimeout> }>();

  /** The players (the presenter is not one). Change them with `addPlayer`, `removePlayer`, `renamePlayer`, `setConnected`. */
  get players(): readonly Player[] {
    return this.roster;
  }

  /** Values of the settings (defaults applied; the plugin's own settings screen may change them in the lobby). */
  get settings(): Readonly<Record<string, unknown>> {
    return this.settingValues;
  }

  /** Whether the settings are valid (the plugin's own settings screen reports it). */
  get settingsValid(): boolean {
    return this.settingsOk;
  }

  /** Language and theme of the app (change them with `setConfig`). */
  get config(): Readonly<HostConfig> {
    return this.hostConfig;
  }

  get started(): boolean {
    return this.isStarted;
  }

  get ended(): boolean {
    return this.isEnded;
  }

  constructor(config: SessionConfig) {
    this.options = config;
    this.id = config.sessionId ?? `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.seed = config.seed ?? randomSeed();
    this.plugin = config.plugin;
    this.runtime = config.plugin.runtime;
    this.mode = config.mode;
    this.storage = config.storage ?? new MemoryStorage();
    this.algorithm = config.algorithm ?? leitner;
    this.hostConfig = { locale: config.locale ?? 'en', theme: config.theme ?? 'light' };

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
    this.roster = roster.map((p) => ({ id: p.id, name: p.name, isHost: config.mode === 'solo' ? true : p.isHost ?? false, connected: true }));

    if (config.mode === 'solo') this.authority = this.roster[0].id;
    else if (this.hostAs === 'presenter') this.authority = BOARD_ADDRESS;
    else {
      const host = this.roster.find((p) => p.isHost);
      if (!host) throw new Error('With hostAs "player", one player must have isHost: true.');
      this.authority = host.id;
    }

    const resolved = resolveSettings(this.runtime.settings, config.settings ?? {}, this.runtime.unknownSettings);
    if (resolved.errors.length > 0) throw new Error(`Invalid settings: ${resolved.errors.join('; ')}`);
    this.settingValues = resolved.values;
    // A plain copy: the set may be a framework proxy (Vue reactive) that structuredClone rejects.
    const seed = config.shuffleSeed === null ? undefined : config.shuffleSeed ?? randomSeed();
    this.shuffleSeed = seed;
    this.preparedSet = prepareSetForPlugin(plainCopy(config.set), config.plugin.manifest, { seed });
    if (config.restore) {
      this.isStarted = true;
      this.resumeStartPending = true;
    }
    if (config.clock) this.pauseState = { pausedMs: config.clock.pausedMs ?? 0, pausedAt: config.clock.pausedAt ?? null };
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
    return [...(this.hostAs === 'presenter' ? [BOARD_ADDRESS] : []), ...this.roster.map((p) => p.id)];
  }

  /**
   * Connects a plugin instance at `address` (a player ID, `"board"`, or `"settings"`
   * for the lobby settings screen). An existing instance at the address is replaced.
   */
  async connect(address: string, endpoint: PluginEndpoint, options: { onDispose?: () => void } = {}): Promise<SessionInstance> {
    const view = this.viewOf(address);
    if (view === 'settings') {
      if (!this.runtime.multiplayer || !this.runtime.settingsScreen) throw new Error('The plugin has no settings screen (settingsScreen).');
      if (this.isStarted) throw new Error('The settings screen is only available before the game starts.');
    } else if (!this.addresses().includes(address)) {
      throw new Error(`Unknown address "${address}" in this session.`);
    }
    if (this.isEnded) throw new Error('The session has ended.');

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
      greeted: false,
      features: [],
      limiter: new RateLimiter(LIMITS.messagesPerSecond, LIMITS.messageBurst),
      serviceLimiter: new RateLimiter(LIMITS.servicesPerMinute / 60, 10),
      answerLimiter: new RateLimiter(LIMITS.answersPerSecond, LIMITS.answerBurst),
      assetLimiter: new RateLimiter(LIMITS.assetsPerSecond, LIMITS.assetBurst),
      errorLimiter: new RateLimiter(LIMITS.errorReportsPerSecond, LIMITS.errorReportBurst),
    };
    let hostApi = this.createHostApi(instance);
    // Personal sets: a player whose instance runs in this page learns their own set here.
    const own = this.sets === 'personal' && view !== 'board' && view !== 'settings' ? this.options.personalSetFor?.(address) ?? null : null;
    if (own) {
      hostApi = personalHostApi(hostApi, own, prepareSetForPlugin(own.file, this.plugin.manifest), () => address);
      this.setPlayerSet(address, personalSetInfo(own.file));
    }
    (instance as { hostApi: HostApi }).hostApi = hostApi;
    this.instances.set(address, instance);
    if (address === this.authority && this.isStarted) this.setAuthorityConnected(false);
    try {
      instance.plugin = await endpoint(instance.hostApi);
    } catch (error) {
      // Replaced or removed while connecting (the connection was destroyed): not an error.
      if (instance.disposed) return instance;
      throw error;
    }
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
    if (address === this.authority && this.isStarted) this.setAuthorityConnected(false);
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
    if (this.isStarted && !this.startPromise) return Promise.resolve(); // resumed session
    if (!this.settingsOk) return Promise.reject(new Error('The settings are not valid.'));
    const count = this.roster.length;
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
      if (this.isEnded) return;
      await sleep(25);
    }
    const countdownMs = this.options.countdownMs ?? 3000;
    for (let left = Math.ceil(countdownMs / 1000); left > 0; left--) {
      this.emit({ type: 'countdown', secondsLeft: left });
      await sleep(Math.min(1000, countdownMs - (Math.ceil(countdownMs / 1000) - left) * 1000));
    }
    if (this.isEnded) return;
    this.isStarted = true;
    this.emit({ type: 'started' });
    await this.callPlugin(this.authority, (p) => p.start());
  }

  addPlayer(player: SessionPlayer): void {
    if (this.mode === 'solo') throw new Error('Players cannot join a solo session.');
    if (this.roster.some((p) => p.id === player.id) || [BOARD_ADDRESS, SETTINGS_ADDRESS, 'server'].includes(player.id)) {
      throw new Error(`Player ID "${player.id}" is already used or reserved.`);
    }
    if (this.isStarted && !this.runtime.multiplayer!.lateJoin) throw new Error('This game does not allow joining after the start.');
    if (this.roster.length >= this.runtime.multiplayer!.players.max) throw new Error('The game is full.');
    this.roster = [...this.roster, { id: player.id, name: player.name, isHost: false, connected: true }];
    this.broadcastPlayers();
  }

  removePlayer(id: string): void {
    if (id === this.authority) throw new Error('The host cannot be removed.');
    this.disposeInstance(id);
    this.roster = this.roster.filter((p) => p.id !== id);
    this.broadcastPlayers();
  }

  renamePlayer(id: string, name: string): void {
    this.roster = this.roster.map((p) => (p.id === id ? { ...p, name } : p));
    this.broadcastPlayers();
  }

  /** Personal sets: which set a player learns (`Player.set`; shown on the board). */
  setPlayerSet(id: string, set: { id: string; title: string; language?: string } | null): void {
    if (!this.roster.some((p) => p.id === id)) return;
    this.roster = this.roster.map((p) => {
      if (p.id !== id) return p;
      const { set: _old, ...rest } = p;
      return set ? { ...rest, set } : rest;
    });
    this.broadcastPlayers();
  }

  /** Whose questions this game uses (SPEC 3.4). */
  get sets(): 'shared' | 'personal' {
    return this.options.sets === 'personal' && this.mode === 'multiplayer' ? 'personal' : 'shared';
  }

  /**
   * Simulates a connection loss / recovery of an instance. Messages to and from a
   * disconnected instance are dropped; for the authority, the others are told
   * that the authority is unavailable (SPEC 6.1).
   */
  setConnected(address: string, connected: boolean): void {
    const instance = this.instances.get(address);
    if (instance) instance.connected = connected;
    if (this.roster.some((p) => p.id === address)) {
      this.roster = this.roster.map((p) => (p.id === address ? { ...p, connected } : p));
      this.broadcastPlayers();
    }
    if (address === this.authority) this.setAuthorityConnected(connected);
    else if (connected && instance) void this.callPlugin(address, (p) => p.authorityChanged({ connected: true })); // makes the SDK re-synchronize
  }

  /** Services the plugin declares and this host offers (SPEC 5.3). */
  get services(): string[] {
    return this.runtime.services.filter((name) => typeof this.options.services?.[name] === 'function');
  }

  /** Whether the game is paused (the clock stands still on every device). */
  get paused(): boolean {
    return this.pauseState.pausedAt !== null;
  }

  /** The session clock as sent to the instances (host time; the relay adds each device's skew). */
  get clock(): SessionClock {
    return { offsetMs: 0, ...this.pauseState };
  }

  /** Pauses the game: timers and countdowns stop, players cannot act (the SDK shows "Paused"). */
  pause(): void {
    if (!this.isStarted || this.isEnded || this.paused) return;
    this.pauseState = { ...this.pauseState, pausedAt: Date.now() };
    this.broadcastClock();
  }

  /** Continues a paused game. */
  resume(): void {
    if (!this.paused) return;
    this.pauseState = { pausedMs: this.pauseState.pausedMs + Math.max(0, Date.now() - this.pauseState.pausedAt!), pausedAt: null };
    this.broadcastClock();
  }

  private broadcastClock(): void {
    const clock = this.clock;
    for (const address of this.instances.keys()) void this.callPlugin(address, (p) => p.clockChanged(clock));
    this.emit({ type: 'paused', paused: this.paused, clock: { ...this.pauseState } });
  }

  setConfig(config: Partial<HostConfig>): void {
    this.hostConfig = { ...this.hostConfig, ...config };
    for (const address of this.instances.keys()) void this.callPlugin(address, (p) => p.configChanged(this.hostConfig));
  }

  /**
   * Whether the game can finish on request (`requestFinish`): its authority listed the
   * feature `finish-request` (it has `onFinish`), is connected, and the game runs without a
   * result yet.
   */
  get canFinish(): boolean {
    const authority = this.instances.get(this.authority);
    return !!authority?.plugin && !authority.disposed && authority.connected && this.authorityConnected
      && authority.features.includes(FINISH_REQUEST_FEATURE) && this.isStarted && !this.hasResult && !this.isEnded;
  }

  /**
   * Asks the game to finish now (SPEC 7, `finishRequested`): the authority calls
   * `end(result)` (event `result`) and shows its final screen; a paused game is resumed so
   * that screen is not covered. Returns false when the game cannot (`canFinish`) or the call
   * failed – then close it with `end()`. Wait for `result` with a timeout: a game that does
   * not finish is closed the same way.
   */
  async requestFinish(): Promise<boolean> {
    if (!this.canFinish) return false;
    if (this.paused) this.resume();
    const plugin = this.instances.get(this.authority)!.plugin!;
    try {
      await plugin.finishRequested!();
      return true;
    } catch (error) {
      this.emit({ type: 'pluginError', address: this.authority, code: 'PLUGIN_CALL_FAILED', message: toProtocolError(error).detail });
      return false;
    }
  }

  /**
   * Whether the running game can take another set (`changeSet`): not with personal sets, and
   * the authority listed the feature `set-changes` (every game made with the plugin SDK 1.1).
   */
  get canChangeSet(): boolean {
    const authority = this.instances.get(this.authority);
    return this.sets !== 'personal' && !!authority?.plugin && !authority.disposed && authority.features.includes(SET_CHANGES_FEATURE) && !this.isEnded && !this.hasResult;
  }

  /**
   * The teacher (or the solo player) switches the set of the running game, or reloads it with
   * edits (SPEC 7, `setChanged`, protocol 1.1): the set is prepared with the same display
   * order, every instance gets it – the authority with the answers, the others without – with
   * its player's progress; the game keeps its state (item IDs that stay keep their meaning).
   * Returns `false` (and changes nothing) when the game cannot (`canChangeSet`) or the set has
   * no item this game plays. Instances
   * without the feature (an older SDK on a player's device) keep the earlier items.
   */
  async changeSet(file: OQSEFile): Promise<boolean> {
    if (!this.canChangeSet) return false;
    const prepared = prepareSetForPlugin(plainCopy(file), this.plugin.manifest, { seed: this.shuffleSeed });
    if (prepared.set.items.length === 0 && this.runtime.set !== 'none') return false; // nothing this game can play
    await this.beforeSetChange?.(prepared);
    this.preparedSet = prepared;
    const setId = prepared.set.meta.id;
    await Promise.all(
      [...this.instances.values()].map(async (instance) => {
        if (!instance.plugin?.setChanged || !instance.features.includes(SET_CHANGES_FEATURE) || instance.view === 'settings') return;
        const playerView = instance.view === 'solo' || instance.view === 'controller';
        const set = this.mode === 'multiplayer' && instance.address !== this.authority ? prepared.publicSet : prepared.set;
        const progress = playerView ? await this.storage.loadProgress(this.userKey(instance.address), setId) : {};
        await this.callPlugin(instance.address, (p) => p.setChanged!({ set: structuredClone(set), progress }));
      }),
    );
    this.emit({ type: 'setChanged', setId, title: prepared.set.meta.title });
    return true;
  }

  /** The relay uploads a changed set for the players' devices before they hear about it. */
  setBeforeSetChange(hook: ((prepared: PreparedSet) => Promise<void>) | null): void {
    this.beforeSetChange = hook;
  }

  /** Ends the session for all instances (they stay mounted until the app removes them). */
  async end(reason: SessionEndReason = 'closed'): Promise<void> {
    if (this.isEnded) return;
    this.isEnded = true;
    if (reason === 'finished') await this.discardSnapshot();
    else await this.flushSnapshot(); // a closed game can be continued later
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
        if (this.isEnded && method !== 'reportError') throw new ProtocolError('SESSION_ENDED', 'The session has ended.');
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
          if (instance.greeted) throw new ProtocolError('INVALID_ARGUMENT', 'hello may only be called once per instance.');
          const negotiated = negotiateProtocolVersion(handshake.protocol, PROTOCOL_VERSION);
          if (!negotiated) {
            throw new ProtocolError('UNSUPPORTED_PROTOCOL', `The plugin speaks protocol ${handshake.protocol}; this host supports ${PROTOCOL_VERSION}.`);
          }
          instance.greeted = true;
          const offered = hostFeatures(negotiated, !!this.options.chooseSet);
          instance.features = handshake.features.filter((f) => offered.includes(f));
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
            if (this.mode === 'solo' && !this.isStarted && !instance.resumed) {
              this.isStarted = true;
              this.emit({ type: 'started' });
              void this.callPlugin(instance.address, (p) => p.start());
            } else if (this.isStarted) {
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
          // The authority talks to everyone (per-player views): its limit is per other instance.
          const cost = instance.address === this.authority ? 1 / Math.max(1, this.instances.size - 1) : 1;
          if (!instance.limiter.tryTake(cost)) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.messagesPerSecond} messages per second.`);
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
          if (this.finished) {
            // A late (debounced) save after end(result): kept for this session only, not stored.
            this.finishedSnapshot = structuredClone(snapshot);
            return;
          }
          this.pendingSnapshot = structuredClone(snapshot);
          this.snapshotTimer ??= setTimeout(() => void this.flushSnapshot(), 1000 / LIMITS.snapshotsPerSecond);
        }),

      recordAnswer: (...args) =>
        call('recordAnswer', async () => {
          const [answer] = parseHostCall('recordAnswer', args);
          const self = this.roster.some((p) => p.id === instance.address) ? instance.address : null;
          const playerId = answer.playerId ?? self;
          if (!playerId) throw new ProtocolError('INVALID_ARGUMENT', 'recordAnswer needs a playerId on the board.');
          // Only the authority has the answers and checks them (SPEC 5).
          requireAuthority('recordAnswer');
          if (!this.roster.some((p) => p.id === playerId)) throw new ProtocolError('INVALID_ARGUMENT', `Unknown player "${playerId}".`);
          // The authority records for every player: its limit is per player.
          const cost = instance.address === this.authority ? 1 / Math.max(1, this.roster.length) : 1;
          if (!instance.answerLimiter.tryTake(cost)) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.answersPerSecond} answers per second.`);
          if (answer.answer !== undefined) assertJsonWithin(answer.answer, LIMITS.answerBytes, 'DATA_TOO_LARGE', 'answer');
          const known = this.prepared.set.items.find((i) => i.id === answer.itemId);
          const listOf = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
          if (!known) {
            // A generated item (service, plugin generator): statistics only, no repetition.
            if (!answer.item) throw new ProtocolError('INVALID_ARGUMENT', `Unknown item "${answer.itemId}" (attach the item for a generated one).`);
            assertJsonWithin(answer.item, LIMITS.generatedItemBytes, 'DATA_TOO_LARGE', 'item');
            this.emit({ type: 'answer', playerId, setId: this.prepared.set.meta.id, record: null, answer, generated: true, ungraded: false, skills: listOf(answer.item.skills), tags: listOf(answer.item.tags) });
            return;
          }
          const setId = this.prepared.set.meta.id;
          if (known.type === 'open-ended') {
            // Not checked automatically: `isCorrect` means nothing; a teacher decides later.
            const { item: _ignored, ...kept } = answer;
            this.emit({ type: 'answer', playerId, setId, record: null, answer: kept, generated: false, ungraded: true, skills: listOf(known.skills), tags: listOf(known.tags) });
            return;
          }
          const userKey = this.userKey(playerId);
          const progress = await this.storage.loadProgress(userKey, setId);
          const { item: _attached, ...stored } = answer;
          const history = this.answerHistory.get(playerId) ?? [];
          history.push({ itemId: answer.itemId, correct: answer.isCorrect && !answer.isSkipped, wasNew: isNew(progress[answer.itemId]) });
          this.answerHistory.set(playerId, history.slice(-200));
          const record = this.algorithm.apply(progress[answer.itemId], stored, new Date(), structuredClone(known));
          await this.storage.saveProgress(userKey, setId, { [answer.itemId]: record });
          this.emit({ type: 'answer', playerId, setId, record, answer: stored, generated: false, ungraded: false, skills: listOf(known.skills), tags: listOf(known.tags) });
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
          const { values, errors } = resolveSettings(this.runtime.settings, update.values, this.runtime.unknownSettings);
          this.settingValues = values;
          this.settingsOk = update.valid && errors.length === 0;
          const message = update.message ?? errors[0];
          this.emit({ type: 'settings', values, valid: this.settingsOk, ...(message && { message }) });
        }),

      getAsset: (...args) =>
        call('getAsset', async () => {
          const [key, itemId] = parseHostCall('getAsset', args);
          if (!instance.assetLimiter.tryTake()) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.assetsPerSecond} assets per second.`);
          // Only media of this instance's set: players' devices in multiplayer have public items
          // without the media of hidden fields (SPEC 4.4).
          // Items the authority revealed to this instance give their full media (1.1, revealItems).
          const revealed = !!itemId && this.mode === 'multiplayer' && instance.address !== this.authority && this.isRevealedTo(itemId, instance.address);
          const own = this.mode === 'multiplayer' && instance.address !== this.authority && !revealed ? this.prepared.publicSet : this.prepared.set;
          const item = itemId ? own.items.find((i) => i.id === itemId) : undefined;
          const media = resolveAsset(key, item, own.meta);
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
          if (this.hasResult) return; // only the first result counts (SPEC 5)
          this.hasResult = true;
          await this.discardSnapshot(); // a finished game is not resumed (SPEC 5)
          this.emit({ type: 'result', result });
        }),

      reportError: (...args) =>
        call('reportError', () => {
          const [error] = parseHostCall('reportError', args);
          if (!instance.errorLimiter.tryTake()) return; // beyond the rate: dropped (SPEC 8.1)
          this.emit({ type: 'pluginError', address: instance.address, code: error.code, message: error.message, ...(error.context && { context: error.context }) });
        }),

      service: (...args) =>
        call('service', async () => {
          const [name, payload] = parseHostCall('service', args);
          const handler = this.services.includes(name) ? this.options.services![name] : undefined;
          if (!handler) throw new ProtocolError('SERVICE_UNAVAILABLE', `Service "${name}" is not available here (declare it in the manifest "services"; this host offers: ${this.services.join(', ') || 'none'}).`);
          assertJsonWithin(payload, LIMITS.serviceBytes, 'MESSAGE_TOO_LARGE', `service ${name} request`);
          if (!instance.serviceLimiter.tryTake()) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.servicesPerMinute} service calls per minute.`);
          const playerId = this.roster.some((p) => p.id === instance.address) ? instance.address : null;
          const result = await handler(plainCopy(payload), { playerId, address: instance.address, pluginId: this.plugin.manifest.id, setId: this.prepared.set.meta.id });
          assertJsonWithin(result ?? null, LIMITS.serviceResultBytes, 'MESSAGE_TOO_LARGE', `service ${name} result`);
          return plainCopy(result ?? null);
        }),

      markItem: (...args) =>
        call('markItem', async () => {
          const [itemId, mark] = parseHostCall('markItem', args);
          requireView('markItem', isPlayerView());
          if (!this.prepared.set.items.some((i) => i.id === itemId)) throw new ProtocolError('INVALID_ARGUMENT', `Unknown item "${itemId}".`);
          if (!instance.limiter.tryTake()) throw new ProtocolError('RATE_LIMITED', 'Too many calls.');
          const userKey = this.userKey(instance.address);
          const setId = this.prepared.set.meta.id;
          const current = (await this.storage.loadProgress(userKey, setId))[itemId];
          // The learner's own mark: the learning state stays; an unseen item gets a bucket-0 record.
          const record = current ? { ...current, starred: mark.starred } : { bucket: 0 as const, stats: { attempts: 0, incorrect: 0, streak: 0 }, starred: mark.starred };
          await this.storage.saveProgress(userKey, setId, { [itemId]: record });
          this.emit({ type: 'marked', playerId: instance.address, setId, itemId, starred: mark.starred });
        }),

      chooseSet: (...args) =>
        call('chooseSet', async () => {
          parseHostCall('chooseSet', args);
          const ownView = instance.view === 'solo' || instance.address === BOARD_ADDRESS || this.roster.some((p) => p.id === instance.address && p.isHost);
          if (!ownView) throw new ProtocolError('NOT_ALLOWED_IN_VIEW', "chooseSet is only for the host's own view (solo, the board, the host playing along).");
          if (!instance.features.includes(CHOOSE_SET_FEATURE) || !this.options.chooseSet) throw new ProtocolError('UNKNOWN_METHOD', 'chooseSet needs the feature choose-set (protocol 1.1; this host has no set picker).');
          if (this.choosingSet) return false;
          this.choosingSet = true;
          try {
            const file = await this.options.chooseSet();
            return file ? await this.changeSet(file) : false;
          } finally {
            this.choosingSet = false;
          }
        }),

      revealItems: (...args) =>
        call('revealItems', () => {
          const [request] = parseHostCall('revealItems', args);
          requireAuthority('revealItems');
          if (!instance.features.includes(REVEAL_ITEMS_FEATURE)) throw new ProtocolError('UNKNOWN_METHOD', 'revealItems needs the feature reveal-items (list it in the handshake; protocol 1.1).');
          const known = request.itemIds.filter((id) => this.prepared.set.items.some((item) => item.id === id));
          if (request.to === null) for (const id of known) this.revealedAll.add(id);
          else {
            for (const playerId of request.to) {
              const ids = this.revealedTo.get(playerId) ?? new Set<string>();
              for (const id of known) ids.add(id);
              this.revealedTo.set(playerId, ids);
            }
          }
        }),

      pickItems: (...args) =>
        call('pickItems', async () => {
          const [request] = parseHostCall('pickItems', args);
          requireAuthority('pickItems');
          if (!instance.features.includes(PICK_ITEMS_FEATURE)) throw new ProtocolError('UNKNOWN_METHOD', 'pickItems needs the feature pick-items (list it in the handshake; protocol 1.1).');
          if (!this.roster.some((p) => p.id === request.playerId)) throw new ProtocolError('INVALID_ARGUMENT', `Unknown player "${request.playerId}".`);
          if (!instance.serviceLimiter.tryTake()) throw new ProtocolError('RATE_LIMITED', `More than ${LIMITS.servicesPerMinute} calls per minute.`);
          const progress = await this.storage.loadProgress(this.userKey(request.playerId), this.prepared.set.meta.id);
          return pickItems(this.prepared.set.items, progress, {
            count: request.count,
            now: new Date(),
            random: Math.random,
            ...(request.weights && { weights: request.weights }),
            ...(request.types && { types: request.types }),
            ...(request.exclude && { exclude: request.exclude }),
            mode: this.options.studyModeFor?.(request.playerId),
            order: this.options.pickOrderFor?.(request.playerId),
            history: this.answerHistory.get(request.playerId) ?? [],
          });
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
    const snapshot =
      instance.address !== this.authority ? null : this.finished ? structuredClone(this.finishedSnapshot) : await this.storage.loadSnapshot(this.id);
    instance.resumed = snapshot !== null;
    return {
      protocol,
      host: this.options.host ?? { name: '@memizy/host-sdk', version: HOST_SDK_VERSION },
      oqseVersion: '1.0',
      features: hostFeatures(protocol, !!this.options.chooseSet),
      session: {
        id: this.id,
        mode: this.mode,
        hostAs: this.hostAs,
        view: instance.view,
        self: instance.address,
        authority: this.authority,
        lateJoin: this.isStarted && instance.view !== 'settings',
        ...(this.sets === 'personal' && { sets: 'personal' as const }),
      },
      players: this.roster,
      // Answers only for the authority (and solo); the others get the items without them.
      // Personal sets: no instance gets the shared items (players get their own on their device).
      set: this.sets === 'personal'
        ? { meta: structuredClone(this.prepared.set.meta), items: [] }
        : structuredClone(this.mode === 'multiplayer' && instance.address !== this.authority ? this.prepared.publicSet : this.prepared.set),
      settings: { ...this.settingValues },
      config: this.hostConfig,
      clock: this.clock,
      services: this.services,
      progress: userKey ? await this.storage.loadProgress(userKey, setId) : {},
      data: userKey
        ? {
            plugin: (this.pendingDataValue(instance.address, 'plugin') ?? (await this.storage.loadData(userKey, pluginId, 'plugin', setId))) ?? null,
            set: (this.pendingDataValue(instance.address, 'set') ?? (await this.storage.loadData(userKey, pluginId, 'set', setId))) ?? null,
          }
        : { plugin: null, set: null },
      snapshot,
      // The secret seed of the game rules: only the authority (SPEC 4.2).
      ...(instance.address === this.authority && { seed: this.seed }),
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
    this.emit({ type: 'players', players: this.roster });
    for (const address of this.instances.keys()) void this.callPlugin(address, (p) => p.playersChanged(this.roster));
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

  /** Drops the pending snapshot and deletes the saved one; later saves are ignored. */
  private async discardSnapshot(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    this.finishedSnapshot = this.pendingSnapshot !== undefined ? this.pendingSnapshot : await this.storage.loadSnapshot(this.id);
    this.pendingSnapshot = undefined;
    await this.storage.deleteSnapshot?.(this.id);
  }

  private async flushSnapshot(): Promise<void> {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
    if (this.pendingSnapshot === undefined || this.finished) return;
    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = undefined;
    await this.storage.saveSnapshot(this.id, snapshot);
    if (this.finished) await this.storage.deleteSnapshot?.(this.id); // the game ended while saving
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

/** 128 random bits as 32 hex digits (the secret seed of a game's random numbers). */
function randomSeed(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
