import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortTimeout } from './timers';

const hidden = (value: boolean) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
afterEach(() => hidden(false));

describe('shortTimeout', () => {
  it('runs once after the delay, also in a hidden tab (measured without setTimeout)', async () => {
    hidden(true);
    // Like a throttled background tab: the 30 ms setTimeout would fire only much later.
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) =>
      realSetTimeout(cb, ms === 30 ? 5000 : ms)) as typeof setTimeout);
    const fn = vi.fn();
    const started = Date.now();
    shortTimeout(fn, 30);
    spy.mockRestore();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1), { timeout: 500, interval: 5 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(29);
    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1); // the setTimeout fallback does not run it again
  });

  it('can be cancelled (visible and hidden)', async () => {
    const visibleFn = vi.fn();
    shortTimeout(visibleFn, 10)();
    hidden(true);
    const hiddenFn = vi.fn();
    shortTimeout(hiddenFn, 10)();
    await new Promise((r) => setTimeout(r, 50));
    expect(visibleFn).not.toHaveBeenCalled();
    expect(hiddenFn).not.toHaveBeenCalled();
  });
});
