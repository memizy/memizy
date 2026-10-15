/**
 * @memizy/protocol – Memizy Plugin Protocol v1.
 * The normative specification is SPEC.md in this package.
 *
 * The public API is listed explicitly: it follows semver within 1.x. Helpers shared by the
 * Memizy packages (rate limiting, call parsing, content policies…) are in
 * `@memizy/protocol/internal` and may change in any release.
 */

export {
  PROTOCOL_VERSION,
  parseProtocolVersion,
  compareProtocolVersions,
  negotiateProtocolVersion,
  isProtocolSupported,
  type ProtocolVersion,
  type HostProtocolVersions,
} from './version';
export { PROTOCOL_ERROR_CODES, ProtocolError, isProtocolErrorCode, toProtocolError, type ProtocolErrorCode } from './errors';
export { LIMITS, type Limits } from './limits';
export { LocalizedTextSchema, SettingDefinitionSchema, UnknownSettingSchema, type LocalizedText, type SettingDefinition } from './settingsSchema';
export { validateSettingValue, resolveSettings, settingsForMode, localize, isKnownSetting, SETTING_TYPES, type SettingValue, type UnknownSettingDefinition } from './settings';
export {
  HostAsSchema,
  MultiplayerModeSchema,
  ServiceNameSchema,
  PluginPermissionsSchema,
  MemizyRuntimeSchema,
  PluginManifestError,
  safeParsePluginManifest,
  parsePluginManifest,
  readPluginManifestFromHtml,
  type MemizyRuntimeManifest,
  type PluginManifest,
  type PluginManifestResult,
} from './manifestSchema';
export { extractManifestFromHtml, type HostAs, type PluginView, type PluginRuntime } from './pluginRuntime';
export * from './types';
export {
  AddressSchema,
  HandshakeSchema,
  OutgoingMessageSchema,
  AnswerRecordSchema,
  DataScopeSchema,
  SettingsUpdateSchema,
  SessionResultSchema,
  ErrorReportSchema,
} from './schemas';
export {
  RELAY_PROTOCOL,
  type RelayBundle,
  type CreateRoomResponse,
  type RoomInfo,
  type RoomPlayer,
  type RelayClientMessage,
  type RelayErrorCode,
  type RelayServerMessage,
} from './relay';
export { prepareDisplaySet, type DisplaySet, type PublicItemMark } from './items';
export { PLUGIN_DEVICES, type PluginDevice } from './security';
