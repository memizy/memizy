/**
 * Game runtime: state, actions, timers, synchronization and snapshots.
 * Independent of the DOM and of the transport (it only needs a HostApi).
 *
 * The authority runs the rules and broadcasts the state; other instances send
 * actions to it and apply the state updates they receive (SPEC section 3).
 */

import { create, apply, type Patches } from 'mutative';
import {
  BOARD_ADDRESS,
  LIMITS,
  findNonJson,
  jsonByteSize,
  toProtocolError,
  type HostApi,
  type IncomingMessage,
  type InitPayload,
  type Player,
} from '@memizy/protocol';
import type { OQSEAnyItem } from '@memizy/oqse';
import type { GameContext, GameDefinition, RecordAnswerOptions } from '../types';
import { diffJson } from './diff';
import { SeededRandom, seedFromString } from './random';

/** Messages exchanged between SDK instances (inside protocol `send` / `deliver`). */
export type SyncMessage =
  /** An action of a player; `i` numbers the actions of the sender (for `ui.pending`). */
  | { t: 'act'; n: string; p: unknown; i?: number }
  | { t: 'sync' }
  /** `a`: the last action number the authority processed, per sender. */
  | { t: 'state'; v: number; s: unknown; a?: Record<string, number> }
  | { t: 'patch'; b: number; v: number; p: Patches; a?: Record<string, number> }
  /** Full items (with answers) the authority revealed to this device (`ctx.reveal`). */
  | { t: 'reveal'; items: OQSEAnyItem[] }
  /** The authority took a reveal back (`ctx.hide`): back to the public items. */
  | { t: 'hide'; ids: string[] };

/** An action of this device the authority has not confirmed yet (`ui.pending`). */
export interface PendingAction {
  name: string;
  payload: unknown;
  sentAt: number;
}

/** Minimum time between two state broadcasts. */
const MIN_FLUSH_INTERVAL_MS = 40;

/** Internal timer action and key of the phase deadline. */
const PHASE_TIMEOUT = '$phaseTimeout';
const PHASE_TIMER = '$phase';

/** Pending actions are forgotten after this time (lost message, authority away). */
const PENDING_TIMEOUT_MS = 5000;

interface TimerEntry {
  key: string;
  at: number;
  action: string;
  payload: unknown;
}

/** What the authority saves with `saveSnapshot` (opaque to the host). */
export interface GameSnapshot {
  format: 1;
  state: unknown;
  version: number;
  rng: number;
  timerSeq: number;
  timers: TimerEntry[];
  players: string[];
  ended: boolean;
  /** Revealed item ids: to everyone, and per player. */
  revealed?: { all: string[]; to: Record<string, string[]> };
}

type Effect =
  | { type: 'after'; timer: TimerEntry }
  | { type: 'cancel'; key: string }
  | { type: 'record'; itemId: string; item?: OQSEAnyItem; isCorrect: boolean; options: RecordAnswerOptions; playerId: string | null }
  | { type: 'end'; result: { scores?: Record<string, number>; summary?: string } }
  | { type: 'reveal'; itemIds: string[]; to: string[] | null }
  | { type: 'hide'; itemIds: string[]; to: string[] | null }
  | { type: 'goto'; phase: string };

export interface RuntimeOptions {
  /** Batching interval for state updates (≤ ~20 per second). */
  flushMs?: number;
  /** Debounce for snapshots (≤ 2 per second). */
  snapshotMs?: number;
  /** Logger for problems in plugin code (default: console + host.reportError). */
  onError?: (code: string, message: string) => void;
}

/**
 * Copies a value passed to ctx inside an action. Values taken from the state
 * (`ctx.end({ scores: state.scores })`) are drafts that stop working when the
 * action ends, and cannot be sent to the host (postMessage cannot clone them).
 */
function detach<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class GameRuntime<S = unknown> {
  readonly init: InitPayload;
  readonly isAuthority: boolean;
  state: S | undefined = undefined;
  version = 0;
  players: Player[];
  ended = false;
  authorityConnected = true;
  /** Called whenever something visible changed (state, players, clock…). */
  onChange: () => void = () => {};

  private readonly def: GameDefinition<S>;
  private readonly host: HostApi;
  private readonly options: Required<Omit<RuntimeOptions, 'onError'>>;
  private readonly reportError: (code: string, message: string) => void;
  private readonly itemsById: Map<string, OQSEAnyItem>;
  private clockOffset: number;
  /** Pauses (SPEC: game time = session time without the paused time). */
  private pausedMs: number;
  private pausedAt: number | null;
  private rng: SeededRandom;
  private timers = new Map<string, TimerEntry & { handle?: ReturnType<typeof setTimeout> }>();
  private timerSeq = 0;
  private knownPlayers = new Set<string>();
  private pending: Patches = [];
  private needFullState = false;
  private sentVersion = 0;
  private flushHandle: ReturnType<typeof setTimeout> | undefined;
  private snapshotHandle: ReturnType<typeof setTimeout> | undefined;
  /** This device's actions waiting for the authority (controllers only). */
  private pendingActions: (PendingAction & { id: number })[] = [];
  private actionSeq = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  /** Authority: last processed action number per sender, not yet broadcast. */
  private acks: Record<string, number> = {};
  private acksDirty = false;
  /** Authority: item ids revealed to everyone / to single players (sent again on a resync). */
  private revealedAll = new Set<string>();
  private revealedTo = new Map<string, Set<string>>();
  /** Authority with `playerView`: the last view (and version) sent to each address. */
  private sentViews = new Map<string, { view: unknown; version: number }>();
  /** Followers: the public copies of revealed items (to go back on `hide`). */
  private publicCopies = new Map<string, OQSEAnyItem>();

  constructor(def: GameDefinition<S>, host: HostApi, init: InitPayload, options: RuntimeOptions = {}) {
    this.def = def;
    this.host = host;
    this.init = init;
    this.isAuthority = init.session.authority === init.session.self;
    this.players = init.players;
    this.clockOffset = init.clock.offsetMs;
    this.pausedMs = init.clock.pausedMs ?? 0;
    this.pausedAt = init.clock.pausedAt ?? null;
    this.rng = new SeededRandom(seedFromString(init.session.id));
    this.itemsById = new Map(init.set.items.map((item) => [item.id, item]));
    this.options = { flushMs: options.flushMs ?? 16, snapshotMs: options.snapshotMs ?? 500 };
    this.reportError =
      options.onError ??
      ((code, message) => {
        console.error(`[memizy] ${code}: ${message}`);
        host.reportError({ code, message }).catch(() => {});
      });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /** Called after the handshake: resume from a snapshot or ask the authority for the state. */
  boot(): void {
    if (this.isAuthority) {
      const snapshot = this.init.snapshot as GameSnapshot | null;
      if (snapshot && snapshot.format === 1) this.restore(snapshot);
    } else {
      this.sendToAuthority({ t: 'sync' });
    }
  }

  /** `PluginApi.start` – create the initial state (authority only). */
  start(): void {
    if (!this.isAuthority || this.state !== undefined) return;
    const effects: Effect[] = [];
    let initial: S;
    try {
      initial = this.def.initialState(this.context(null, true, effects));
    } catch (e) {
      this.reportError('INITIAL_STATE_FAILED', `initialState threw: ${errorText(e)}`);
      return;
    }
    const problem = initial !== null && typeof initial === 'object' ? findNonJson(initial, 'state') : 'state must be an object';
    if (problem) {
      this.reportError('INVALID_STATE', `initialState returned an invalid state: ${problem}`);
      return;
    }
    this.state = initial;
    this.version = 1;
    this.knownPlayers = new Set(this.players.map((p) => p.id));
    this.needFullState = true;
    this.applyEffects(effects);
    this.afterChange();
  }

  /** Game time in ms: the session clock without paused time (stands still while paused). */
  now(): number {
    return (this.pausedAt ?? Date.now() + this.clockOffset) - this.pausedMs;
  }

  /** Whether the host has paused the game. */
  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** `PluginApi.clockChanged`: a corrected clock, or a pause / resume. */
  setClock(clock: { offsetMs: number; pausedMs?: number; pausedAt?: number | null }): void {
    const wasPaused = this.paused;
    this.clockOffset = clock.offsetMs;
    this.pausedMs = clock.pausedMs ?? 0;
    this.pausedAt = clock.pausedAt ?? null;
    if (this.paused !== wasPaused) {
      // Stop the timers while paused; on resume they continue where they were (game time).
      for (const timer of [...this.timers.values()]) {
        clearTimeout(timer.handle);
        if (this.paused) timer.handle = undefined;
        else this.setTimer({ key: timer.key, at: timer.at, action: timer.action, payload: timer.payload });
      }
    }
    this.onChange();
  }

  item(id: string): OQSEAnyItem | undefined {
    return this.itemsById.get(id);
  }

  /** Items with their answers, received from the authority. */
  private addItems(items: OQSEAnyItem[]): void {
    const list = this.init.set.items as OQSEAnyItem[];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !this.itemsById.has(item.id)) continue;
      if (!this.publicCopies.has(item.id)) this.publicCopies.set(item.id, this.itemsById.get(item.id)!);
      this.itemsById.set(item.id, item);
      const index = list.findIndex((i) => i.id === item.id);
      if (index !== -1) list[index] = item;
    }
    this.onChange();
  }

  /** Followers: back to the public copies (answers hidden again). */
  private hideItems(ids: string[]): void {
    const list = this.init.set.items as OQSEAnyItem[];
    for (const id of ids) {
      const copy = this.publicCopies.get(id);
      if (!copy) continue;
      this.publicCopies.delete(id);
      this.itemsById.set(id, copy);
      const index = list.findIndex((i) => i.id === id);
      if (index !== -1) list[index] = copy;
    }
    this.onChange();
  }

  /** Authority: sends the revealed items to devices that (re)load the state. */
  private sendReveals(addresses: string[] | 'all'): void {
    const items = (ids: Iterable<string>) => [...ids].map((id) => this.itemsById.get(id)).filter((i): i is OQSEAnyItem => !!i);
    if (this.revealedAll.size) this.send(addresses, { t: 'reveal', items: items(this.revealedAll) });
    for (const [playerId, ids] of this.revealedTo) {
      if (addresses === 'all' || addresses.includes(playerId)) this.send([playerId], { t: 'reveal', items: items(ids) });
    }
  }

  /** `PluginApi.setChanged` – the set was edited in the host (solo). */
  replaceSet(set: InitPayload['set']): void {
    this.init.set = set;
    this.itemsById.clear();
    for (const item of set.items) this.itemsById.set(item.id, item);
    this.onChange();
  }

  /** Stops timers and pending work (instance closing). */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    clearTimeout(this.flushHandle);
    clearTimeout(this.snapshotHandle);
    clearTimeout(this.pendingTimer);
  }

  /** Actions of this device that the authority has not processed yet. */
  get waitingActions(): readonly PendingAction[] {
    return this.pendingActions.map(({ name, payload, sentAt }) => ({ name, payload, sentAt }));
  }

  private confirmActions(acks: Record<string, number> | undefined): void {
    const done = acks?.[this.init.session.self];
    if (typeof done !== 'number' || !this.pendingActions.length) return;
    this.pendingActions = this.pendingActions.filter((a) => a.id > done);
  }

  /** Forgets actions the authority never confirmed (and re-renders when they expire). */
  private expirePending(): void {
    clearTimeout(this.pendingTimer);
    const now = Date.now();
    const before = this.pendingActions.length;
    this.pendingActions = this.pendingActions.filter((a) => now - a.sentAt < PENDING_TIMEOUT_MS);
    if (this.pendingActions.length !== before) this.onChange();
    if (this.pendingActions.length) {
      const next = Math.min(...this.pendingActions.map((a) => a.sentAt)) + PENDING_TIMEOUT_MS - now;
      this.pendingTimer = setTimeout(() => this.expirePending(), Math.max(10, next));
    }
  }

  // ==========================================================================
  // Actions
  // ==========================================================================

  /** `ui.act` – run locally on the authority, otherwise send to it. */
  dispatch(name: string, payload: unknown): void {
    if (this.ended || typeof name !== 'string' || this.paused) return; // nothing happens while paused
    if (this.isAuthority) {
      this.runAction(name, payload, this.selfPlayerId(), true); // the authority is the board, the host or the solo player
    } else if (this.authorityConnected) {
      const id = ++this.actionSeq;
      this.pendingActions.push({ id, name, payload: payload ?? null, sentAt: Date.now() });
      this.sendToAuthority({ t: 'act', n: name, p: payload ?? null, i: id });
      this.expirePending();
      this.onChange(); // show "sent" right away
    }
  }

  /** `PluginApi.deliver` – a message from another instance. */
  receive(message: IncomingMessage): void {
    const data = message.data as SyncMessage | null;
    if (!data || typeof data !== 'object') return;

    if (this.isAuthority) {
      if (data.t === 'act' && typeof data.n === 'string') {
        if (this.ended) return;
        const player = this.players.find((p) => p.id === message.from);
        // While paused, actions are ignored (still confirmed, so ui.pending clears).
        if (!this.paused) this.runAction(data.n, data.p, player ? player.id : null, message.from === BOARD_ADDRESS || player?.isHost === true);
        if (typeof data.i === 'number') {
          // Confirm it even when the rules ignored it (no state change), so ui.pending clears.
          this.acks[message.from] = data.i;
          this.acksDirty = true;
          this.scheduleFlush();
        }
      } else if (data.t === 'sync' && this.state !== undefined) {
        this.sendReveals([message.from]);
        const view = this.def.playerView ? this.viewFor(message.from) : this.state;
        if (view === undefined) return;
        if (this.def.playerView) this.sentViews.set(message.from, { view, version: this.version });
        this.send([message.from], { t: 'state', v: this.version, s: view });
      }
      return;
    }

    // State comes only from the authority. The host stamps the sender, so another
    // player cannot send a fake state to everyone (send('all') is allowed in the protocol).
    if (message.from !== this.init.session.authority) return;
    if (data.t === 'reveal' && Array.isArray(data.items)) {
      this.addItems(data.items);
    } else if (data.t === 'hide' && Array.isArray(data.ids)) {
      this.hideItems(data.ids);
    } else if (data.t === 'state') {
      this.state = data.s as S;
      this.version = data.v;
      this.confirmActions(data.a);
      this.onChange();
    } else if (data.t === 'patch') {
      this.confirmActions(data.a);
      if (this.state === undefined || data.b !== this.version) {
        this.sendToAuthority({ t: 'sync' });
        return;
      }
      try {
        this.state = apply(this.state as object, data.p) as S;
        this.version = data.v;
        this.onChange();
      } catch {
        this.sendToAuthority({ t: 'sync' });
      }
    }
  }

  /** `PluginApi.playersChanged`. */
  updatePlayers(players: Player[]): void {
    const previous = this.players;
    this.players = players;
    if (this.isAuthority && this.state !== undefined && !this.ended) {
      const ids = new Set(players.map((p) => p.id));
      for (const player of players) {
        if (!this.knownPlayers.has(player.id)) {
          this.knownPlayers.add(player.id);
          if (this.def.playerJoined) this.run((draft, ctx) => this.def.playerJoined!(draft, player, ctx), null, true, 'playerJoined');
        }
      }
      for (const id of [...this.knownPlayers]) {
        if (!ids.has(id)) {
          this.knownPlayers.delete(id);
          const player = previous.find((p) => p.id === id) ?? { id, name: id, isHost: false, connected: false };
          if (this.def.playerLeft) this.run((draft, ctx) => this.def.playerLeft!(draft, player, ctx), null, true, 'playerLeft');
        }
      }
      this.scheduleSnapshot();
    }
    this.onChange();
  }

  /** `PluginApi.authorityChanged`. */
  setAuthorityConnected(connected: boolean): void {
    this.authorityConnected = connected;
    if (connected) this.sendToAuthority({ t: 'sync' });
    this.onChange();
  }

  private selfPlayerId(): string | null {
    const self = this.init.session.self;
    return this.players.some((p) => p.id === self) ? self : null;
  }

  private runAction(name: string, payload: unknown, playerId: string | null, fromHost: boolean, fromTimer = false): void {
    if (name === PHASE_TIMEOUT) {
      if (fromTimer) this.phaseTimeout(payload);
      return;
    }
    if (!fromTimer && !this.phaseAllows(name)) return; // e.g. a late "answer" after the question ended
    const handler = Object.prototype.hasOwnProperty.call(this.def.actions, name) ? this.def.actions[name] : undefined;
    if (!handler) {
      this.reportError('UNKNOWN_ACTION', `Action "${name}" is not defined in actions.`);
      return;
    }
    this.run((draft, ctx) => handler(draft, payload, ctx), playerId, fromHost, name);
  }

  /** Runs a state change on the authority with a mutable draft. */
  private run(recipe: (draft: S, ctx: GameContext) => void | S, playerId: string | null, fromHost: boolean, label: string): void {
    if (this.state === undefined) return;
    const effects: Effect[] = [];
    const ctx = this.context(playerId, fromHost, effects);
    let returned: unknown;
    let draftRef: unknown;
    let next: S;
    let patches: Patches;
    try {
      [next, patches] = create(
        this.state as object,
        (draft) => {
          draftRef = draft;
          returned = recipe(draft as S, ctx);
        },
        { enablePatches: true },
      ) as unknown as [S, Patches];
    } catch (e) {
      this.reportError('ACTION_FAILED', `${label} threw: ${errorText(e)}`);
      return;
    }

    if (returned !== undefined && returned !== draftRef) {
      // The handler returned a new state instead of mutating the draft.
      const problem = returned !== null && typeof returned === 'object' ? findNonJson(returned, 'state') : 'state must be an object';
      if (problem) {
        this.reportError('INVALID_STATE', `${label} returned an invalid state: ${problem}`);
        return;
      }
      this.state = returned as S;
      this.needFullState = true;
    } else {
      if (patches.length === 0) {
        // No state change (e.g. a late or invalid action, or only timers scheduled).
        if (effects.length > 0) {
          this.applyEffects(effects);
          this.scheduleSnapshot();
          this.onChange();
        }
        return;
      }
      for (const patch of patches) {
        const path = Array.isArray(patch.path) ? patch.path.join('.') : patch.path;
        const problem = 'value' in patch ? findNonJson(patch.value, `state.${path}`) : null;
        if (problem) {
          this.reportError('INVALID_STATE', `${label} put a non-JSON value into the state: ${problem}`);
          return;
        }
      }
      this.state = next;
      this.pending.push(...patches);
    }
    this.version += 1;
    this.applyEffects(effects);
    this.afterChange();
  }

  private context(playerId: string | null, fromHost: boolean, effects: Effect[]): GameContext {
    const now = this.now();
    const init = this.init;
    const rng = this.rng;
    const items = init.set.items;
    let timerSeq = this.timerSeq;
    const ctx: GameContext = {
      playerId,
      fromHost,
      players: this.players,
      items,
      item: (id) => this.itemsById.get(id),
      settings: init.settings,
      mode: init.session.mode,
      hostAs: init.session.hostAs,
      now,
      random: () => rng.next(),
      shuffle: (array) => rng.shuffle(array),
      after: (ms, action, payload, options) => {
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw new Error('ctx.after: ms must be a non-negative number');
        if (typeof action !== 'string') throw new Error('ctx.after: action must be the name of an action');
        timerSeq += 1;
        const key = options?.key ?? `#${timerSeq}`;
        effects.push({ type: 'after', timer: { key, at: now + ms, action, payload: detach(payload ?? null) } });
        this.timerSeq = timerSeq;
      },
      cancel: (key) => {
        effects.push({ type: 'cancel', key });
      },
      recordAnswer: (itemOrId, isCorrect, options = {}) => {
        const given = typeof itemOrId === 'string' ? null : (detach(itemOrId) as OQSEAnyItem);
        const itemId = typeof itemOrId === 'string' ? itemOrId : given?.id;
        if (typeof itemId !== 'string') throw new Error('ctx.recordAnswer: pass an item id or an item');
        // Items of the set are known to the host; a generated one travels with the answer.
        const item = given && !this.itemsById.has(itemId) ? given : undefined;
        effects.push({ type: 'record', itemId, item, isCorrect, options: detach(options), playerId });
      },
      end: (result = {}) => {
        effects.push({ type: 'end', result: detach(result) });
      },
      reveal: (itemIds, options = {}) => {
        const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).filter((id) => typeof id === 'string' && this.itemsById.has(id));
        const to = options.to === undefined ? null : (Array.isArray(options.to) ? options.to : [options.to]).filter((id) => typeof id === 'string');
        if (ids.length) effects.push({ type: 'reveal', itemIds: ids, to });
      },
      goto: (phase) => {
        if (!this.def.phases || !Object.prototype.hasOwnProperty.call(this.def.phases, phase)) throw new Error(`ctx.goto: unknown phase "${phase}"`);
        effects.push({ type: 'goto', phase });
      },
      hide: (itemIds, options = {}) => {
        const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).filter((id) => typeof id === 'string' && this.itemsById.has(id));
        const to = options.to === undefined ? null : (Array.isArray(options.to) ? options.to : [options.to]).filter((id) => typeof id === 'string');
        if (ids.length) effects.push({ type: 'hide', itemIds: ids, to });
      },
    };
    return ctx;
  }

  private applyEffects(effects: Effect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'after':
          this.setTimer(effect.timer);
          break;
        case 'cancel':
          this.clearTimer(effect.key);
          break;
        case 'record': {
          const playerId = effect.options.playerId ?? effect.playerId ?? this.selfPlayerId();
          if (!playerId) {
            this.reportError('RECORD_WITHOUT_PLAYER', `recordAnswer(${effect.itemId}) needs a player (call it from a player's action or pass { playerId }).`);
            break;
          }
          const { playerId: _ignored, ...rest } = effect.options;
          this.host
            .recordAnswer({ playerId, itemId: effect.itemId, isCorrect: effect.isCorrect, ...rest, ...(effect.item ? { item: effect.item as never } : {}) })
            .catch((e) => this.warn('recordAnswer', e));
          break;
        }
        case 'reveal':
          this.reveal(effect.itemIds, effect.to);
          break;
        case 'hide':
          this.hide(effect.itemIds, effect.to);
          break;
        case 'goto':
          this.enterPhase(effect.phase);
          break;
        case 'end':
          this.ended = true;
          for (const key of [...this.timers.keys()]) this.clearTimer(key);
          this.host.end(effect.result).catch((e) => this.warn('end', e));
          break;
      }
    }
  }

  // ==========================================================================
  // Timers
  // ==========================================================================

  private setTimer(timer: TimerEntry): void {
    this.clearTimer(timer.key);
    const delay = Math.max(0, timer.at - this.now());
    const handle = this.paused ? undefined : setTimeout(() => this.fireTimer(timer.key), delay);
    this.timers.set(timer.key, { ...timer, handle });
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer.handle);
      this.timers.delete(key);
    }
  }

  private fireTimer(key: string): void {
    const timer = this.timers.get(key);
    if (!timer || this.ended || this.paused) return;
    this.timers.delete(key);
    this.runAction(timer.action, timer.payload, null, true, true);
  }

  // ==========================================================================
  // Broadcasting, snapshots
  // ==========================================================================

  private afterChange(): void {
    this.scheduleFlush();
    this.scheduleSnapshot();
    this.onChange();
  }

  private lastFlush = 0;

  /** Soon after a change, but at most ~25 times per second (the message rate limit is 30). */
  private scheduleFlush(): void {
    if (this.init.session.mode === 'solo' || this.flushHandle !== undefined) return;
    const delay = Math.max(this.options.flushMs, MIN_FLUSH_INTERVAL_MS - (Date.now() - this.lastFlush));
    this.flushHandle = setTimeout(() => {
      this.flushHandle = undefined;
      this.lastFlush = Date.now();
      this.flush();
    }, delay);
  }

  /** Sends the accumulated changes to all other instances. */
  flush(): void {
    if (this.state === undefined || (this.version === this.sentVersion && !this.acksDirty)) return;
    if (this.def.playerView) {
      this.flushViews();
      return;
    }
    const acks = this.acksDirty ? { a: this.acks } : {};
    let message: SyncMessage = { t: 'patch', b: this.sentVersion, v: this.version, p: this.pending, ...acks };
    if (this.needFullState || jsonByteSize(message) > LIMITS.messageBytes - 1024) {
      message = { t: 'state', v: this.version, s: this.state, ...acks };
      if (jsonByteSize(message) > LIMITS.messageBytes - 1024) {
        this.reportError('STATE_TOO_LARGE', `The game state is larger than ${LIMITS.messageBytes} bytes; keep it small (store IDs, not whole items).`);
        return;
      }
    }
    if (message.t === 'state') this.sendReveals('all'); // e.g. after a resume: the answers shown so far
    this.pending = [];
    this.needFullState = false;
    this.sentVersion = this.version;
    this.acks = {};
    this.acksDirty = false;
    this.send('all', message);
  }

  // ==========================================================================
  // Per-player views (`playerView`)
  // ==========================================================================

  /** The view of the state for an address (player id, or the board). Undefined on error. */
  viewFor(address: string | null): unknown {
    if (this.state === undefined || !this.def.playerView) return this.state;
    const playerId = address !== null && this.players.some((p) => p.id === address) ? address : null;
    try {
      const view = this.def.playerView(structuredClone(this.state), playerId);
      const problem = view !== null && typeof view === 'object' ? findNonJson(view, 'view') : 'playerView must return an object';
      if (problem) {
        this.reportError('INVALID_VIEW', `playerView returned an invalid view: ${problem}`);
        return undefined;
      }
      return view;
    } catch (e) {
      this.reportError('VIEW_FAILED', `playerView threw: ${errorText(e)}`);
      return undefined;
    }
  }

  /** Addresses of the other instances that receive state (players and the board). */
  private recipients(): string[] {
    const self = this.init.session.self;
    const list = this.players.map((p) => p.id);
    if (this.init.session.hostAs === 'presenter') list.push(BOARD_ADDRESS);
    return list.filter((a) => a !== self);
  }

  /** Sends every device the changes of its own view. */
  private flushViews(): void {
    const full = this.needFullState;
    if (full) this.sendReveals('all');
    for (const address of this.recipients()) {
      const view = this.viewFor(address);
      if (view === undefined) continue;
      const sent = full ? undefined : this.sentViews.get(address);
      const ack = this.acks[address];
      const a = this.acksDirty && ack !== undefined ? { a: { [address]: ack } } : {};
      let message: SyncMessage;
      if (sent) {
        const patches = diffJson(sent.view, view);
        if (patches.length === 0 && !a.a) continue;
        message = { t: 'patch', b: sent.version, v: this.version, p: patches, ...a };
        if (jsonByteSize(message) > LIMITS.messageBytes - 1024) message = { t: 'state', v: this.version, s: view, ...a };
      } else {
        message = { t: 'state', v: this.version, s: view, ...a };
      }
      if (message.t === 'state' && jsonByteSize(message) > LIMITS.messageBytes - 1024) {
        this.reportError('STATE_TOO_LARGE', `The view of the game state is larger than ${LIMITS.messageBytes} bytes; keep it small.`);
        continue;
      }
      this.sentViews.set(address, { view, version: this.version });
      this.send([address], message);
    }
    this.pending = [];
    this.needFullState = false;
    this.sentVersion = this.version;
    this.acks = {};
    this.acksDirty = false;
  }

  private scheduleSnapshot(): void {
    if (!this.isAuthority || this.snapshotHandle !== undefined || this.state === undefined) return;
    this.snapshotHandle = setTimeout(() => {
      this.snapshotHandle = undefined;
      this.host.saveSnapshot(this.snapshot()).catch((e) => this.warn('saveSnapshot', e));
    }, this.options.snapshotMs);
  }

  /** `ctx.reveal`: sends the full items (with answers) to everyone or to some players. */
  private reveal(itemIds: string[], to: string[] | null): void {
    if (this.init.session.mode === 'solo') return; // the solo player already has them
    const items = itemIds.map((id) => this.itemsById.get(id)!);
    if (to === null) {
      for (const id of itemIds) this.revealedAll.add(id);
      this.send('all', { t: 'reveal', items });
      return;
    }
    for (const playerId of to) {
      const set = this.revealedTo.get(playerId) ?? new Set<string>();
      for (const id of itemIds) set.add(id);
      this.revealedTo.set(playerId, set);
    }
    if (to.length) this.send(to, { t: 'reveal', items });
    this.scheduleSnapshot();
  }

  // ==========================================================================
  // Phases (optional `phases` of the game definition)
  // ==========================================================================

  private phaseDepth = 0;

  /** Whether the current phase allows the action (only actions listed in some phase are restricted). */
  private phaseAllows(name: string): boolean {
    const phases = this.def.phases;
    if (!phases || this.state === undefined) return true;
    const listed = Object.values(phases).some((p) => p.actions?.includes(name));
    if (!listed) return true;
    const current = (this.state as { phase?: unknown }).phase;
    return typeof current === 'string' && (phases[current]?.actions ?? []).includes(name);
  }

  private enterPhase(name: string): void {
    const def = this.def.phases?.[name];
    if (!def) return;
    if (this.phaseDepth > 20) {
      this.reportError('PHASE_LOOP', `ctx.goto("${name}") keeps entering phases from onEnter; stopped.`);
      return;
    }
    this.phaseDepth += 1;
    try {
      this.run(
        (draft, ctx) => {
          const state = draft as Record<string, unknown>;
          state.phase = name;
          state.phaseSeq = (typeof state.phaseSeq === 'number' ? state.phaseSeq : 0) + 1;
          const seconds = typeof def.seconds === 'function' ? def.seconds(draft, ctx) : def.seconds;
          if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
            state.phaseEndsAt = ctx.now + seconds * 1000;
            ctx.after(seconds * 1000, PHASE_TIMEOUT, { seq: state.phaseSeq }, { key: PHASE_TIMER });
          } else {
            state.phaseEndsAt = null;
            ctx.cancel(PHASE_TIMER);
          }
          def.onEnter?.(draft, ctx);
        },
        null,
        true,
        `phase "${name}"`,
      );
    } finally {
      this.phaseDepth -= 1;
    }
  }

  private phaseTimeout(payload: unknown): void {
    const seq = (payload as { seq?: unknown } | null)?.seq;
    this.run(
      (draft, ctx) => {
        const state = draft as Record<string, unknown>;
        if (state.phaseSeq !== seq || typeof state.phase !== 'string') return; // the phase changed meanwhile
        const onTimeout = this.def.phases?.[state.phase]?.onTimeout;
        if (typeof onTimeout === 'string') ctx.goto(onTimeout);
        else if (typeof onTimeout === 'function') onTimeout(draft, ctx);
        else state.phaseEndsAt = null;
      },
      null,
      true,
      'phase timeout',
    );
  }

  /** `ctx.hide`: takes reveals back (for everyone, or for some players). */
  private hide(itemIds: string[], to: string[] | null): void {
    if (this.init.session.mode === 'solo') return;
    const targets = to ?? [...new Set([...this.revealedTo.keys()])];
    for (const id of itemIds) {
      if (to === null) this.revealedAll.delete(id);
      for (const playerId of targets) this.revealedTo.get(playerId)?.delete(id);
    }
    this.send(to === null ? 'all' : to, { t: 'hide', ids: itemIds });
    this.scheduleSnapshot();
  }

  snapshot(): GameSnapshot {
    return {
      format: 1,
      state: this.state,
      version: this.version,
      rng: this.rng.state,
      timerSeq: this.timerSeq,
      timers: [...this.timers.values()].map(({ key, at, action, payload }) => ({ key, at, action, payload })),
      players: [...this.knownPlayers],
      ended: this.ended,
      revealed: { all: [...this.revealedAll], to: Object.fromEntries([...this.revealedTo].map(([p, ids]) => [p, [...ids]])) },
    };
  }

  private restore(snapshot: GameSnapshot): void {
    this.state = snapshot.state as S;
    this.version = snapshot.version;
    this.rng.state = snapshot.rng;
    this.timerSeq = snapshot.timerSeq;
    this.knownPlayers = new Set(snapshot.players);
    this.ended = snapshot.ended;
    this.revealedAll = new Set(snapshot.revealed?.all ?? []);
    this.revealedTo = new Map(Object.entries(snapshot.revealed?.to ?? {}).map(([p, ids]) => [p, new Set(ids)]));
    if (!this.ended) for (const timer of snapshot.timers) this.setTimer(timer);
    this.needFullState = true;
    this.scheduleFlush();
    this.onChange();
    // Players who left or joined while the authority was away.
    this.updatePlayers(this.players);
  }

  private sendToAuthority(message: SyncMessage): void {
    if (this.init.session.mode === 'solo') return;
    this.send('authority', message);
  }

  private send(to: 'authority' | 'all' | string[], data: SyncMessage): void {
    this.host.send({ to, data }).catch((e) => {
      const error = toProtocolError(e);
      if (error.code === 'AUTHORITY_UNAVAILABLE') return; // the host shows "waiting for the host"
      this.warn('send', error);
    });
  }

  private warn(what: string, error: unknown): void {
    const e = toProtocolError(error);
    console.warn(`[memizy] ${what} failed: ${e.message}`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
