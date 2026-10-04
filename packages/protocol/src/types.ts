/**
 * Types of the Memizy Plugin Protocol (SPEC sections 4–7).
 */

import type { OQSEAnyItem, OQSEMeta, ProgressRecord } from '@memizy/oqse';
import type { HostAs, PluginView } from './manifest';

// ============================================================================
// Addresses, players, session
// ============================================================================

/** Address of an instance: a player ID, `"board"`; `"server"` is reserved. */
export type Address = string;

/** Address of the presenter's board. */
export const BOARD_ADDRESS = 'board';

/** Reserved for a future server-side authority (SPEC 3.1). */
export const SERVER_ADDRESS = 'server';

export type SessionMode = 'solo' | 'multiplayer';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
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

export interface Theme {
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
  config: Theme;
  /** Add to `Date.now()` to get the session clock. */
  clock: { offsetMs: number };
  /** Learning progress of `self` (empty for board/settings). */
  progress: Record<string, ProgressRecord>;
  /** Plugin data of `self` (`null` values for board/settings). */
  data: PluginData;
  /** Last saved snapshot, only for the authority (resume). */
  snapshot: unknown | null;
}

// ============================================================================
// Calls and messages
// ============================================================================

export interface AnswerRecord {
  /** Default: self. The authority may record for any player. */
  playerId?: string;
  itemId: string;
  isCorrect: boolean;
  confidence?: 1 | 2 | 3 | 4;
  timeSpentMs?: number;
  hintsUsed?: number;
  isSkipped?: boolean;
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

export interface ResizeRequest {
  height: number | 'auto';
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

export type SessionEndReason = 'finished' | 'host_left' | 'kicked' | 'closed' | 'error';

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
  saveProgress(records: Record<string, ProgressRecord>): Promise<void>;
  saveData(scope: DataScope, value: unknown): Promise<void>;
  updateSettings(update: SettingsUpdate): Promise<void>;
  getAsset(key: string, itemId?: string): Promise<Blob>;
  end(result: SessionResult): Promise<void>;
  resize(request: ResizeRequest): Promise<void>;
  reportError(error: ErrorReport): Promise<void>;
  exit(): Promise<void>;
}

/** Methods the plugin exposes to the host (host → plugin). SPEC section 7. */
export interface PluginApi {
  start(): Promise<void>;
  deliver(message: IncomingMessage): Promise<void>;
  playersChanged(players: Player[]): Promise<void>;
  authorityChanged(status: { connected: boolean }): Promise<void>;
  setChanged(set: { meta: OQSEMeta; items: OQSEAnyItem[] }): Promise<void>;
  configChanged(config: Theme): Promise<void>;
  clockChanged(clock: { offsetMs: number }): Promise<void>;
  sessionEnded(reason: SessionEndReason): Promise<void>;
}

export const HOST_API_METHODS = [
  'hello', 'ready', 'send', 'saveSnapshot', 'recordAnswer', 'saveProgress', 'saveData',
  'updateSettings', 'getAsset', 'end', 'resize', 'reportError', 'exit',
] as const satisfies readonly (keyof HostApi)[];

export const PLUGIN_API_METHODS = [
  'start', 'deliver', 'playersChanged', 'authorityChanged', 'setChanged', 'configChanged', 'clockChanged', 'sessionEnded',
] as const satisfies readonly (keyof PluginApi)[];
