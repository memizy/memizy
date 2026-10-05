/**
 * Public types of `defineGame` (the API described in docs/ai-plugin-guide.md).
 */

import type { NoteItem, OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import type { DataScope, HostAs, Player, PluginView, SessionMode } from '@memizy/protocol';

export type { Player, PluginView, SessionMode, HostAs, DataScope };

/** Context shared by `initialState`, actions and player hooks (runs on the authority). */
export interface GameContext {
  /** Who sent the action (`null` for timers, `initialState`, system hooks and the board). */
  readonly playerId: string | null;
  /**
   * `true` when the action comes from the host (the board, or the host playing along)
   * or from the game itself (timers, `initialState`, player hooks); `false` for
   * actions sent by other players. Use it to protect teacher-only controls.
   */
  readonly fromHost: boolean;
  /** Current players (the presenter is not a player). */
  readonly players: readonly Player[];
  readonly items: readonly OQSEAnyItem[];
  item(id: string): OQSEAnyItem | undefined;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly mode: SessionMode;
  readonly hostAs: HostAs | null;
  /** Current time in ms (same clock on all devices). */
  readonly now: number;
  /** Deterministic random number in [0, 1). */
  random(): number;
  /** Deterministically shuffled copy of an array. */
  shuffle<T>(array: readonly T[]): T[];
  /** Run `action` after `ms` milliseconds. A timer with the same `key` replaces the previous one. */
  after(ms: number, action: string, payload?: unknown, options?: { key?: string }): void;
  /** Cancel a timer by its key. */
  cancel(key: string): void;
  /** Save a learning result (default player: `ctx.playerId`). */
  recordAnswer(itemId: string, isCorrect: boolean, options?: RecordAnswerOptions): void;
  /** End the game. */
  end(result?: { scores?: Record<string, number>; summary?: string }): void;
}

export interface RecordAnswerOptions {
  playerId?: string;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
}

export type ActionHandler<S> = (state: S, payload: any, ctx: GameContext) => void | S;

export interface SavedData {
  plugin: any;
  set: any;
}

/** What `render` (and the other render functions) receive. */
export interface GameUI {
  readonly view: PluginView;
  readonly mode: SessionMode;
  readonly hostAs: HostAs | null;
  /** This player (`null` on the board and in the settings view). */
  readonly self: Player | null;
  readonly players: readonly Player[];
  readonly items: readonly OQSEAnyItem[];
  item(id: string): OQSEAnyItem | undefined;
  readonly settings: Readonly<Record<string, unknown>>;
  /** `true` on the instance that runs the game rules. */
  readonly isAuthority: boolean;
  readonly locale: string;
  readonly theme: 'light' | 'dark';
  /** Learning progress of this player. */
  readonly progress: Readonly<Record<string, ProgressRecord>>;
  /** Data saved between games for this player. */
  readonly saved: SavedData;
  /** Per-screen scratch object (not shared, not saved). */
  readonly local: Record<string, any>;
  /** Call an action (normally use `data-act`). */
  act(name: string, payload?: unknown): void;
  /** Milliseconds until `deadline` on the session clock (≥ 0). */
  timeLeft(deadline: number): number;
  /** Current session clock in ms. */
  now(): number;
  /** Safe HTML for Rich Content from the study set. */
  text(markdown: string | undefined | null, options?: { inline?: boolean }): string;
  /** Safe HTML of a whole note item. */
  renderNote(note: NoteItem, options?: { titleLevel?: number }): string;
  /** Escape plain text for HTML. */
  escape(text: unknown): string;
  /** Save data between games (`'plugin'`: across sets, `'set'`: this set). */
  save(scope: DataScope, value: unknown): void;
  /** Set this player's learning progress directly (bucket 0–4). */
  setProgress(itemId: string, progress: { bucket: 0 | 1 | 2 | 3 | 4; nextReviewAt?: string }): void;
}

export type RenderResult = string | void | undefined | null;

export interface GameDefinition<S = any> {
  /** Where to render. Default: `document.body`. */
  root?: HTMLElement;
  /** Re-render every `tickMs` milliseconds (countdowns). */
  tickMs?: number;
  initialState(ctx: GameContext): S;
  actions: Record<string, ActionHandler<S>>;
  playerJoined?(state: S, player: Player, ctx: GameContext): void | S;
  playerLeft?(state: S, player: Player, ctx: GameContext): void | S;
  render(state: S, ui: GameUI): RenderResult;
  /**
   * Called after every render with the same state: update a canvas, a 3D scene or
   * play effects (things that are not HTML). Do not change the state here; react
   * to input with `ui.act` (or `handle.act`). Put the canvas into an element with
   * `data-keep` (or outside `root`) so rendering does not replace it.
   */
  update?(state: S, ui: GameUI): void;
  renderWaiting?(ui: GameUI): RenderResult;
  renderSettings?(settings: Record<string, unknown>, ui: GameUI): RenderResult;
  validateSettings?(settings: Record<string, unknown>): string | void | null | undefined;
}
