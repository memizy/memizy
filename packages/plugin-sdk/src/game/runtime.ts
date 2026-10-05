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
import { SeededRandom, seedFromString } from './random';

/** Messages exchanged between SDK instances (inside protocol `send` / `deliver`). */
export type SyncMessage =
  | { t: 'act'; n: string; p: unknown }
  | { t: 'sync' }
  | { t: 'state'; v: number; s: unknown }
  | { t: 'patch'; b: number; v: number; p: Patches };

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
}

type Effect =
  | { type: 'after'; timer: TimerEntry }
  | { type: 'cancel'; key: string }
  | { type: 'record'; itemId: string; isCorrect: boolean; options: RecordAnswerOptions; playerId: string | null }
  | { type: 'end'; result: { scores?: Record<string, number>; summary?: string } };

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
  private rng: SeededRandom;
  private timers = new Map<string, TimerEntry & { handle?: ReturnType<typeof setTimeout> }>();
  private timerSeq = 0;
  private knownPlayers = new Set<string>();
  private pending: Patches = [];
  private needFullState = false;
  private sentVersion = 0;
  private flushHandle: ReturnType<typeof setTimeout> | undefined;
  private snapshotHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(def: GameDefinition<S>, host: HostApi, init: InitPayload, options: RuntimeOptions = {}) {
    this.def = def;
    this.host = host;
    this.init = init;
    this.isAuthority = init.session.authority === init.session.self;
    this.players = init.players;
    this.clockOffset = init.clock.offsetMs;
    this.rng = new SeededRandom(seedFromString(init.session.id));
    this.itemsById = new Map(init.set.items.map((item) => [item.id, item]));
    this.options = { flushMs: options.flushMs ?? 50, snapshotMs: options.snapshotMs ?? 500 };
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

  /** Session clock in ms. */
  now(): number {
    return Date.now() + this.clockOffset;
  }

  setClockOffset(offsetMs: number): void {
    this.clockOffset = offsetMs;
    this.onChange();
  }

  item(id: string): OQSEAnyItem | undefined {
    return this.itemsById.get(id);
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
  }

  // ==========================================================================
  // Actions
  // ==========================================================================

  /** `ui.act` – run locally on the authority, otherwise send to it. */
  dispatch(name: string, payload: unknown): void {
    if (this.ended || typeof name !== 'string') return;
    if (this.isAuthority) {
      this.runAction(name, payload, this.selfPlayerId(), true); // the authority is the board, the host or the solo player
    } else if (this.authorityConnected) {
      this.sendToAuthority({ t: 'act', n: name, p: payload ?? null });
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
        this.runAction(data.n, data.p, player ? player.id : null, message.from === BOARD_ADDRESS || player?.isHost === true);
      } else if (data.t === 'sync' && this.state !== undefined) {
        this.send([message.from], { t: 'state', v: this.version, s: this.state });
      }
      return;
    }

    if (data.t === 'state') {
      this.state = data.s as S;
      this.version = data.v;
      this.onChange();
    } else if (data.t === 'patch') {
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

  private runAction(name: string, payload: unknown, playerId: string | null, fromHost: boolean): void {
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
      recordAnswer: (itemId, isCorrect, options = {}) => {
        effects.push({ type: 'record', itemId, isCorrect, options: detach(options), playerId });
      },
      end: (result = {}) => {
        effects.push({ type: 'end', result: detach(result) });
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
          this.host.recordAnswer({ playerId, itemId: effect.itemId, isCorrect: effect.isCorrect, ...rest }).catch((e) => this.warn('recordAnswer', e));
          break;
        }
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
    const handle = setTimeout(() => this.fireTimer(timer.key), delay);
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
    if (!timer || this.ended) return;
    this.timers.delete(key);
    this.runAction(timer.action, timer.payload, null, true);
  }

  // ==========================================================================
  // Broadcasting, snapshots
  // ==========================================================================

  private afterChange(): void {
    this.scheduleFlush();
    this.scheduleSnapshot();
    this.onChange();
  }

  private scheduleFlush(): void {
    if (this.init.session.mode === 'solo' || this.flushHandle !== undefined) return;
    this.flushHandle = setTimeout(() => {
      this.flushHandle = undefined;
      this.flush();
    }, this.options.flushMs);
  }

  /** Sends the accumulated changes to all other instances. */
  flush(): void {
    if (this.state === undefined || this.version === this.sentVersion) return;
    let message: SyncMessage = { t: 'patch', b: this.sentVersion, v: this.version, p: this.pending };
    if (this.needFullState || jsonByteSize(message) > LIMITS.messageBytes - 1024) {
      message = { t: 'state', v: this.version, s: this.state };
      if (jsonByteSize(message) > LIMITS.messageBytes - 1024) {
        this.reportError('STATE_TOO_LARGE', `The game state is larger than ${LIMITS.messageBytes} bytes; keep it small (store IDs, not whole items).`);
        return;
      }
    }
    this.pending = [];
    this.needFullState = false;
    this.sentVersion = this.version;
    this.send('all', message);
  }

  private scheduleSnapshot(): void {
    if (!this.isAuthority || this.snapshotHandle !== undefined || this.state === undefined) return;
    this.snapshotHandle = setTimeout(() => {
      this.snapshotHandle = undefined;
      this.host.saveSnapshot(this.snapshot()).catch((e) => this.warn('saveSnapshot', e));
    }, this.options.snapshotMs);
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
    };
  }

  private restore(snapshot: GameSnapshot): void {
    this.state = snapshot.state as S;
    this.version = snapshot.version;
    this.rng.state = snapshot.rng;
    this.timerSeq = snapshot.timerSeq;
    this.knownPlayers = new Set(snapshot.players);
    this.ended = snapshot.ended;
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
