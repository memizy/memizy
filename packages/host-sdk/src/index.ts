/**
 * @memizy/host-sdk – run Memizy plugins: load and validate plugins, sandboxed
 * iframes, protocol validation and limits, sessions, storage and learning hooks,
 * multiplayer over the relay. Protocol: @memizy/protocol (SPEC.md).
 *
 * The public API is listed explicitly; everything else is internal and may change
 * in any release (src/index.test.ts guards the list).
 */

export { HOST_SDK_VERSION } from './version';
export {
  loadPluginFromHtml,
  loadPluginFromUrl,
  prepareSetForPlugin,
  createEmptySet,
  type LoadedPlugin,
  type LoadPluginResult,
  type PreparedSet,
} from './plugin';
export {
  LocalSession,
  SETTINGS_ADDRESS,
  type SessionConfig,
  type SessionPlayer,
  type SessionEvent,
  type SessionInstance,
  type PluginEndpoint,
  type ServiceHandler,
} from './session';
export { mountPlugin, PLUGIN_SANDBOX, type MountOptions, type MountedPlugin } from './frame';
export { MemoryStorage, type HostStorage } from './storage';
export { leitner, LEITNER_INTERVAL_DAYS, type LearningAlgorithm } from './learning';
export { RelayHost, type RelayHostOptions, type RelayHostEvent } from './relay/host';
export { RelayPlayer, type RelayPlayerOptions, type RelayPlayerEvent, type FrameFactory, type RemoteFrame } from './relay/player';
export type { RelayStatus } from './relay/socket';
export type { RemoteLobbyState, RemotePhase } from './relay/messages';
