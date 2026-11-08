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
  PICK_ITEMS_FEATURE,
  REVEAL_ITEMS_FEATURE,
  toProtocolError,
  type HostApi,
  type IncomingMessage,
  type InitPayload,
  type Player,
} from '@memizy/protocol';
import {
  findNonJson,
  jsonByteSize,
} from '@memizy/protocol/internal';
import type { OQSEAnyItem } from '@memizy/oqse';
import type { GameContext, GameDefinition, RecordAnswerOptions } from '../types';
import { diffJson } from './diff';
import { SeededRandom } from './random';
import { shortTimeout } from './timers';

/**
 * Messages exchanged between SDK instances (inside protocol `send` / `deliver`).
 *
 * Compatibility (1.x): the devices of one game may run different 1.x versions of the SDK
 * (a cached CDN copy, a page loaded before a release). So a receiver ignores message types
 * and fields it does not know, and new parts of a message are optional fields: an older
 * SDK ignores them, a newer one keeps the old behaviour when they are missing.
 */
export type SyncMessage =
  /**
   * An action of a player; `i` numbers the actions of the sender (for `ui.pending`),
   * `ph` = the `phaseSeq` the player saw (late actions are dropped), `at` = the game time
   * of the tap (`ctx.actedAt`).
   */
  | { t: 'act'; n: string; p: unknown; i?: number; ph?: number; at?: number }
  | { t: 'sync' }
  /** `a`: the last action number the authority processed, per sender. */
  | { t: 'state'; v: number; s: unknown; a?: Record<string, number> }
  /**
   * Changes from version `b` to `v`, applied in order. `f` = the format of `p` (PATCH_FORMAT;
   * missing = 1): a receiver that does not know it asks for the full state instead.
   */
  | { t: 'patch'; b: number; v: number; p: Patches; f?: number; a?: Record<string, number> }
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

/**
 * Format of state patches: 1 = mutative 2 patches (`{ op: 'add' | 'remove' | 'replace',
 * path: (string | number)[], value? }`, applied in order). A different format (another
 * library, another encoding) gets a new number, so older SDKs ask for the full state.
 */
export const PATCH_FORMAT = 1;

/** Minimum time between two state broadcasts. */
const MIN_FLUSH_INTERVAL_MS = 40;

/**
 * Names starting with `$` are reserved for the SDK: actions and timer keys (SPEC 9). Here:
 * the internal timer action and key of the phase deadline.
 */
const PHASE_TIMEOUT = '$phaseTimeout';
const PHASE_TIMER = '$phase';
const reserved = (name: string) => name.startsWith('$');
/** Timers of the SDK itself (phase deadlines), next to the game's `ctx.after` / `ctx.cancel`. */
const SDK_TIMERS = Symbol('memizy.sdkTimers');
interface SdkTimers {
  after(ms: number, action: string, payload: unknown, key: string): void;
  cancel(key: string): void;
}

/** Pending actions are forgotten after this time (lost message, authority away). */
const PENDING_TIMEOUT_MS = 5000;

/** `ctx.actedAt` is at most this much older than the arrival (a player cannot claim an earlier tap). */
const MAX_TAP_DELAY_MS = 400;

/** Fields of the state that the SDK writes in games with phases (reserved). */
const PHASE_FIELDS = ['phase', 'phaseSeq', 'phaseEndsAt'] as const;

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
  /** Generator state (`number` in snapshots of the release candidates). */
  rng: number[] | number;
  timerSeq: number;
  timers: TimerEntry[];
  players: string[];
  ended: boolean;
  /** Revealed item ids: to everyone, and per player. */
  revealed?: { all: string[]; to: Record<string, string[]> };
  /** The `pluginVersion` that saved it (SDK 1.1; older snapshots have none). */
  pluginVersion?: string;
}

type Effect =
  | { type: 'after'; timer: TimerEntry }
  | { type: 'cancel'; key: string }
  | { type: 'record'; itemId: string; item?: OQSEAnyItem; isCorrect: boolean; options: RecordAnswerOptions; playerId: string | null }
  | { type: 'end'; result: { scores?: Record<string, number>; summary?: string } }
  | { type: 'reveal'; itemIds: string[]; to: string[] | null }
  | { type: 'hide'; itemIds: string[]; to: string[] | null }
  | { type: 'goto'; phase: string }
  | { type: 'pick'; playerId: string };

export interface RuntimeOptions {
  /** Batching interval for state updates (≤ ~20 per second). */
  flushMs?: number;
  /** Debounce for snapshots (≤ 2 per second). */
  snapshotMs?: number;
  /** Logger for problems in plugin code (default: console + host.reportError). */
  onError?: (code: string, message: string) => void;
  /** The manifest's `pluginVersion` (saved in snapshots, `migrate`'s `info.to`). */
  pluginVersion?: string;
}

/**
 * Copies a value passed to ctx inside an action. Values taken from the state
 * (`ctx.end({ scores: state.scores })`) are drafts that stop working when the
 * action ends, and cannot be sent to the host (postMessage cannot clone them).
 */
function detach<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** What a context needs from the running action: its draft (for `ctx.goto`) and its tap time. */
interface ContextScope<S> {
  draft?: () => S | undefined;
  /** Phases entered in this run (they restart when the handler returns a new state). */
  entered?: string[];
  actedAt?: number;
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
  private readonly options: Required<Omit<RuntimeOptions, 'onError' | 'pluginVersion'>>;
  private readonly pluginVersion: string | undefined;
  private readonly reportError: (code: string, message: string) => void;
  private itemsById: Map<string, OQSEAnyItem>;
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
  /** Cancels the scheduled flush (`shortTimeout`: not slowed down in a hidden tab). */
  private flushHandle: (() => void) | undefined;
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
  /** Players whose queue of picked items is being refilled by the host (`pickItems`). */
  private picksPending = new Set<string>();
  /** Personal sets (SPEC 3.4): every player their own set, checked on their device. */
  readonly personal: boolean;
  /** A player's device: refilling its queue now, and the state version it last refilled at. */
  private ownPicksPending = false;
  private ownPicksAt = -1;

  constructor(def: GameDefinition<S>, host: HostApi, init: InitPayload, options: RuntimeOptions = {}) {
    this.personal = init.session.sets === 'personal' && init.session.mode === 'multiplayer';
    this.def = def;
    this.host = host;
    this.init = init;
    this.isAuthority = init.session.authority === init.session.self;
    this.players = init.players;
    this.clockOffset = init.clock.offsetMs;
    this.pausedMs = init.clock.pausedMs ?? 0;
    this.pausedAt = init.clock.pausedAt ?? null;
    // The secret seed only the authority gets (SPEC 4.2); the session id is known to every device.
    this.rng = new SeededRandom(init.seed ?? init.session.id);
    this.itemsById = new Map(init.set.items.map((item) => [item.id, item]));
    this.options = { flushMs: options.flushMs ?? 16, snapshotMs: options.snapshotMs ?? 500 };
    this.pluginVersion = options.pluginVersion;
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
    for (const player of this.players) this.requestPicks(player.id); // the first questions are ready in time
  }

  // ==========================================================================
  // The next items of a player (`ctx.nextItem`, host `pickItems`)
  // ==========================================================================

  private get picksAhead(): number {
    const option = this.def.pickItems;
    const ahead = typeof option === 'object' && option ? Number(option.ahead ?? 2) : 2;
    return Math.min(10, Math.max(1, Number.isFinite(ahead) ? Math.round(ahead) : 2));
  }

  /** The host chooses by progress: the game asked for it and the host offers it. */
  private get picksFromHost(): boolean {
    return this.isAuthority && !this.personal && !!this.def.pickItems && this.init.features.includes(PICK_ITEMS_FEATURE) && typeof this.host.pickItems === 'function';
  }

  /**
   * Personal sets, on a player's device: keeps the player's queue at the authority filled with
   * their own next items (chosen here by their progress) – the authority has no items.
   */
  private refillOwnPicks(): void {
    if (!this.personal || this.isAuthority || this.ended || typeof this.host.pickItems !== 'function') return;
    const self = this.selfPlayerId();
    if (!self || this.state === undefined || !this.authorityConnected || this.paused) {
      // Not ready yet (this player not in the list, no state, the authority away or paused):
      // the authority may stay quiet, so no state change would bring us back – try again later.
      this.retryOwnPicks(1000);
      return;
    }
    if (this.ownPicksPending || this.version === this.ownPicksAt) return;
    const queue = ((this.state as { $picks?: Record<string, { q?: string[] }> }).$picks?.[self]?.q ?? []) as string[];
    const count = this.picksAhead - queue.length;
    if (count <= 0) return;
    this.ownPicksPending = true;
    this.ownPicksAt = this.version;
    this.host
      .pickItems({ playerId: self, count, exclude: [...queue] })
      .then((ids) => {
        this.ownPicksPending = false;
        const items = (Array.isArray(ids) ? ids : []).map((id) => this.itemsById.get(id)).filter((i): i is OQSEAnyItem => !!i).map((i) => ({ id: i.id, type: i.type }));
        if (items.length) this.dispatch('$picks', { items });
        this.retryOwnPicks(2000); // lost on the way (a reconnect, the authority away): send again
      })
      .catch((error) => {
        this.ownPicksPending = false;
        this.warn('pickItems', error);
        this.retryOwnPicks(1000);
      });
  }

  private ownPicksRetry: ReturnType<typeof setTimeout> | undefined;
  /** Tries the refill again later when the queue at the authority is still short. */
  private retryOwnPicks(ms: number): void {
    clearTimeout(this.ownPicksRetry);
    this.ownPicksRetry = setTimeout(() => {
      this.ownPicksAt = -1;
      this.refillOwnPicks();
    }, ms);
  }

  /**
   * The set changed (`setChanged`): new items, the earlier ones stay known (a question on the
   * screen keeps working). With personal sets the player's queue starts again from the new set.
   */
  replaceItems(items: OQSEAnyItem[], meta?: InitPayload['set']['meta']): void {
    for (const item of items) this.itemsById.set(item.id, item);
    (this.init.set as { items: OQSEAnyItem[] }).items = items;
    if (meta) (this.init.set as { meta: InitPayload['set']['meta'] }).meta = meta;
    if (this.personal && !this.isAuthority && this.selfPlayerId()) {
      this.ownPicksAt = -1;
      this.dispatch('$picks', { reset: true, items: [] });
    }
    this.onChange();
  }

  /** Personal sets, on the authority: a player's device sends its next items (IDs and types only). */
  private addOwnPicks(playerId: string, payload: unknown): void {
    const reset = (payload as { reset?: unknown } | null)?.reset === true;
    const list = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(list)) return;
    if (reset) {
      this.run(
        (draft) => {
          const picks = ((draft as Record<string, unknown>).$picks ??= {}) as Record<string, { q: string[]; r: string[]; t?: Record<string, string> }>;
          picks[playerId] = { q: [], r: [], t: {} };
        },
        null,
        true,
        '$picks',
      );
    }
    const items = list
      .slice(0, 20)
      .filter((i): i is { id: string; type: string } => !!i && typeof i.id === 'string' && i.id.length <= 128 && typeof i.type === 'string' && i.type.length <= 64);
    if (!items.length) return;
    this.run(
      (draft) => {
        const picks = ((draft as Record<string, unknown>).$picks ??= {}) as Record<string, { q: string[]; r: string[]; t?: Record<string, string> }>;
        const entry = (picks[playerId] ??= { q: [], r: [] });
        entry.t ??= {};
        for (const item of items) {
          if (entry.q.includes(item.id) || entry.q.length >= 20) continue;
          entry.q.push(item.id);
          entry.t[item.id] = item.type;
        }
      },
      null,
      true,
      '$picks',
    );
  }

  /** Asks the host for more items of a player when their queue is short; the answer arrives as a system change. */
  private requestPicks(playerId: string): void {
    if (!this.picksFromHost || this.picksPending.has(playerId) || this.ended) return;
    const queue = ((this.state as { $picks?: Record<string, { q?: string[] }> } | undefined)?.$picks?.[playerId]?.q ?? []) as string[];
    const count = this.picksAhead - queue.length;
    if (count <= 0) return;
    const option = this.def.pickItems;
    const weights = typeof option === 'object' && option?.weights;
    this.picksPending.add(playerId);
    this.host
      .pickItems!({ playerId, count, exclude: [...queue], ...(weights && { weights: [...weights] }) })
      .then((ids) => {
        this.picksPending.delete(playerId);
        const fresh = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && this.itemsById.has(id));
        if (!fresh.length) return;
        this.run(
          (draft) => {
            const picks = ((draft as Record<string, unknown>).$picks ??= {}) as Record<string, { q: string[]; r: string[] }>;
            const entry = (picks[playerId] ??= { q: [], r: [] });
            for (const id of fresh) if (!entry.q.includes(id)) entry.q.push(id);
          },
          null,
          true,
          '$picks',
        );
      })
      .catch((error) => {
        this.picksPending.delete(playerId);
        this.warn('pickItems', error);
      });
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
    for (const received of items) {
      if (!received || typeof received.id !== 'string' || !this.itemsById.has(received.id)) continue;
      if (!this.publicCopies.has(received.id)) this.publicCopies.set(received.id, this.itemsById.get(received.id)!);
      const missing: string[] = [];
      const item = withOwnMedia(received, this.publicCopies.get(received.id)!, missing);
      this.itemsById.set(item.id, item);
      const index = list.findIndex((i) => i.id === item.id);
      if (index !== -1) list[index] = item;
      if (missing.length && this.revealsToHost) this.fetchRevealedMedia(item, missing, received);
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


  /** Whether the host takes `revealItems` (protocol 1.1, feature `reveal-items`). */
  private get revealsToHost(): boolean {
    return this.init.features.includes(REVEAL_ITEMS_FEATURE) && typeof this.host.revealItems === 'function';
  }

  /** Authority: tells the host which items were revealed to whom (SPEC 4.4, `revealItems`). */
  private grantReveal(itemIds: string[], to: string[] | null): void {
    if (!this.revealsToHost || !itemIds.length || (to !== null && !to.length)) return;
    for (let i = 0; i < itemIds.length; i += 200) {
      this.host.revealItems!({ itemIds: itemIds.slice(i, i + 200), to }).catch((e) => this.warn('revealItems', e));
    }
  }

  /**
   * Followers: media of a revealed item that only its hidden fields use (the back of a card, a
   * picture in the explanation) – fetched from the host once the authority revealed it.
   */
  private fetchRevealedMedia(item: OQSEAnyItem, keys: string[], received: OQSEAnyItem): void {
    for (const key of keys) {
      const media = received.assets?.[key];
      if (!media) continue;
      const load = (retry: boolean): void => {
        this.host
          .getAsset(key, item.id)
          .then((blob) => {
            if (this.itemsById.get(item.id) !== item) return; // hidden again meanwhile
            (item.assets ??= {})[key] = { ...media, value: URL.createObjectURL(blob) };
            this.onChange();
          })
          .catch((e) => {
            if (retry) setTimeout(() => load(false), 1000); // the host may not have the reveal yet
            else this.warn(`getAsset "${key}"`, e);
          });
      };
      load(true);
    }
  }

  /** Stops timers and pending work (instance closing). */
  dispose(): void {
    clearTimeout(this.ownPicksRetry);
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.flushHandle?.();
    this.flushHandle = undefined;
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

  /**
   * `ui.act` – run locally on the authority, otherwise send to it. `seenPhaseSeq` = the
   * `phaseSeq` of the screen the player acted on (an action from an older phase is dropped).
   */
  dispatch(name: string, payload: unknown, seenPhaseSeq?: number): void {
    if (this.ended || typeof name !== 'string' || this.paused) return; // nothing happens while paused
    if (this.isAuthority) {
      if (this.isLate(seenPhaseSeq)) return; // e.g. a double click on "next"
      this.runAction(name, payload, this.selfPlayerId(), true); // the authority is the board, the host or the solo player
    } else if (this.authorityConnected) {
      const id = ++this.actionSeq;
      this.pendingActions.push({ id, name, payload: payload ?? null, sentAt: Date.now() });
      const ph = typeof seenPhaseSeq === 'number' ? { ph: seenPhaseSeq } : {};
      this.sendToAuthority({ t: 'act', n: name, p: payload ?? null, i: id, ...ph, at: this.now() });
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
        // While paused, and from the screen of an older phase, actions are ignored (still
        // confirmed, so ui.pending clears).
        if (hasPrototypeKey(data.p)) {
          // `{"__proto__": …}` from another device: a game that merges payloads into its state
          // (Object.assign) would change the prototype. Never valid game data.
          this.reportError('INVALID_PAYLOAD', `Action "${data.n}" from ${message.from} was ignored: its payload has a "__proto__" key.`);
        } else if (!this.paused && !this.isLate(data.ph)) {
          this.runAction(data.n, data.p, player ? player.id : null, message.from === BOARD_ADDRESS || player?.isHost === true, false, this.tapTime(data.at));
        }
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
      this.refillOwnPicks();
    } else if (data.t === 'patch') {
      this.confirmActions(data.a);
      if (this.state === undefined || data.b !== this.version || (data.f ?? 1) !== PATCH_FORMAT) {
        this.sendToAuthority({ t: 'sync' }); // missed an update, or patches in a format this SDK does not know
        return;
      }
      try {
        this.state = apply(this.state as object, data.p) as S;
        this.version = data.v;
        this.onChange();
        this.refillOwnPicks();
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
          this.requestPicks(player.id);
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
    this.refillOwnPicks();
  }

  /** `PluginApi.finishRequested`: the game's `onFinish` on the authority (also while paused). */
  finish(): void {
    if (!this.isAuthority || this.state === undefined || this.ended || !this.def.onFinish) return;
    this.run((draft, ctx) => this.def.onFinish!(draft, ctx), null, true, 'onFinish');
    if (!this.ended) this.reportError('FINISH_WITHOUT_END', 'onFinish did not call ctx.end(result): the host closes the game without a result.');
  }

  /** `PluginApi.authorityChanged`. */
  setAuthorityConnected(connected: boolean): void {
    this.authorityConnected = connected;
    if (connected) this.sendToAuthority({ t: 'sync' });
    this.onChange();
    if (connected) this.refillOwnPicks();
  }

  private selfPlayerId(): string | null {
    const self = this.init.session.self;
    return this.players.some((p) => p.id === self) ? self : null;
  }

  /** Whether an action comes from the screen of an older phase (games with phases). */
  private isLate(seenPhaseSeq: unknown): boolean {
    if (!this.def.phases || typeof seenPhaseSeq !== 'number' || this.state === undefined) return false;
    const current = (this.state as { phaseSeq?: unknown }).phaseSeq;
    return typeof current === 'number' && current !== seenPhaseSeq;
  }

  /** `ctx.actedAt` of a received action: its tap time, at most MAX_TAP_DELAY_MS before now. */
  private tapTime(at: unknown): number {
    const now = this.now();
    if (typeof at !== 'number' || !Number.isFinite(at)) return now;
    return Math.min(now, Math.max(now - MAX_TAP_DELAY_MS, at));
  }

  private runAction(name: string, payload: unknown, playerId: string | null, fromHost: boolean, fromTimer = false, actedAt?: number): void {
    if (name === '$picks') {
      if (this.personal && playerId) this.addOwnPicks(playerId, payload);
      return;
    }
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
    this.run((draft, ctx) => handler(draft, payload, ctx), playerId, fromHost, name, actedAt);
  }

  /** Runs a state change on the authority with a mutable draft. */
  private run(recipe: (draft: S, ctx: GameContext) => void | S, playerId: string | null, fromHost: boolean, label: string, actedAt?: number): void {
    if (this.state === undefined) return;
    const effects: Effect[] = [];
    let draftRef: unknown;
    let usedDraft: unknown;
    const entered: string[] = [];
    const ctx = this.context(playerId, fromHost, effects, { draft: () => draftRef as S | undefined, entered, actedAt });
    let returned: unknown;
    let next: S;
    let patches: Patches;
    try {
      [next, patches] = create(
        this.state as object,
        (draft) => {
          draftRef = usedDraft = draft;
          returned = recipe(draft as S, ctx);
        },
        { enablePatches: true },
      ) as unknown as [S, Patches];
    } catch (e) {
      this.reportError('ACTION_FAILED', `${label} threw: ${errorText(e)}`);
      return;
    } finally {
      draftRef = undefined; // the action has ended (like other ctx calls, a later ctx.goto does nothing)
    }

    if (returned !== undefined && returned !== usedDraft) {
      // The handler returned a new state instead of mutating the draft.
      const problem = returned !== null && typeof returned === 'object' ? findNonJson(returned, 'state') : 'state must be an object';
      if (problem) {
        this.reportError('INVALID_STATE', `${label} returned an invalid state: ${problem}`);
        return;
      }
      if (entered.length) {
        // The phase it entered stays (its fields), but what onEnter changed on the draft is lost.
        for (const key of PHASE_FIELDS) (returned as Record<string, unknown>)[key] = (next as Record<string, unknown>)[key];
        this.reportError('PHASE_WITH_NEW_STATE', `${label} called ctx.goto and returned a new state: change the state (draft) instead of returning one, or onEnter changes are lost.`);
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

  private context(playerId: string | null, fromHost: boolean, effects: Effect[], scope: ContextScope<S> = {}): GameContext {
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
      actedAt: scope.actedAt ?? now,
      random: () => rng.next(),
      shuffle: (array) => rng.shuffle(array),
      after: (ms, action, payload, options) => {
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw new Error('ctx.after: ms must be a non-negative number');
        if (typeof action !== 'string') throw new Error('ctx.after: action must be the name of an action');
        if (reserved(action) || (typeof options?.key === 'string' && reserved(options.key))) {
          throw new Error('ctx.after: names starting with $ are reserved for the SDK');
        }
        timerSeq += 1;
        const key = options?.key ?? `#${timerSeq}`;
        effects.push({ type: 'after', timer: { key, at: now + ms, action, payload: detach(payload ?? null) } });
        this.timerSeq = timerSeq;
      },
      cancel: (key) => {
        if (typeof key === 'string' && reserved(key)) throw new Error('ctx.cancel: keys starting with $ are reserved for the SDK');
        effects.push({ type: 'cancel', key });
      },
      personal: this.personal,
      recordAnswer: (itemOrId, isCorrect, options = {}) => {
        const given = typeof itemOrId === 'string' ? null : (detach(itemOrId) as OQSEAnyItem);
        const itemId = typeof itemOrId === 'string' ? itemOrId : given?.id;
        if (typeof itemId !== 'string') throw new Error('ctx.recordAnswer: pass an item id or an item');
        // Personal sets: the player's device recorded the answer to its own item already.
        if (this.personal && !this.itemsById.has(itemId)) return;
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
        const draft = scope.draft?.();
        // In initialState (no state yet) the phase starts right after it returns.
        if (draft === undefined) effects.push({ type: 'goto', phase });
        else this.startPhase(draft, phase, effects, scope);
      },
      nextItem: (forPlayer, options = {}) => {
        const pid = forPlayer ?? playerId;
        if (typeof pid !== 'string') throw new Error('ctx.nextItem: pass a player id (this action has no player)');
        const types = Array.isArray(options.types) && options.types.length ? options.types : null;
        const fits = (item: OQSEAnyItem | undefined): item is OQSEAnyItem => !!item && (!types || types.includes(item.type));
        const draft = scope.draft?.() as Record<string, unknown> | undefined;
        const picks = draft && typeof draft === 'object' ? ((draft.$picks ??= {}) as Record<string, { q: string[]; r: string[] }>) : null;
        const entry = picks ? (picks[pid] ??= { q: [], r: [] }) : { q: [] as string[], r: [] as string[] };
        let chosen: OQSEAnyItem | undefined;
        // Personal sets: the queue holds the player's own items, which the authority does not have.
        const known = (id: string) => this.itemsById.get(id) ?? (this.personal ? ({ id, type: (entry as { t?: Record<string, string> }).t?.[id] ?? 'unknown' } as OQSEAnyItem) : undefined);
        const at = entry.q.findIndex((id) => fits(known(id)));
        if (at >= 0) chosen = known(entry.q.splice(at, 1)[0]);
        if (!chosen && this.personal) return null; // the player's device sends more soon
        if (!chosen) {
          // Not chosen by the host (no feature, or the queue is empty): random, not one of the last given.
          const all = items.filter(fits);
          const rested = all.filter((item) => !entry.r.includes(item.id));
          const from = rested.length ? rested : all;
          chosen = from.length ? from[Math.floor(rng.next() * from.length)] : undefined;
        }
        if (!chosen) return null;
        entry.r = [...entry.r.filter((id) => id !== chosen!.id), chosen.id].slice(-3);
        effects.push({ type: 'pick', playerId: pid });
        return this.itemsById.get(chosen.id) ?? chosen;
      },
      hide: (itemIds, options = {}) => {
        const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).filter((id) => typeof id === 'string' && this.itemsById.has(id));
        const to = options.to === undefined ? null : (Array.isArray(options.to) ? options.to : [options.to]).filter((id) => typeof id === 'string');
        if (ids.length) effects.push({ type: 'hide', itemIds: ids, to });
      },
    };
    const sdkTimers: SdkTimers = {
      after: (ms, action, payload, key) => effects.push({ type: 'after', timer: { key, at: now + ms, action, payload: detach(payload ?? null) } }),
      cancel: (key) => effects.push({ type: 'cancel', key }),
    };
    Object.defineProperty(ctx, SDK_TIMERS, { value: sdkTimers });
    return ctx;
  }

  /**
   * `ctx.goto` inside an action or hook: the phase starts now, on the same draft (the rest
   * of the action already sees `state.phase`); `onEnter` runs right away as the system.
   */
  private startPhase(draft: S, name: string, effects: Effect[], scope: ContextScope<S>): void {
    const def = this.def.phases![name];
    if (this.phaseDepth > 20) {
      this.reportError('PHASE_LOOP', `ctx.goto("${name}") keeps entering phases from onEnter; stopped.`);
      return;
    }
    this.phaseDepth += 1;
    try {
      const system = this.context(null, true, effects, { ...scope, actedAt: undefined });
      this.setPhaseFields(draft, name, def, system);
      scope.entered?.push(name);
      def.onEnter?.(draft, system);
    } finally {
      this.phaseDepth -= 1;
    }
  }

  /** Sets `phase`, `phaseSeq`, `phaseEndsAt` and the phase timer. */
  private setPhaseFields(draft: S, name: string, def: NonNullable<GameDefinition<S>['phases']>[string], ctx: GameContext): void {
    const state = draft as Record<string, unknown>;
    const timers = (ctx as GameContext & { [SDK_TIMERS]: SdkTimers })[SDK_TIMERS];
    state.phase = name;
    state.phaseSeq = (typeof state.phaseSeq === 'number' ? state.phaseSeq : 0) + 1;
    const seconds = typeof def.seconds === 'function' ? def.seconds(draft, ctx) : def.seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      state.phaseEndsAt = ctx.now + seconds * 1000;
      timers.after(seconds * 1000, PHASE_TIMEOUT, { seq: state.phaseSeq }, PHASE_TIMER);
    } else {
      state.phaseEndsAt = null;
      timers.cancel(PHASE_TIMER);
    }
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
          // A flashcard's answer is the self-rating 1–4 (OQSE): it is also the confidence.
          const rating = rest.answer;
          if (rest.confidence === undefined && this.itemsById.get(effect.itemId)?.type === 'flashcard' && (rating === 1 || rating === 2 || rating === 3 || rating === 4)) {
            rest.confidence = rating;
          }
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
        case 'pick':
          this.requestPicks(effect.playerId);
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
    this.flushHandle = shortTimeout(() => {
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
    let message: SyncMessage = { t: 'patch', b: this.sentVersion, v: this.version, p: this.pending, f: PATCH_FORMAT, ...acks };
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
      // Every device needs the phase fields (ui.phase, ui.timeLeft(), late actions).
      if (this.def.phases) for (const key of PHASE_FIELDS) if (key in (this.state as object)) (view as Record<string, unknown>)[key] = (this.state as Record<string, unknown>)[key];
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
        message = { t: 'patch', b: sent.version, v: this.version, p: patches, f: PATCH_FORMAT, ...a };
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
    // First the host (those devices may then fetch the media of hidden fields), then the items.
    this.grantReveal(itemIds, to);
    if (to === null) {
      for (const id of itemIds) this.revealedAll.add(id);
      this.send('all', { t: 'reveal', items });
      this.scheduleSnapshot();
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
          this.setPhaseFields(draft, name, def, ctx);
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
    // Nothing to take back for items that were not revealed (no message).
    const revealedTo = (id: string, playerId: string) => this.revealedAll.has(id) || !!this.revealedTo.get(playerId)?.has(id);
    itemIds = itemIds.filter((id) => (to === null ? this.revealedAll.has(id) || [...this.revealedTo.values()].some((set) => set.has(id)) : to.some((p) => revealedTo(id, p))));
    if (!itemIds.length) return;
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
      rng: [...this.rng.state],
      timerSeq: this.timerSeq,
      timers: [...this.timers.values()].map(({ key, at, action, payload }) => ({ key, at, action, payload })),
      players: [...this.knownPlayers],
      ended: this.ended,
      revealed: { all: [...this.revealedAll], to: Object.fromEntries([...this.revealedTo].map(([p, ids]) => [p, [...ids]])) },
      ...(this.pluginVersion !== undefined && { pluginVersion: this.pluginVersion }),
    };
  }

  /**
   * A saved state through the game's `migrate` (SDK 1.1): a copy is changed or replaced. When
   * it throws or gives an invalid state, the saved state stays and the host hears
   * `MIGRATE_FAILED` (it continues in the saved version of the game, SPEC 3.3).
   */
  private migrateState(state: unknown, from: string | null): { state: unknown; changed: boolean } {
    if (typeof this.def.migrate !== 'function') return { state, changed: false };
    let next: unknown;
    try {
      const copy = structuredClone(state);
      const returned = this.def.migrate(copy, { from, to: this.pluginVersion ?? '0.0.0' });
      next = returned === undefined ? copy : returned;
    } catch (e) {
      this.reportError('MIGRATE_FAILED', `migrate threw (saved by ${from ?? 'an older version'}): ${errorText(e)}`);
      return { state, changed: false };
    }
    const problem = next !== null && typeof next === 'object' ? findNonJson(next, 'state') : 'state must be an object';
    if (problem) {
      this.reportError('MIGRATE_FAILED', `migrate gave an invalid state: ${problem}`);
      return { state, changed: false };
    }
    return { state: next, changed: true };
  }

  private restore(snapshot: GameSnapshot): void {
    const migrated = this.migrateState(snapshot.state, snapshot.pluginVersion ?? null);
    this.state = migrated.state as S;
    this.version = snapshot.version;
    this.rng.restore(snapshot.rng);
    this.timerSeq = snapshot.timerSeq;
    this.knownPlayers = new Set(snapshot.players);
    this.ended = snapshot.ended;
    this.revealedAll = new Set(snapshot.revealed?.all ?? []);
    this.revealedTo = new Map(Object.entries(snapshot.revealed?.to ?? {}).map(([p, ids]) => [p, new Set(ids)]));
    if (!this.ended) for (const timer of snapshot.timers) this.setTimer(timer);
    // A continued game has a new host: tell it again what was revealed (media of hidden fields).
    this.grantReveal([...this.revealedAll], null);
    for (const [playerId, ids] of this.revealedTo) this.grantReveal([...ids], [playerId]);
    this.needFullState = true;
    this.scheduleFlush();
    this.onChange();
    // Players who left or joined while the authority was away.
    this.updatePlayers(this.players);
    if (migrated.changed && snapshot.pluginVersion !== this.pluginVersion) this.scheduleSnapshot(); // saved by this version now
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

/** Whether JSON data contains a `__proto__` key at any depth. */
function hasPrototypeKey(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== 'object' || depth > 64) return false;
  if (Array.isArray(value)) return value.some((entry) => hasPrototypeKey(entry, depth + 1));
  return Object.keys(value).some((key) => key === '__proto__' || hasPrototypeKey((value as Record<string, unknown>)[key], depth + 1));
}

/**
 * A revealed item's media as this device can show them. Media from a set package reach a game
 * as object URLs of its own document, so the authority's URLs do not work here: the public
 * media keep this device's copies; media only hidden fields use (an explanation, the back of a
 * card) were never given to this device and are left out.
 */
function withOwnMedia(item: OQSEAnyItem, own: OQSEAnyItem, missing: string[] = []): OQSEAnyItem {
  if (!item.assets) return item;
  const assets: NonNullable<OQSEAnyItem['assets']> = {};
  for (const [key, media] of Object.entries(item.assets)) {
    const mine = own.assets?.[key];
    if (mine) assets[key] = mine;
    // A web address works here too; the authority's own blob: URLs and package keys do not.
    else if (media && typeof media.value === 'string' && /^(https?:|data:)/i.test(media.value)) assets[key] = media;
    else if (media) missing.push(key);
  }
  return { ...item, assets } as OQSEAnyItem;
}
