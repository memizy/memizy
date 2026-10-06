/**
 * In-memory host for tests: connects several GameRuntime instances and routes
 * messages between them like a real host (SPEC section 6).
 */

import type { HostApi, InitPayload, Player, AnswerRecord, SessionResult } from '@memizy/protocol';
import { BOARD_ADDRESS, ProtocolError, assertJsonWithin, LIMITS, prepareDisplaySet } from '@memizy/protocol';
import type { OQSEAnyItem } from '@memizy/oqse';
import { GameRuntime } from '../game/runtime';
import type { GameDefinition } from '../types';

export interface FakeSessionOptions {
  mode?: 'solo' | 'multiplayer';
  hostAs?: 'presenter' | 'player' | null;
  players?: string[];
  items?: OQSEAnyItem[];
  settings?: Record<string, unknown>;
  /** Shuffle the display order with this seed (default: keep the order, so tests can answer by index). */
  seed?: string;
}

export const sampleItems: OQSEAnyItem[] = [
  { id: 'q1', type: 'mcq-single', question: 'A?', options: ['a', 'b', 'c'], correctIndex: 1 },
  { id: 'q2', type: 'true-false', question: 'B?', correctAnswer: true },
  { id: 'q3', type: 'mcq-single', question: 'C?', options: ['x', 'y'], correctIndex: 0 },
] as OQSEAnyItem[];

export class FakeSession<S> {
  readonly runtimes = new Map<string, GameRuntime<S>>();
  readonly records: AnswerRecord[] = [];
  readonly results: SessionResult[] = [];
  readonly errors: string[] = [];
  readonly sent: { from: string; to: unknown; data: any }[] = [];
  snapshot: unknown = null;
  players: Player[];
  authority: string;
  disconnected = new Set<string>();
  private readonly def: GameDefinition<S>;
  private readonly options: Required<Omit<FakeSessionOptions, 'seed'>> & { seed?: string };

  constructor(def: GameDefinition<S>, options: FakeSessionOptions = {}) {
    this.def = def;
    const mode = options.mode ?? 'multiplayer';
    this.options = {
      mode,
      hostAs: options.hostAs ?? (mode === 'solo' ? null : 'presenter'),
      players: options.players ?? (mode === 'solo' ? ['me'] : ['anna', 'ben']),
      items: options.items ?? sampleItems,
      settings: options.settings ?? {},
      seed: options.seed,
    };
    this.players = this.options.players.map((id, i) => ({ id, name: id, isHost: this.options.hostAs === 'player' && i === 0, connected: true }));
    this.authority = this.options.mode === 'solo' || this.options.hostAs === 'player' ? this.players[0].id : BOARD_ADDRESS;
    const addresses = this.options.hostAs === 'presenter' ? [BOARD_ADDRESS, ...this.options.players] : [...this.options.players];
    for (const address of addresses) this.open(address);
  }

  /** Creates (or recreates) the instance at `address`. */
  open(address: string, lateJoin = false): GameRuntime<S> {
    this.runtimes.get(address)?.dispose();
    const init: InitPayload = {
      protocol: '1.0',
      host: { name: 'fake', version: '0' },
      oqseVersion: '0.2',
      features: [],
      session: {
        id: 'session-1',
        mode: this.options.mode,
        hostAs: this.options.hostAs,
        view: this.options.mode === 'solo' ? 'solo' : address === BOARD_ADDRESS ? 'board' : 'controller',
        self: address,
        authority: this.authority,
        lateJoin,
      },
      players: this.players,
      // Like a real host (SPEC 4.4): answers only for the authority and in solo.
      set: (() => {
        const sets = prepareDisplaySet({ meta: { id: 'set', language: 'cs', title: 'Set', createdAt: '2026-01-01', updatedAt: '2026-01-01' }, items: this.options.items }, this.options.seed);
        return this.options.mode === 'multiplayer' && address !== this.authority ? sets.publicSet : sets.set;
      })(),
      settings: this.options.settings,
      config: { locale: 'cs', theme: 'light' },
      clock: { offsetMs: 0 },
      progress: {},
      data: { plugin: null, set: null },
      snapshot: address === this.authority ? this.snapshot : null,
    };
    const runtime = new GameRuntime<S>(this.def, this.hostFor(address), init, {
      onError: (code, message) => this.errors.push(`${code}: ${message}`),
    });
    this.runtimes.set(address, runtime);
    this.disconnected.delete(address);
    runtime.boot();
    return runtime;
  }

  get(address: string): GameRuntime<S> {
    return this.runtimes.get(address)!;
  }

  start(): void {
    this.get(this.authority).start();
  }

  setPlayers(players: Player[]): void {
    this.players = players;
    for (const runtime of this.runtimes.values()) runtime.updatePlayers(players);
  }

  private hostFor(address: string): HostApi {
    const deliver = (target: string, data: unknown) => {
      if (this.disconnected.has(target)) return;
      const runtime = this.runtimes.get(target);
      if (runtime) queueMicrotask(() => runtime.receive({ from: address, data, sentAt: Date.now() }));
    };
    return {
      hello: async () => { throw new Error('not used'); },
      ready: async () => {},
      // Arguments are cloned like postMessage does (catches drafts and other non-cloneable values).
      send: async (input) => {
        const message = structuredClone(input);
        assertJsonWithin(message.data, LIMITS.messageBytes, 'MESSAGE_TOO_LARGE', 'message');
        this.sent.push({ from: address, to: message.to, data: message.data });
        if (message.to === 'authority') {
          if (this.disconnected.has(this.authority)) throw new ProtocolError('AUTHORITY_UNAVAILABLE', 'authority offline');
          deliver(this.authority, message.data);
        } else {
          const targets = message.to === 'all' ? [...this.runtimes.keys()].filter((a) => a !== address) : message.to;
          for (const target of targets) deliver(target, message.data);
        }
      },
      saveSnapshot: async (snapshot) => { this.snapshot = structuredClone(snapshot); },
      recordAnswer: async (answer) => { this.records.push(structuredClone(answer)); },
      saveProgress: async () => {},
      saveData: async () => {},
      updateSettings: async () => {},
      getAsset: async () => new Blob(),
      end: async (result) => { this.results.push(structuredClone(result)); },
      resize: async () => {},
      reportError: async (error) => { this.errors.push(`${error.code}: ${error.message}`); },
      exit: async () => {},
    };
  }
}
