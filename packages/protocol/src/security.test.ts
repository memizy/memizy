import { describe, expect, it } from 'vitest';
import { injectContentPolicy, pluginAllowAttribute, pluginContentPolicy } from './security';
import { safeParsePluginManifest } from './manifestSchema';

const manifest = (memizy: Record<string, unknown>) => ({
  version: '0.2',
  id: 'https://example.com/plugins/chess',
  appName: 'Chess',
  capabilities: { actions: ['render'], types: ['chess-puzzle'] },
  appSpecific: { memizy: { protocol: '1.0', modes: { solo: {} }, ...memizy } },
});

describe('permissions and services in the manifest', () => {
  it('accepts declared origins, devices and services', () => {
    const result = safeParsePluginManifest(manifest({ permissions: { network: ['https://lichess.org', 'wss://socket.lichess.org'], devices: ['microphone'] }, services: ['chess.puzzles', 'ai.chat'] }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.runtime.permissions).toEqual({ network: ['https://lichess.org', 'wss://socket.lichess.org'], devices: ['microphone'] });
    expect(result.runtime.services).toEqual(['chess.puzzles', 'ai.chat']);
  });

  it('defaults to nothing and rejects paths, plain http, unknown devices and bad service names', () => {
    const plain = safeParsePluginManifest(manifest({}));
    expect(plain.success && plain.runtime.permissions).toEqual({ network: [], devices: [] });
    expect(safeParsePluginManifest(manifest({ permissions: { network: ['https://lichess.org/api'] } })).success).toBe(false);
    expect(safeParsePluginManifest(manifest({ permissions: { network: ['http://lichess.org'] } })).success).toBe(false);
    expect(safeParsePluginManifest(manifest({ permissions: { devices: ['keyboard'] } })).success).toBe(false);
    expect(safeParsePluginManifest(manifest({ services: ['Chess Puzzles'] })).success).toBe(false);
  });
});

describe('content policy of the plugin iframe', () => {
  const runtime = { permissions: { network: ['https://lichess.org'], devices: ['camera', 'microphone'] as ('camera' | 'microphone')[] } };

  it('lets network requests reach only the CDNs, the host and the declared origins', () => {
    const csp = pluginContentPolicy(runtime, 'https://play.memizy.com');
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))!;
    expect(connect).toContain('https://lichess.org');
    expect(connect).toContain('https://cdn.jsdelivr.net');
    expect(connect).toContain('https://play.memizy.com');
    expect(connect).not.toContain('https:;');
    expect(connect.split(' ')).not.toContain('https:');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'unsafe-inline'[^;]*https:\/\/play\.memizy\.com/);
    // Without permissions: no lichess, and an opaque origin is not added.
    expect(pluginContentPolicy(null, 'null')).not.toContain('lichess');
    expect(pluginContentPolicy(null, 'null')).not.toContain(' null');
  });

  it('allows only the declared devices', () => {
    expect(pluginAllowAttribute(runtime)).toBe('camera *; microphone *');
    expect(pluginAllowAttribute(null)).toBe('');
  });

  it('puts the policy before every script', () => {
    const meta = '<meta http-equiv="Content-Security-Policy"';
    const withHead = injectContentPolicy('<!doctype html><html><head><title>x</title><script>1</script></head></html>', "default-src 'none'");
    expect(withHead.indexOf(meta)).toBeLessThan(withHead.indexOf('<script>'));
    expect(withHead).toMatch(/<head><meta http-equiv/);
    const bare = injectContentPolicy('<!doctype html><div id="app"></div><script type="module">1</script>', "default-src 'none'");
    expect(bare.indexOf(meta)).toBeLessThan(bare.indexOf('<script'));
    expect(injectContentPolicy('<p>x</p>', 'a "b"')).toContain('content="a &quot;b&quot;"');
  });
});
