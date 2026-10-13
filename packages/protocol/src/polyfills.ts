/**
 * Small polyfills for what the connection library (Penpal 8) needs from the browser, so
 * older school devices (Safari before 17.4) still run games. Called right before
 * connecting; it only adds what is missing.
 */

export function ensureConnectionPolyfills(): void {
  const P = Promise as PromiseConstructor & { withResolvers?: unknown };
  if (typeof P.withResolvers !== 'function') {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: function withResolvers<T>(this: PromiseConstructor) {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new this<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      },
    });
  }
  const O = Object as ObjectConstructor & { hasOwn?: unknown };
  if (typeof O.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      writable: true,
      value: (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key),
    });
  }
}
