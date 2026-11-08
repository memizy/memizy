/**
 * Types of the Memizy Plugin Protocol (SPEC sections 4–7).
 */

import type { OQSEAnyItem, OQSEMeta, ProgressRecord } from '@memizy/oqse';
import type { HostAs, PluginView } from './pluginRuntime';

// ============================================================================
// Addresses, players, session
// ============================================================================

/** Address of an instance: a player ID, `"board"`, `"settings"` (`SETTINGS_ADDRESS`); `"server"` is reserved. */
export type Address = string;

/** Address of the presenter's board. */
export const BOARD_ADDRESS = 'board';

/** Reserved for a future server-side authority (SPEC 3.1). */
export const SERVER_ADDRESS = 'server';
/** Address of the plugin's own settings screen in the lobby (view `settings`). */
export const SETTINGS_ADDRESS = 'settings';

/**
 * Feature (SPEC 8.3, protocol 1.1): the host may ask the authority to finish the game
 * (`PluginApi.finishRequested`). The plugin lists it when the game can finish on request.
 */
export const FINISH_REQUEST_FEATURE = 'finish-request';

/**
 * Feature (SPEC 8.3, protocol 1.1): the authority may ask the host for the next items of a
 * player by that player's learning progress (`HostApi.pickItems`).
 */
export const PICK_ITEMS_FEATURE = 'pick-items';

/** `pickItems`: which items a player should get next (SPEC 5.4). */
export interface PickItemsRequest {
  /** The player to pick for. */
  playerId: string;
  /** How many (1–20). */
  count: number;
  /** Weights of the levels 0–4 (default the host's: 1, 1, 0.7, 0.4, 0.1). */
  weights?: number[];
  /** Only items of these types. */
  types?: string[];
  /** Items not to pick now (e.g. already waiting in the game's queue). */
  exclude?: string[];
}

export type SessionMode = 'solo' | 'multiplayer';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  /** The player's own set in a game with personal sets (SPEC 3.4): what they learn. */
  set?: { id: string; title: string; language?: string };
}

export interface SessionInfo {
  id: string;
  mode: SessionMode;
  /** `null` in solo. */
  hostAs: HostAs | null;
  view: PluginView;
  /** This instance. */
  self: Address;
  /** Who owns the game state. */
  authority: Address;
  /** This instance joined a running game. */
  lateJoin: boolean;
  /**
   * Whose questions (protocol 1.1, SPEC 3.4): `personal` – every player their own set,
   * checked on their device; the authority gets the outcomes. Missing: `shared`.
   */
  sets?: 'shared' | 'personal';
}

// ============================================================================
// Handshake
// ============================================================================

export interface Handshake {
  /** Protocol version the SDK speaks, e.g. `"1.0"`. */
  protocol: string;
  sdk: { name: string; version: string };
  plugin: { id: string; version: string };
  features: string[];
}

/** Language and theme of the app (`InitPayload.config`, `configChanged`). */
export interface HostConfig {
  locale: string;
  theme: 'light' | 'dark';
}

export type DataScope = 'plugin' | 'set';

export interface PluginData {
  /** Data across all sets (`null` = nothing saved yet). */
  plugin: unknown;
  /** Data for this plugin and the current set (`null` = nothing saved yet). */
  set: unknown;
}

export interface InitPayload {
  /** Negotiated version: same MAJOR, the lower MINOR. */
  protocol: string;
  host: { name: string; version: string };
  oqseVersion: string;
  features: string[];
  session: SessionInfo;
  /** Current roster (the presenter is not a player). */
  players: Player[];
  set: { meta: OQSEMeta; items: OQSEAnyItem[] };
  /** Values for every declared setting (defaults applied). */
  settings: Record<string, unknown>;
  config: HostConfig;
  /** The session clock and its pauses (see {@link SessionClock}). */
  clock: SessionClock;
  /** Memizy services this host offers to the plugin (declared in its manifest and available here); call them with `service()`. */
  services: string[];
  /** Learning progress of `self` (empty for board/settings). */
  progress: Record<string, ProgressRecord>;
  /** Plugin data of `self` (`null` values for board/settings). */
  data: PluginData;
  /** Last saved snapshot, only for the authority (resume). */
  snapshot: unknown | null;
  /**
   * Only for the authority: the secret seed of the game's random numbers (at least 128 bits,
   * e.g. 32 hex digits). Other instances never get it (SPEC 4.2).
   */
  seed?: string;
}

/**
 * The session clock. `Date.now() + offsetMs` is the session time. Pauses: the
 * game time is `(pausedAt ?? sessionTime) - pausedMs` – it stands still while the host
 * has paused the game (`pausedAt` = session time of the pause) and continues afterwards
 * without the paused time (`pausedMs` = total of finished pauses).
 */
export interface SessionClock {
  offsetMs: number;
  /** Total length of finished pauses (ms). */
  pausedMs: number;
  /** Session time when the current pause started, or `null` while the game runs. */
  pausedAt: number | null;
}

// ============================================================================
// Calls and messages
// ============================================================================

export interface AnswerRecord {
  /** Default: self (the authority as a player); required when the board records. Only the authority records (SPEC 5). */
  playerId?: string;
  itemId: string;
  isCorrect: boolean;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
  /**
   * Partial credit between 0 and 1 (e.g. 2 of 3 correct pairs = 0.67), for items that allow
   * it (OQSE `pedagogy.partialCredit`). `isCorrect` stays the outcome used for repetition.
   */
  score?: number;
  /**
   * What the player answered, in the `checkAnswer` format of the item type
   * (choice IDs, text, numbers…). Lets teachers see which wrong answers were chosen.
   */
  answer?: unknown;
  /**
   * The item itself, required when `itemId` is not in the set (a generated item, e.g.
   * from a service). It needs at least `id` (= `itemId`) and `type`; the answer fields may
   * be left out. Such answers count for statistics (`skills`, `tags`), not for repetition.
   */
  item?: { id: string; type: string; [key: string]: unknown };
}

export interface SessionResult {
  /** Final score per player ID (in solo: the single player). */
  scores?: Record<string, number>;
  /** Short plain-text summary shown by the host. */
  summary?: string;
}

export interface SettingsUpdate {
  values: Record<string, unknown>;
  valid: boolean;
  message?: string;
}

export interface ErrorReport {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface OutgoingMessage {
  /** `'all'` = every other instance. */
  to: 'authority' | 'all' | Address[];
  /** JSON-serializable. */
  data: unknown;
}

export interface IncomingMessage {
  from: Address;
  data: unknown;
  /** Session clock (ms). */
  sentAt: number;
}

export type SessionEndReason = 'finished' | 'host-left' | 'kicked' | 'closed' | 'error';

// ============================================================================
// RPC interfaces
// ============================================================================

/** Methods the host exposes to the plugin (plugin → host). SPEC section 5. */
export interface HostApi {
  hello(handshake: Handshake): Promise<InitPayload>;
  ready(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  saveSnapshot(snapshot: unknown): Promise<void>;
  recordAnswer(answer: AnswerRecord): Promise<void>;
  saveData(scope: DataScope, value: unknown): Promise<void>;
  updateSettings(update: SettingsUpdate): Promise<void>;
  getAsset(key: string, itemId?: string): Promise<Blob>;
  end(result: SessionResult): Promise<void>;
  reportError(error: ErrorReport): Promise<void>;
  /** Calls a Memizy service (one of `InitPayload.services`); returns its JSON result. */
  service(name: string, payload: unknown): Promise<unknown>;
  /**
   * *Authority only, feature `pick-items` (protocol 1.1).* The IDs of the items a player
   * should get next, chosen by the host from that player's learning progress (SPEC 5.4).
   * Optional: hosts without the feature do not have it.
   */
  pickItems?(request: PickItemsRequest): Promise<string[]>;
  /**
   * *Player views, protocol 1.1.* Stars or unstars an item for this player (OQSEP `starred`),
   * e.g. "practise this later" from inside a game; hosts offer "only starred" (SPEC 5.1).
   */
  markItem?(itemId: string, mark: { starred: boolean }): Promise<void>;
}

/** Methods the plugin exposes to the host (host → plugin). SPEC section 7. */
export interface PluginApi {
  start(): Promise<void>;
  deliver(message: IncomingMessage): Promise<void>;
  playersChanged(players: Player[]): Promise<void>;
  authorityChanged(status: { connected: boolean }): Promise<void>;
  configChanged(config: HostConfig): Promise<void>;
  /** The clock was corrected, or the game was paused / resumed. */
  clockChanged(clock: SessionClock): Promise<void>;
  sessionEnded(reason: SessionEndReason): Promise<void>;
  /**
   * *Authority only, feature `finish-request` (protocol 1.1).* The host asks the game to
   * finish now (e.g. the teacher ends it): the game calls `end(result)` and shows its final
   * screen. Optional: plugins without the feature do not have it.
   */
  finishRequested?(): Promise<void>;
}

export const HOST_API_METHODS = [
  'hello', 'ready', 'send', 'saveSnapshot', 'recordAnswer', 'saveData',
  'updateSettings', 'getAsset', 'end', 'reportError', 'service', 'pickItems', 'markItem',
] as const satisfies readonly (keyof HostApi)[];

export const PLUGIN_API_METHODS = [
  'start', 'deliver', 'playersChanged', 'authorityChanged', 'configChanged', 'clockChanged', 'sessionEnded', 'finishRequested',
] as const satisfies readonly (keyof PluginApi)[];
