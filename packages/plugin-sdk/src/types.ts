/**
 * Public types of `defineGame` (the API described in docs/ai-plugin-guide.md).
 */

import type { NoteItem, OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import type { DataScope, HostAs, Player, PluginView, SessionMode } from '@memizy/protocol';
import type { SafeHtml } from './render/html';

export type { SafeHtml };

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
  /** The items with their answers, in the session's display order (SPEC 4.4). */
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
  /**
   * Move to another phase (games with `phases`). Takes effect right after this action:
   * `state.phase`, `state.phaseEndsAt` and the phase timer are set, then `onEnter` runs.
   */
  goto(phase: string): void;
  /** Take back `reveal` (e.g. before the same item is asked again): the devices get the item without answers. */
  hide(itemIds: string | string[], options?: { to?: string | string[] }): void;
  /**
   * Save a learning result (default player: `ctx.playerId`). Pass the item itself instead of
   * its id for a generated item (e.g. from a service): it is attached automatically.
   * `options.answer` = what the player answered (shown to teachers).
   */
  recordAnswer(item: string | OQSEAnyItem, isCorrect: boolean, options?: RecordAnswerOptions): void;
  /** End the game. */
  end(result?: { scores?: Record<string, number>; summary?: string }): void;
  /**
   * Show the answer of items (correct option, explanation, back of a flashcard…).
   * In multiplayer the other devices get items without answers until they are
   * revealed to everyone, or only to some players with `{ to }`. No effect in solo.
   */
  reveal(itemIds: string | string[], options?: { to?: string | string[] }): void;
}

export interface RecordAnswerOptions {
  playerId?: string;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
  /** What the player answered (the `checkAnswer` format). */
  answer?: unknown;
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
  /**
   * The items in display order. On the authority (and in solo) with answers; on the
   * other devices in multiplayer without them (`answerHidden: true`) until `ctx.reveal`.
   */
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
  /** Per-screen scratch object (not shared, not saved). Changing it directly does not re-render. */
  readonly local: Record<string, any>;
  /**
   * Changes `ui.local` and re-renders: device-only UI state (a selected tab, a 2D/3D
   * switch, an animation flag) without a global variable. `ui.setLocal({ tab: 'map' })`
   * or `ui.setLocal((local) => { local.count += 1; })`.
   */
  setLocal(update: Record<string, unknown> | ((local: Record<string, any>) => void)): void;
  /** Call an action (normally use `data-act`). */
  act(name: string, payload?: unknown): void;
  /**
   * Actions of this device the authority has not processed yet (multiplayer
   * controllers; always empty on the authority). Use it to show "sent" right away.
   */
  readonly pending: readonly { name: string; payload: unknown; sentAt: number }[];
  /** `true` while an action (of this name, or any) of this device waits for the authority. */
  isPending(name?: string): boolean;
  /** Milliseconds until `deadline` (≥ 0); without an argument until the end of the current phase. */
  timeLeft(deadline?: number): number;
  /** The current phase (games with `phases`), else `null`. */
  readonly phase: string | null;
  /** Current session clock in ms. */
  now(): number;
  /**
   * Whether the host has paused the game (RC4). The SDK covers the game with a "paused"
   * curtain, stops `ui.now()` / timers and ignores actions; show it in the game if you like.
   */
  readonly paused: boolean;
  /**
   * RC4: calls a Memizy service the plugin declares in its manifest `services` and the
   * host offers (`ui.services`), e.g. `await ui.service('chess.puzzles', { level: 3 })`.
   * Rejects with SERVICE_UNAVAILABLE otherwise. Call it from event handlers or
   * `afterRender`, then put the result into the game with an action.
   */
  service(name: string, payload?: unknown): Promise<unknown>;
  /** Services available here (declared by the plugin and offered by the host). */
  readonly services: readonly string[];
  /**
   * HTML template that escapes every value except safe HTML (`ui.html`, `ui.text`,
   * `ui.renderNote`, `ui.question`, `ui.raw`); arrays are joined, `null` / `false` are
   * left out. Use it for every `render`:
   * ``ui.html`<button data-act="answer" data-payload='${JSON.stringify({ answer: o.id })}'>${ui.text(o.text, { inline: true })}</button>` ``
   */
  html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml;
  /** Marks HTML you wrote yourself as safe (never use it for text from players or sets). */
  raw(html: unknown): SafeHtml;
  /** Safe HTML for Rich Content from the study set. */
  text(markdown: string | undefined | null, options?: { inline?: boolean; item?: OQSEAnyItem }): SafeHtml;
  /** Safe HTML of a whole note item. */
  renderNote(note: NoteItem, options?: { titleLevel?: number }): SafeHtml;
  /** Escape plain text for HTML (not needed inside `ui.html`). */
  escape(text: unknown): string;
  /** Save data between games (`'plugin'`: across sets, `'set'`: this set). */
  save(scope: DataScope, value: unknown): void;
  /** Set this player's learning progress directly (bucket 0–4). */
  setProgress(itemId: string, progress: { bucket: 0 | 1 | 2 | 3 | 4; nextReviewAt?: string }): void;
}

export type RenderResult = string | SafeHtml | void | undefined | null;

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
   * Called after every render with the same state (not every animation frame):
   * update a canvas, a 3D scene or play effects (things that are not HTML).
   * Never change the state here (game rules belong to `actions`); react to input
   * with `ui.act` (or `handle.act`). Put the canvas into an element with
   * `data-keep` (or outside `root`) so rendering does not replace it.
   */
  afterRender?(state: S, ui: GameUI): void;
  renderWaiting?(ui: GameUI): RenderResult;
  renderSettings?(settings: Record<string, unknown>, ui: GameUI): RenderResult;
  validateSettings?(settings: Record<string, unknown>): string | void | null | undefined;
  /**
   * Optional phases of the game (a clear life cycle): enter one with `ctx.goto(name)`.
   * The SDK keeps `state.phase`, `state.phaseEndsAt` (deadline or null) and
   * `state.phaseSeq`, ends the phase after `seconds` with `onTimeout`, and ignores
   * actions that are listed in other phases but not in this one (actions that no phase
   * lists are always allowed, e.g. a teacher's "next").
   */
  phases?: Record<string, PhaseDefinition<S>>;
  /**
   * Optional: what one player may see of the state (`playerId` = null for the board).
   * Use it when the state holds secrets: other players' answers before the reveal,
   * cards in a hand, hidden units. Each device then receives only its view, and every
   * `render` (also on the board and the host) gets the view instead of the full state.
   * Must be a pure function of the state; return a new object, do not change `state`.
   */
  playerView?(state: S, playerId: string | null): any;
}

export interface PhaseDefinition<S = any> {
  /** Length of the phase (a number or computed when entering); none = no time limit. */
  seconds?: number | ((state: S, ctx: GameContext) => number);
  /** Actions allowed in this phase (only those listed in some phase are restricted). */
  actions?: string[];
  /** Runs when the phase starts (after `state.phase` is set). */
  onEnter?(state: S, ctx: GameContext): void;
  /** When the time is up: the next phase, or a function (that may call `ctx.goto`). */
  onTimeout?: string | ((state: S, ctx: GameContext) => void);
}
