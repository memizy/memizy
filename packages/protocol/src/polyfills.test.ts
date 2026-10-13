import { afterEach, describe, expect, it } from 'vitest';
import { ensureConnectionPolyfills } from './polyfills';

const original = { withResolvers: (Promise as any).withResolvers, hasOwn: (Object as any).hasOwn };

afterEach(() => {
  Object.defineProperty(Promise, 'withResolvers', { configurable: true, writable: true, value: original.withResolvers });
  Object.defineProperty(Object, 'hasOwn', { configurable: true, writable: true, value: original.hasOwn });
});

describe('ensureConnectionPolyfills', () => {
  it('adds Promise.withResolvers and Object.hasOwn on browsers without them', async () => {
    delete (Promise as any).withResolvers;
    delete (Object as any).hasOwn;
    ensureConnectionPolyfills();
    const { promise, resolve } = (Promise as any).withResolvers();
    resolve(42);
    expect(await promise).toBe(42);
    const rejected = (Promise as any).withResolvers();
    rejected.reject(new Error('no'));
    await expect(rejected.promise).rejects.toThrow('no');
    expect((Object as any).hasOwn({ a: 1 }, 'a')).toBe(true);
    expect((Object as any).hasOwn(Object.create({ a: 1 }), 'a')).toBe(false);
  });

  it('keeps native implementations', () => {
    const native = (Promise as any).withResolvers;
    ensureConnectionPolyfills();
    expect((Promise as any).withResolvers).toBe(native);
  });
});
