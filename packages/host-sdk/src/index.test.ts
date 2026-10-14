import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as hostSdk from './index';

describe('public API', () => {
  it('exports exactly the public names (internal helpers stay internal)', () => {
    expect(Object.keys(hostSdk).sort()).toEqual([
      'HOST_SDK_VERSION',
      'LEITNER_INTERVAL_DAYS',
      'LocalSession',
      'MemoryStorage',
      'PLUGIN_SANDBOX',
      'RELAY_APP_VERSION',
      'RelayHost',
      'RelayPlayer',
      'createEmptySet',
      'leitner',
      'loadPluginFromHtml',
      'loadPluginFromUrl',
      'mountPlugin',
      'prepareSetForPlugin',
    ]);
  });

  it('HOST_SDK_VERSION is the package version', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };
    expect(hostSdk.HOST_SDK_VERSION).toBe(pkg.version);
  });
});
