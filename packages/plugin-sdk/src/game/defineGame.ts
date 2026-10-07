/**
 * `defineGame` – the entry point for plugin authors (docs/ai-plugin-guide.md).
 * Connects to the host, runs the game runtime and renders the screens.
 */

import {
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  assertJsonWithin,
  localize,
  resolveSettings,
  toRuntime,
  toProtocolError,
  type DataScope,
  type Handshake,
  type HostApi,
  type InitPayload,
  type PluginApi,
  type PluginRuntime,
  type SessionClock,
  type SettingDefinition,
} from '@memizy/protocol';
import { resolveAsset, type MediaObject, type NoteItem, type OQSEAnyItem, type ProgressRecord } from '@memizy/oqse';
import { GameRuntime } from './runtime';
import { SafeHtml, html as safeHtml, raw as rawHtml } from '../render/html';
import { autoConnector, type Connector, type HostConnection } from '../connection/connect';
import { standaloneConnector } from '../standalone/standaloneHost';
import { morph } from '../render/morph';
import { bindEvents } from '../render/events';
import { injectStyles } from '../render/styles';
import { enhance } from '../text/enhance';
import { escapeHtml, renderNoteHtml, renderRichText, type RichTextContext } from '../text/richText';
import type { GameDefinition, GameUI, RenderResult, SavedData } from '../types';

declare const __SDK_VERSION__: string;
export const SDK_VERSION: string = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';

export interface GameHandle {
  /** Resolves when the game is connected and the first screen is rendered. */
  ready: Promise<void>;
  /**
   * Calls an action from your own code (a click in a canvas or 3D scene, a key press).
   * Same as `data-act` / `ui.act`; ignored before the game has started.
   */
  act(name: string, payload?: unknown): void;
  /** Stops the game and removes listeners. */
  destroy(): void;
}

export interface StartOptions {
  /** Custom connection (tests, the Plugin Lab). Default: iframe host or standalone preview. */
  connector?: Connector;
  document?: Document;
}

/** Defines and starts the game. Call it exactly once. */
export function defineGame<S>(definition: GameDefinition<S>): GameHandle {
  return startGame(definition);
}

export function startGame<S>(definition: GameDefinition<S>, options: StartOptions = {}): GameHandle {
  const doc = options.document ?? document;
  let controller: Controller | null = null;
  let destroyed = false;

  const pluginApi: PluginApi = {
    start: async () => controller?.start(),
    deliver: async (message) => controller?.deliver(message),
    playersChanged: async (players) => controller?.playersChanged(players),
    authorityChanged: async (status) => controller?.authorityChanged(status.connected),
    setChanged: async (set) => controller?.setChanged(set),
    configChanged: async (config) => controller?.configChanged(config),
    clockChanged: async (clock) => controller?.clockChanged(clock),
    sessionEnded: async () => controller?.destroy(),
  };

  const ready = (async () => {
    validateDefinition(definition);
    const root = definition.root ?? doc.body;
    injectStyles(doc);

    const manifest = readManifest(doc);
    const handshake: Handshake = {
      protocol: PROTOCOL_VERSION,
      sdk: { name: '@memizy/plugin-sdk', version: SDK_VERSION },
      plugin: { id: manifest.id, version: manifest.version },
      features: [],
    };
    const connector =
      options.connector ?? autoConnector(standaloneConnector({ runtime: manifest.runtime, pluginId: manifest.id, types: manifest.types }));
    const connection = await connector(pluginApi, handshake);
    if (destroyed) return;

    applyConfig(doc, connection.init.config);
    await resolveAssets(connection.init, connection.host);

    controller =
      connection.init.session.view === 'settings'
        ? new SettingsController(definition, connection, root, manifest.runtime?.settings ?? [])
        : new GameController(definition, connection, root);
    controller.renderNow();
    await connection.host.ready();
  })();

  ready.catch((error) => {
    console.error('[memizy] The game could not start:', error);
    const root = definition?.root ?? doc.body;
    if (root) morph(root, `<div class="mz-error">${escapeHtml(toProtocolError(error).message)}</div>`);
  });

  return {
    ready,
    act(name, payload) {
      if (controller instanceof GameController) controller.act(name, payload);
      else console.warn(`[memizy] act("${name}") ignored: the game has not started yet.`);
    },
    destroy() {
      destroyed = true;
      controller?.destroy();
    },
  };
}

// ============================================================================
// Controllers
// ============================================================================

interface Controller {
  renderNow(): void;
  act(name: string, payload: unknown): void;
  start(): void;
  deliver(message: Parameters<PluginApi['deliver']>[0]): void;
  playersChanged(players: Parameters<PluginApi['playersChanged']>[0]): void;
  authorityChanged(connected: boolean): void;
  setChanged(set: InitPayload['set']): void;
  configChanged(config: InitPayload['config']): void;
  clockChanged(clock: SessionClock): void;
  destroy(): void;
}

/** Shared rendering infrastructure. */
abstract class BaseController implements Controller {
  protected readonly host: HostApi;
  protected readonly init: InitPayload;
  protected readonly root: HTMLElement;
  protected readonly local: Record<string, any> = {};
  protected scheduled = false;
  private readonly reported = new Set<string>();
  private readonly unbind: () => void;
  private readonly connection: HostConnection;

  constructor(connection: HostConnection, root: HTMLElement, onSetting?: (id: string, value: string | number | boolean) => void) {
    this.connection = connection;
    this.host = connection.host;
    this.init = connection.init;
    this.root = root;
    this.unbind = bindEvents(root, {
      act: (name, payload) => this.act(name, payload),
      setting: onSetting,
      error: (message) => this.report('INVALID_PAYLOAD', message),
    });
  }

  abstract render(): RenderResult;
  abstract act(name: string, payload: unknown): void;
  start(): void {}
  deliver(_message: Parameters<PluginApi['deliver']>[0]): void {}
  authorityChanged(_connected: boolean): void {}
  clockChanged(_clock: SessionClock): void {}
  setChanged(_set: InitPayload['set']): void {}

  playersChanged(players: InitPayload['players']): void {
    this.init.players = players;
    this.schedule();
  }

  configChanged(config: InitPayload['config']): void {
    this.init.config = config;
    applyConfig(this.root.ownerDocument, config);
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.renderNow();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  renderNow(): void {
    let html: RenderResult;
    try {
      html = this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.report('RENDER_FAILED', message);
      html = `<div class="mz-error">Render error: ${escapeHtml(message)}</div>`;
    }
    if (html instanceof SafeHtml) html = html.toString();
    if (typeof html === 'string') morph(this.root, html);
    void enhance(this.root, this.init.config.theme);
    try {
      this.afterRender();
    } catch (error) {
      this.report('UPDATE_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  /** Runs after each render (`afterRender` of the game definition). */
  protected afterRender(): void {}

  protected report(code: string, message: string): void {
    const key = `${code}:${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    console.error(`[memizy] ${code}: ${message}`);
    this.host.reportError({ code, message }).catch(() => {});
  }

  protected textContext(item?: OQSEAnyItem): RichTextContext {
    const meta = this.init.set.meta;
    return {
      latex: meta.requirements?.features?.includes('latex') ?? false,
      locale: this.init.config.locale,
      resolveMedia: (key) => findMedia(key, item, this.init),
    };
  }

  protected baseUi(): Omit<GameUI, 'view' | 'self' | 'isAuthority' | 'act' | 'pending' | 'isPending' | 'timeLeft' | 'now' | 'phase' | 'paused' | 'service' | 'services' | 'item' | 'items' | 'save' | 'setProgress' | 'progress' | 'saved'> {
    const init = this.init;
    return {
      mode: init.session.mode,
      hostAs: init.session.hostAs,
      players: init.players,
      settings: init.settings,
      locale: init.config.locale,
      theme: init.config.theme,
      local: this.local,
      setLocal: (update) => {
        if (typeof update === 'function') update(this.local);
        else if (update && typeof update === 'object') Object.assign(this.local, update);
        this.schedule();
      },
      text: (markdown, options) => rawHtml(renderRichText(markdown, this.textContext((options as { item?: OQSEAnyItem } | undefined)?.item), options)),
      renderNote: (note: NoteItem, options) => rawHtml(renderNoteHtml(note, this.textContext(note), options)),
      html: safeHtml,
      raw: rawHtml,
      escape: escapeHtml,
    };
  }

  destroy(): void {
    this.unbind();
    this.connection.destroy();
  }
}

class GameController<S> extends BaseController {
  private readonly def: GameDefinition<S>;
  private readonly runtime: GameRuntime<S>;
  private readonly saved: SavedData;
  private readonly progress: Record<string, ProgressRecord>;
  private readonly saveTimers = new Map<DataScope, ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval> | undefined;

  constructor(def: GameDefinition<S>, connection: HostConnection, root: HTMLElement) {
    super(connection, root);
    this.def = def;
    this.saved = { plugin: connection.init.data.plugin ?? null, set: connection.init.data.set ?? null };
    this.progress = { ...connection.init.progress };
    this.runtime = new GameRuntime<S>(def, connection.host, connection.init);
    this.runtime.onChange = () => this.schedule();
    this.runtime.boot();
    this.showPaused(); // joined (or reloaded) during a pause
    if (def.tickMs && def.tickMs > 0) {
      this.tick = setInterval(() => {
        if (this.runtime.state !== undefined) this.schedule();
      }, Math.max(16, def.tickMs));
    }
  }

  private get isBoard(): boolean {
    return this.init.session.view === 'board';
  }

  private lastUi: GameUI | null = null;

  render(): RenderResult {
    const ui = this.ui();
    this.lastUi = ui;
    if (this.runtime.state === undefined) {
      return this.def.renderWaiting ? this.def.renderWaiting(ui) : defaultWaiting(this.init.config.locale);
    }
    this.lastView = this.visibleState();
    if (this.lastView === undefined) return '';
    return this.def.render(this.lastView as S, ui);
  }

  private lastView: unknown;

  /** What this device may see: the full state, or on the authority its own view (`playerView`). */
  private visibleState(): unknown {
    if (!this.def.playerView || !this.runtime.isAuthority) return this.runtime.state;
    const self = this.init.session.self;
    return this.runtime.viewFor(this.init.session.view === 'board' ? null : self);
  }

  protected override afterRender(): void {
    if (this.def.afterRender && this.lastView !== undefined && this.lastUi) this.def.afterRender(this.lastView as S, this.lastUi);
  }

  act(name: string, payload: unknown): void {
    this.runtime.dispatch(name, payload);
  }

  ui(): GameUI {
    const runtime = this.runtime;
    const self = this.init.players.find((p) => p.id === this.init.session.self) ?? null;
    return {
      ...this.baseUi(),
      players: runtime.players,
      view: this.init.session.view,
      self,
      isAuthority: runtime.isAuthority,
      items: this.init.set.items,
      item: (id) => runtime.item(id),
      progress: this.progress,
      saved: this.saved,
      act: (name, payload) => runtime.dispatch(name, payload),
      pending: runtime.waitingActions,
      isPending: (name) => runtime.waitingActions.some((a) => name === undefined || a.name === name),
      timeLeft: (deadline) => {
        const end = typeof deadline === 'number' ? deadline : (runtime.state as { phaseEndsAt?: unknown } | undefined)?.phaseEndsAt;
        return Math.max(0, (typeof end === 'number' ? end : 0) - runtime.now());
      },
      now: () => runtime.now(),
      phase: this.def.phases ? (((runtime.state as { phase?: unknown } | undefined)?.phase as string | undefined) ?? null) : null,
      paused: runtime.paused,
      services: this.init.services ?? [],
      service: (name, payload) => this.callService(name, payload),
      save: (scope, value) => this.save(scope, value),
      setProgress: (itemId, progress) => this.setProgress(itemId, progress),
    };
  }

  private callService(name: string, payload: unknown): Promise<unknown> {
    if (!(this.init.services ?? []).includes(name)) {
      return Promise.reject(new ProtocolError('SERVICE_UNAVAILABLE', `Service "${name}" is not available (declare it in the manifest "services"; this host offers: ${(this.init.services ?? []).join(', ') || 'none'}).`));
    }
    return this.host.service(name, payload ?? null).catch((error) => {
      throw toProtocolError(error);
    });
  }

  private save(scope: DataScope, value: unknown): void {
    if (this.isBoard) {
      this.report('NOT_ALLOWED_IN_VIEW', 'ui.save is not available on the board (it has no player).');
      return;
    }
    if (scope !== 'plugin' && scope !== 'set') throw new Error(`ui.save: scope must be 'plugin' or 'set', got ${String(scope)}`);
    assertJsonWithin(value, LIMITS.dataBytes, 'DATA_TOO_LARGE', `ui.save('${scope}')`);
    const copy = value === undefined ? null : structuredClone(value);
    if (JSON.stringify(copy) === JSON.stringify(this.saved[scope])) return;
    this.saved[scope] = copy;
    clearTimeout(this.saveTimers.get(scope));
    this.saveTimers.set(
      scope,
      setTimeout(() => {
        this.host.saveData(scope, this.saved[scope]).catch((e) => this.report('SAVE_FAILED', toProtocolError(e).message));
      }, 1000 / LIMITS.dataWritesPerSecond),
    );
  }

  private setProgress(itemId: string, update: { bucket: 0 | 1 | 2 | 3 | 4; nextReviewAt?: string }): void {
    if (this.isBoard) {
      this.report('NOT_ALLOWED_IN_VIEW', 'ui.setProgress is not available on the board (it has no player).');
      return;
    }
    if (!Number.isInteger(update?.bucket) || update.bucket < 0 || update.bucket > 4) throw new Error('ui.setProgress: bucket must be 0, 1, 2, 3 or 4');
    const previous = this.progress[itemId];
    if (previous && previous.bucket === update.bucket && previous.nextReviewAt === update.nextReviewAt) return;
    const record: ProgressRecord = {
      ...(previous ?? { stats: { attempts: 0, incorrect: 0, streak: 0 } }),
      bucket: update.bucket,
      ...(update.nextReviewAt !== undefined && { nextReviewAt: update.nextReviewAt }),
    } as ProgressRecord;
    this.progress[itemId] = record;
    this.host.saveProgress({ [itemId]: record }).catch((e) => this.report('SAVE_FAILED', toProtocolError(e).message));
  }

  start(): void {
    this.runtime.start();
  }

  deliver(message: Parameters<PluginApi['deliver']>[0]): void {
    this.runtime.receive(message);
  }

  playersChanged(players: InitPayload['players']): void {
    this.init.players = players;
    this.runtime.updatePlayers(players);
  }

  authorityChanged(connected: boolean): void {
    this.runtime.setAuthorityConnected(connected);
  }

  setChanged(set: InitPayload['set']): void {
    this.runtime.replaceSet(set);
  }

  clockChanged(clock: SessionClock): void {
    this.runtime.setClock(clock);
    this.showPaused();
  }

  /** While the host has paused the game, a curtain covers it (no taps, the time stands still). */
  private showPaused(): void {
    const doc = this.root.ownerDocument;
    let curtain = doc.querySelector<HTMLElement>('.mz-paused');
    if (!this.runtime.paused) {
      curtain?.remove();
      return;
    }
    if (curtain) return;
    curtain = doc.createElement('div');
    curtain.className = 'mz-paused';
    curtain.setAttribute('role', 'status');
    curtain.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(10,14,28,.72);color:#fff;font:700 clamp(1.4rem,5vw,2.6rem) system-ui,sans-serif;text-align:center;padding:16px;backdrop-filter:blur(2px);';
    curtain.textContent = this.init.config.locale.startsWith('cs') ? '⏸ Hra je pozastavená' : '⏸ The game is paused';
    doc.body.appendChild(curtain);
  }

  destroy(): void {
    clearInterval(this.tick);
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.runtime.dispose();
    super.destroy();
  }
}

/** View `settings`: the plugin's own settings screen in the multiplayer lobby. */
class SettingsController extends BaseController {
  private readonly def: GameDefinition<any>;
  private readonly definitions: SettingDefinition[];
  private values: Record<string, unknown>;

  constructor(def: GameDefinition<any>, connection: HostConnection, root: HTMLElement, definitions: SettingDefinition[]) {
    super(connection, root, (id, value) => this.setting(id, value));
    this.def = def;
    this.definitions = definitions;
    this.values = { ...connection.init.settings };
    this.push();
  }

  private settingsUi(): GameUI {
    return {
      ...this.baseUi(),
      settings: this.values,
      view: 'settings',
      self: null,
      isAuthority: false,
      items: this.init.set.items,
      item: (id) => this.init.set.items.find((i) => i.id === id),
      progress: {},
      saved: { plugin: null, set: null },
      act: () => this.report('NOT_ALLOWED_IN_VIEW', 'Actions are not available on the settings screen.'),
      pending: [],
      isPending: () => false,
      timeLeft: (deadline) => Math.max(0, (deadline ?? 0) - (Date.now() + this.init.clock.offsetMs)),
      phase: null,
      now: () => Date.now() + this.init.clock.offsetMs,
      paused: false,
      services: [],
      service: () => Promise.reject(new ProtocolError('NOT_ALLOWED_IN_VIEW', 'Services are not available on the settings screen.')),
      save: () => this.report('NOT_ALLOWED_IN_VIEW', 'ui.save is not available on the settings screen.'),
      setProgress: () => this.report('NOT_ALLOWED_IN_VIEW', 'ui.setProgress is not available on the settings screen.'),
    };
  }

  render(): RenderResult {
    return this.def.renderSettings
      ? this.def.renderSettings({ ...this.values }, this.settingsUi())
      : generatedSettingsForm(this.definitions, this.values, this.init.config.locale);
  }

  act(): void {
    this.report('NOT_ALLOWED_IN_VIEW', 'Actions are not available on the settings screen.');
  }

  private setting(id: string, raw: string | number | boolean): void {
    const def = this.definitions.find((d) => d.id === id);
    if (!def) {
      this.report('UNKNOWN_SETTING', `data-setting="${id}" is not declared in the manifest settings.`);
      return;
    }
    let value: unknown = raw;
    if (def.type === 'number') value = typeof raw === 'number' ? raw : Number(raw);
    else if (def.type === 'boolean') value = raw === true || raw === 'true';
    else if (def.type === 'select') value = def.options.find((o) => String(o.value) === String(raw))?.value ?? raw;
    else value = String(raw);
    this.values = { ...this.values, [id]: value };
    this.push();
    this.schedule();
  }

  private push(): void {
    const { values, errors } = resolveSettings(this.definitions, this.values);
    let custom: string | null = null;
    try {
      custom = this.def.validateSettings?.(values) || null;
    } catch (error) {
      custom = `validateSettings threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    const message = custom ?? errors[0];
    this.host
      .updateSettings({ values, valid: errors.length === 0 && !custom, ...(message && { message }) })
      .catch((e) => this.report('SETTINGS_FAILED', toProtocolError(e).message));
  }
}

// ============================================================================
// Helpers
// ============================================================================

function validateDefinition(def: GameDefinition<any>): void {
  const problems: string[] = [];
  if (!def || typeof def !== 'object') throw new Error('defineGame needs an object: defineGame({ initialState, actions, render })');
  if (typeof def.initialState !== 'function') problems.push('initialState must be a function returning the initial state');
  if (!def.actions || typeof def.actions !== 'object') problems.push('actions must be an object of functions');
  else for (const [name, fn] of Object.entries(def.actions)) if (typeof fn !== 'function') problems.push(`actions.${name} must be a function`);
  if (typeof def.render !== 'function') problems.push('render must be a function returning HTML');
  if (def.afterRender !== undefined && typeof def.afterRender !== 'function') problems.push('afterRender must be a function (state, ui) => void');
  if (problems.length > 0) throw new Error(`defineGame: ${problems.join('; ')}`);
}

interface ManifestInfo {
  id: string;
  version: string;
  runtime: PluginRuntime | null;
  types: string[] | null;
}

function readManifest(doc: Document): ManifestInfo {
  const fallback: ManifestInfo = { id: 'urn:memizy:unknown-plugin', version: '0.0.0', runtime: null, types: null };
  const script = doc.querySelector('script[type="application/oqse-manifest+json"]');
  if (!script?.textContent) {
    console.error('[memizy] Missing manifest: add <script type="application/oqse-manifest+json"> (see the plugin guide).');
    return fallback;
  }
  let data: any;
  try {
    data = JSON.parse(script.textContent);
  } catch (e) {
    console.error('[memizy] The manifest is not valid JSON:', e);
    return fallback;
  }
  // Lightweight check only: the host (and the Plugin Lab) fully validates the manifest
  // before loading the plugin, so the SDK does not need to ship the validation schemas.
  let runtime: PluginRuntime | null = null;
  try {
    runtime = toRuntime(data.appSpecific.memizy);
  } catch {
    console.error('[memizy] Invalid manifest: appSpecific.memizy needs "protocol" and "modes" (see the plugin guide). Validate the plugin in the Memizy Plugin Lab.');
  }
  return {
    id: typeof data?.id === 'string' ? data.id : fallback.id,
    version: typeof data?.pluginVersion === 'string' ? data.pluginVersion : '0.0.0',
    runtime,
    types: Array.isArray(data?.capabilities?.types) ? data.capabilities.types : null,
  };
}

function applyConfig(doc: Document, config: InitPayload['config']): void {
  const html = doc.documentElement;
  html.style.colorScheme = config.theme;
  html.dataset.memizyTheme = config.theme;
  if (config.locale) html.lang = config.locale;
}

/** Turns host-relative asset values into object URLs (opaque-origin iframes cannot read the host's blob URLs). */
async function resolveAssets(init: InitPayload, host: HostApi): Promise<void> {
  const tasks: Promise<void>[] = [];
  const visit = (assets: Record<string, MediaObject> | undefined, itemId?: string) => {
    for (const [key, media] of Object.entries(assets ?? {})) {
      if (/^(https?:|blob:|data:)/i.test(media.value)) continue;
      tasks.push(
        host
          .getAsset(key, itemId)
          .then((blob) => {
            media.value = URL.createObjectURL(blob);
          })
          .catch((e) => console.warn(`[memizy] Asset "${key}" could not be loaded: ${toProtocolError(e).message}`)),
      );
    }
  };
  visit(init.set.meta.assets);
  for (const item of init.set.items) visit(item.assets, item.id);
  await Promise.all(tasks);
}

function findMedia(key: string, item: OQSEAnyItem | undefined, init: InitPayload): MediaObject | undefined {
  const direct = resolveAsset(key, item, init.set.meta);
  if (direct) return direct;
  // Without the item context (ui.text(question)), fall back to any item defining the key.
  const k = key.toLowerCase();
  for (const candidate of init.set.items) {
    const media = candidate.assets?.[k];
    if (media) return media;
  }
  return undefined;
}

function defaultWaiting(locale: string): string {
  return `<div class="mz-waiting">${locale.startsWith('cs') ? 'Čekáme na začátek hry…' : 'Waiting for the game to start…'}</div>`;
}

function generatedSettingsForm(definitions: SettingDefinition[], values: Record<string, unknown>, locale: string): string {
  const rows = definitions.map((def) => {
    const label = escapeHtml(localize(def.label, locale));
    const value = values[def.id] ?? def.default;
    switch (def.type) {
      case 'number':
        return `<label>${label} <input type="number" data-setting="${def.id}" value="${escapeHtml(value)}"${def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== undefined ? ` max="${def.max}"` : ''}${def.step !== undefined ? ` step="${def.step}"` : ''}></label>`;
      case 'boolean':
        return `<label><input type="checkbox" data-setting="${def.id}"${value ? ' checked' : ''}> ${label}</label>`;
      case 'select':
        return `<label>${label} <select data-setting="${def.id}">${def.options
          .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(localize(o.label, locale))}</option>`)
          .join('')}</select></label>`;
      case 'text':
        return `<label>${label} <input type="text" data-setting="${def.id}" value="${escapeHtml(value)}"${def.maxLength ? ` maxlength="${def.maxLength}"` : ''}></label>`;
    }
  });
  return `<form class="mz-settings" style="display:grid;gap:12px;padding:16px">${rows.join('')}</form>`;
}
