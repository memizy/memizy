// @vitest-environment node
/** The library build can be imported without a DOM (server code of a host, tests in Node). */

import { describe, it, expect } from 'vitest';

describe('import without a DOM', () => {
  it('loads the SDK and its pure helpers', async () => {
    const sdk = await import('./index');
    expect(typeof sdk.defineGame).toBe('function');
    expect(typeof sdk.checkAnswer).toBe('function');
    expect(sdk.toPlainText('**a**')).toBe('a');
  }, 30_000); // the first import transforms the whole SDK (slow while other test files run)
});
