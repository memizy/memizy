import { describe, it, expect } from 'vitest';
import * as publicApi from './index';
import * as internal from './internal';

describe('public API', () => {
  it('exports exactly the public names; shared helpers are in @memizy/protocol/internal', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'AddressSchema', 'AnswerRecordSchema', 'BOARD_ADDRESS', 'DataScopeSchema', 'ErrorReportSchema', 'HOST_API_METHODS',
      'HandshakeSchema', 'HostAsSchema', 'LIMITS', 'LocalizedTextSchema', 'MemizyRuntimeSchema', 'MultiplayerModeSchema',
      'OutgoingMessageSchema', 'PLUGIN_API_METHODS', 'PLUGIN_DEVICES', 'PROTOCOL_ERROR_CODES', 'PROTOCOL_VERSION',
      'PluginManifestError', 'PluginPermissionsSchema', 'ProtocolError', 'RELAY_PROTOCOL',
      'SERVER_ADDRESS', 'SETTINGS_ADDRESS', 'SETTING_TYPES', 'ServiceNameSchema', 'SessionResultSchema', 'SettingDefinitionSchema',
      'SettingsUpdateSchema', 'UnknownSettingSchema', 'compareProtocolVersions', 'extractManifestFromHtml', 'isKnownSetting', 'isProtocolErrorCode',
      'isProtocolSupported', 'localize', 'negotiateProtocolVersion', 'parsePluginManifest', 'parseProtocolVersion',
      'prepareDisplaySet', 'readPluginManifestFromHtml', 'resolveSettings', 'safeParsePluginManifest', 'settingsForMode',
      'toProtocolError', 'validateSettingValue',
    ]);
    for (const name of Object.keys(internal)) expect(publicApi, name).not.toHaveProperty(name);
  });
});
