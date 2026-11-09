/**
 * Public types of `defineGame` (the API described in docs/ai-plugin-guide.md).
 */

import type { NoteItem, OQSEAnyItem, ProgressRecord } from '@memizy/oqse';
import type { DataScope, HostAs, Player, PluginView, SessionMode } from '@memizy/protocol';
import type { SafeHtml } from './render/html';
import type { QuestionOptions } from './render/question';

export type { SafeHtml, QuestionOptions };

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
  /** Current time in ms (same clock on all devices; game time, stands still while paused). */
  readonly now: number;
  /**
   * When the player tapped (game time), for points by speed: on a slow network the
   * action arrives later, but `actedAt` is the moment of the tap. The SDK limits it to
   * at most 400 ms before the arrival (a player cannot claim an earlier tap). Equal to
   * `now` for timers, hooks and the authority's own actions.
   */
  readonly actedAt: number;
  /** Deterministic random number in [0, 1). */
  random(): number;
  /** Deterministically shuffled copy of an array. */
  shuffle<T>(array: readonly T[]): T[];
  /** Run `action` after `ms` milliseconds. A timer with the same `key` replaces the previous one. */
  after(ms: number, action: string, payload?: unknown, options?: { key?: string }): void;
  /** Cancel a timer by its key. */
  cancel(key: string): void;
  /**
   * Move to another phase (games with `phases`). Takes effect immediately: `state.phase`,
   * `state.phaseSeq`, `state.phaseEndsAt` and the phase timer are set and `onEnter` runs
   * right away, so the rest of the action already sees the new phase. In `initialState`
   * the phase starts right after it returns.
   */
  goto(phase: string): void;
  /**
   * Take back `reveal` (e.g. before the same item is asked again): the devices get the item
   * without answers. Does nothing for items that were not revealed, so a game may call it
   * at the start of every question.
   */
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
  /**
   * The next item for a player (default `ctx.playerId`), chosen by the player's learning
   * progress when the game has `pickItems` and the app supports it (mistakes come back soon,
   * well-known items rarely); otherwise a random item not given to the player lately.
   * `types` limits the item types. Returns `null` when no item fits. The SDK keeps a short
   * queue per player in `state.$picks` (reserved) and refills it from the app.
   */
  nextItem(playerId?: string | null, options?: { types?: string[] }): OQSEAnyItem | null;
  /**
   * Personal sets (protocol 1.1, `modes.multiplayer.sets` lists `personal`): every player
   * learns their own set on their device. The authority has no items then: `ctx.nextItem(pid)`
   * gives the ID (and type) of the player's next item, the player's device shows and checks it
   * (`ui.question`), and the action gets `payload.correct`. `ctx.checkAnswer`, `ctx.itemInfo`
   * and `ctx.hasItems` work the same with shared and personal sets, so a game needs no second
   * path; `ctx.recordAnswer`, `ctx.reveal` and `ctx.hide` do nothing for items the authority
   * does not have (the device records, and it has the answers).
   */
  readonly personal: boolean;
  /**
   * Whether a player's answer to an item is right, with shared and personal sets alike:
   * `payload` is the action's payload (`{ itemId, answer }` from `ui.question`). The authority
   * checks it against the item (`checkAnswer`); with personal sets another player's own item is
   * checked on their device, which adds `payload.correct`. A note counts as right. `null` when
   * it cannot be told: no answer, an unknown item, an `open-ended` item.
   */
  checkAnswer(itemId: string, payload: unknown): boolean | null;
  /**
   * What the authority knows about an item, also a player's own one with personal sets (from
   * `ctx.nextItem`): its type and the length of its text in characters (for reading times –
   * questions, cards, notes and options as plain text). `null` for an unknown item.
   * `forPlayer` (default `ctx.playerId`) looks in that player's items first.
   */
  itemInfo(itemId: string, forPlayer?: string | null): ItemInfo | null;
  /**
   * Whether the game has items to ask (of these types): the shared set's items; with personal
   * sets always `true` (the players bring their own sets, which the authority cannot see).
   */
  hasItems(types?: string[]): boolean;
}

/** `ctx.itemInfo`: what the authority knows about an item without having it. */
export interface ItemInfo {
  id: string;
  type: string;
  /** Characters of the item's text as plain text (question, front and back, note, options). */
  textLength: number;
}

export interface RecordAnswerOptions {
  playerId?: string;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
  /** Partial credit 0–1 (e.g. 2 of 3 pairs = 0.67); `isCorrect` stays the pass/fail outcome. */
  score?: number;
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
  /** Personal sets: this player learns their own set (`ctx.personal`); `ui.items` are theirs. */
  readonly personal: boolean;
  /**
   * Stars or unstars an item for this player ("practise it later"; the app offers "only
   * starred"). `ui.question(item, { star: true })` shows a ☆ that does it. Protocol 1.1 apps
   * keep it; older ones only show it on this device.
   */
  markItem(itemId: string, starred: boolean): void;
  /** Data saved between games for this player. */
  readonly saved: SavedData;
  /** Per-screen scratch object (not shared, not saved). Changing it directly does not re-render. */
  readonly local: Record<string, any>;
  /**
   * Changes `ui.local` and re-renders: device-only UI state (a selected tab, a 2D/3D
   * switch, an animation flag) without a global variable. `ui.setLocal({ tab: 'map' })`
   * or `ui.setLocal((local) => { local.count += 1; })`. From HTML use `data-local`
   * with a handler in `defineGame({ localActions })`.
   */
  setLocal(update: Record<string, unknown> | ((local: Record<string, any>) => void)): void;
  /**
   * Draw the screen once more after `ms` milliseconds (SDK 1.1): a countdown or a reading
   * time that runs only sometimes, without `tickMs`. Call it from `render` while the
   * countdown runs (`if (left > 0) ui.redrawIn(Math.min(left, 1000))`); several calls keep
   * the earliest. Only this device; nothing changes in the state.
   */
  redrawIn(ms: number): void;
  /**
   * Whether this screen may ask for another set (`ui.chooseSet()`): solo, the board, the host
   * playing along – in apps that offer it (protocol 1.1). Show your "Change the set" button only then.
   */
  readonly canChooseSet: boolean;
  /**
   * Opens the app's set picker (SDK 1.1). Resolves `true` when a set was chosen – the game
   * then gets the new items (`itemsChanged` on the authority), `false` when cancelled.
   */
  chooseSet(): Promise<boolean>;
  /**
   * Saves a file on the player's device (SDK 1.1), e.g. results for the teacher:
   * `ui.download('results.csv', csvText, 'text/csv')`. Call it from a click. Under protocol
   * 1.1 hosts (Memizy Play) the file is saved directly (`'saved'`); under older hosts it is
   * saved from a new window (`'window'`; `'blocked'` when the browser blocked that window).
   */
  download(fileName: string, content: Blob | string, type?: string): 'saved' | 'window' | 'blocked';
  /**
   * Copies to the clipboard (SDK 1.1): `ui.copy(text)` or `ui.copy(text, html)` – the HTML
   * pastes formatted (tables into Word or Docs), the text everywhere else. Call it from a
   * click; resolves `true` when it worked.
   */
  copy(text: string, html?: string): Promise<boolean>;
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
  /**
   * Current time in ms, like `ctx.now` (game time: the same clock on all devices, stands
   * still while paused). A number, read again on every access (also outside `render`,
   * e.g. in a 3D scene or a timer): `state.endsAt - ui.now`.
   */
  readonly now: number;
  /**
   * Whether the host has paused the game. The SDK covers the game with a "paused"
   * curtain, stops `ui.now` / timers and ignores actions; show it in the game if you like.
   */
  readonly paused: boolean;
  /**
   * Calls a Memizy service the plugin declares in its manifest `services` and the
   * host offers (`ui.services`), e.g. `await ui.service('chess.puzzles', { level: 3 })`.
   * Rejects with SERVICE_UNAVAILABLE otherwise. Call it from event handlers or
   * `afterRender`, then put the result into the game with an action.
   */
  service(name: string, payload?: unknown): Promise<unknown>;
  /** Services available here (declared by the plugin and offered by the host). */
  readonly services: readonly string[];
  /**
   * HTML template that escapes every value except safe HTML (`ui.html`, `ui.text`,
   * `ui.note`, `ui.question`, `ui.raw`); arrays are joined, `null` / `false` are
   * left out. Use it for every `render`:
   * ``ui.html`<button data-act="answer" data-payload=${{ answer: o.id }}>${ui.text(o.text, { inline: true })}</button>` ``
   */
  html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml;
  /** Marks HTML you wrote yourself as safe (never use it for text from players or sets). */
  raw(html: unknown): SafeHtml;
  /**
   * Ready-made answering controls for an item (any OQSE type with controls: choices,
   * true/false, text, numbers, slider, sorting, timeline, pairs, categories, blanks,
   * matrix, flashcard, note, pin on image). Calls `options.action` (default "answer")
   * with `{ ...options.payload, answer }` in the `checkAnswer` format. Optional: games
   * may draw their own controls. Style it with CSS variables (--mz-q-accent, …).
   */
  question(item: OQSEAnyItem, options?: QuestionOptions): SafeHtml;
  /** Safe HTML for Rich Content from the study set. */
  text(markdown: string | undefined | null, options?: { inline?: boolean; item?: OQSEAnyItem }): SafeHtml;
  /** Safe HTML of a whole note item. */
  note(note: NoteItem, options?: { titleLevel?: number }): SafeHtml;
  /** Save data between games (`'plugin'`: across sets, `'set'`: this set). */
  save(scope: DataScope, value: unknown): void;
}

export type RenderResult = string | SafeHtml | void | undefined | null;

/**
 * A device-only click handler (`<button data-local="tab" data-payload=${'map'}>`): changes
 * `local` (= `ui.local`), then the screen re-renders. Nothing is sent to other devices.
 */
export type LocalHandler = (local: Record<string, any>, payload: any, ui: GameUI) => void;

export interface GameDefinition<S = any> {
  /** Where to render. Default: `document.body`. */
  root?: HTMLElement;
  /** Re-render every `tickMs` milliseconds (countdowns). */
  tickMs?: number;
  /**
   * The game opened outside Memizy (the file itself, another site's preview): a small button
   * opens a menu to load the player's own set (an OQSE file or link) and change the settings.
   * `controls: 'hidden'` hides the button (call `game.openStandaloneMenu()` from your own);
   * `position` moves it (default `'top-right'`). Inside Memizy nothing is shown.
   */
  standalone?: { controls?: 'auto' | 'hidden'; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' };
  initialState(ctx: GameContext): S;
  actions: Record<string, ActionHandler<S>>;
  /**
   * Device-only handlers for `data-local` clicks (tabs, a 2D/3D switch, an open menu):
   * `localActions: { tab(local, payload) { local.tab = payload; } }`. They change
   * `ui.local` and re-render this screen; game rules and anything others should see go
   * to `actions` (`data-act`).
   */
  localActions?: Record<string, LocalHandler>;
  /**
   * Continue a game saved by an older version of this game (SDK 1.1, SPEC 3.3). Runs on the
   * authority when it resumes from a saved game, before anything else – on every resume, so
   * check your own state version (`if ((state.v ?? 1) < 2) { …; state.v = 2; }`). Change the
   * state or return a new one. `info.from` is the `pluginVersion` that saved it (`null` for
   * games saved before SDK 1.1), `info.to` this version. Throw when you cannot read the state:
   * the game stays as it was saved and the host continues in the version that saved it.
   * Declare `"migrates": true` in `appSpecific.memizy` so hosts offer the newer version.
   */
  migrate?(state: any, info: { from: string | null; to: string }): void | S;
  /**
   * The set of the running game changed (SDK 1.1): the teacher switched it, reloaded it with
   * edits, or chose another one from the game (`ui.chooseSet()`). Runs on the authority like an
   * action; `ctx.items` are the new items. Items that stay keep their IDs, removed ones are
   * still readable with `ctx.item(id)`. Without this hook the game simply goes on with the new
   * items (a game that keeps only item IDs in its state needs nothing).
   */
  itemsChanged?(state: S, ctx: GameContext, change: { added: string[]; removed: string[]; changed: string[] }): void | S;
  playerJoined?(state: S, player: Player, ctx: GameContext): void | S;
  playerLeft?(state: S, player: Player, ctx: GameContext): void | S;
  /**
   * The host asks the game to finish now (e.g. the teacher presses "End game"; SPEC 7,
   * feature `finish-request`). Runs on the authority like an action, also while paused:
   * call `ctx.end({ scores })` and show your final screen (e.g. `ctx.goto('end')` with an
   * `onEnter` that calls `ctx.end`). Without this hook the host just closes the game.
   */
  onFinish?(state: S, ctx: GameContext): void | S;
  /**
   * Let the app choose each player's next questions by their learning progress
   * (`ctx.nextItem`; protocol 1.1, feature `pick-items`). `true`, or `{ ahead, weights }`:
   * how many items wait per player (1–10, default 2) and the weights of the levels 0–4
   * (default the app's: 1, 1, 0.7, 0.4, 0.1).
   */
  pickItems?: boolean | { ahead?: number; weights?: [number, number, number, number, number] };
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
   * `state.phaseSeq` (reserved: do not set them; `playerView` gets them copied), ends the
   * phase after `seconds` with `onTimeout`, re-renders timed phases (no `tickMs` needed),
   * and ignores:
   * - actions listed in other phases but not in this one (actions that no phase lists are
   *   allowed in every phase, e.g. a teacher's "next");
   * - every action sent from the screen of an older phase (a late answer, a double click
   *   on "next"), so a game needs no round numbers in its payloads.
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
