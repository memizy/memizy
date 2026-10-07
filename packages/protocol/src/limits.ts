/**
 * Limits (SPEC section 8.1) and JSON value checks.
 *
 * The values are guaranteed minimums: a host MUST accept at least this much
 * and MAY allow more. Plugins (and the SDK) MUST stay within them.
 */

import { ProtocolError } from './errors';

export const LIMITS = {
  /** Max serialized size of one `send` message (bytes of UTF-8 JSON). */
  messageBytes: 64 * 1024,
  /** Sustained `send` rate per instance (messages per second). */
  messagesPerSecond: 30,
  /** Burst size of the `send` rate limiter. */
  messageBurst: 60,
  /** Max serialized size of a snapshot. */
  snapshotBytes: 1024 * 1024,
  /** Snapshots per second the host stores (more are coalesced). */
  snapshotsPerSecond: 2,
  /** Max serialized size of plugin data per scope. */
  dataBytes: 256 * 1024,
  /** Plugin data writes per second and scope the host stores (more are coalesced). */
  dataWritesPerSecond: 1,
  /** Max time between the iframe load and `hello`. */
  helloTimeoutMs: 10_000,
  /** Max serialized size of the player's answer in `recordAnswer`. */
  answerBytes: 4 * 1024,
  /** Max serialized size of a generated item attached to `recordAnswer`. */
  generatedItemBytes: 32 * 1024,
  /** Max serialized size of a service request (its result may be up to `messageBytes * 4`). */
  serviceBytes: 64 * 1024,
  /** Service calls per minute and instance (sustained). */
  servicesPerMinute: 30,
} as const;

export type Limits = { [K in keyof typeof LIMITS]: number };

const MAX_DEPTH = 64;

/**
 * Checks that `value` is plain JSON (null, booleans, finite numbers, strings,
 * arrays and plain objects; no cycles, no `undefined`, functions, Dates, Maps…).
 * Returns an error description, or `null` when the value is valid.
 */
export function findNonJson(value: unknown, path = '$', depth = 0, seen = new Set<object>()): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} is not a finite number`;
  if (typeof value !== 'object') return `${path} is a ${typeof value}`;
  if (depth >= MAX_DEPTH) return `${path} is nested deeper than ${MAX_DEPTH} levels`;
  if (seen.has(value)) return `${path} contains a circular reference`;

  if (Array.isArray(value)) {
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      const problem = findNonJson(value[i], `${path}[${i}]`, depth + 1, seen);
      if (problem) return problem;
    }
    seen.delete(value);
    return null;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${path} is not a plain object`;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const problem = findNonJson(child, `${path}.${key}`, depth + 1, seen);
    if (problem) return problem;
  }
  seen.delete(value);
  return null;
}

/** UTF-8 byte size of the JSON serialization of a (valid JSON) value. */
export function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Throws `INVALID_ARGUMENT` if `value` is not plain JSON, or `tooLargeCode`
 * if its serialized size exceeds `maxBytes`. Returns the size in bytes.
 */
export function assertJsonWithin(
  value: unknown,
  maxBytes: number,
  tooLargeCode: 'MESSAGE_TOO_LARGE' | 'SNAPSHOT_TOO_LARGE' | 'DATA_TOO_LARGE',
  what: string,
): number {
  const problem = findNonJson(value);
  if (problem) throw new ProtocolError('INVALID_ARGUMENT', `${what} must be plain JSON: ${problem}.`);
  const size = jsonByteSize(value);
  if (size > maxBytes) {
    throw new ProtocolError(tooLargeCode, `${what} is ${size} bytes; the limit is ${maxBytes} bytes.`);
  }
  return size;
}

/**
 * Token bucket rate limiter (`rate` tokens per second, up to `burst` stored).
 * Used by the host for `send`; also usable by the SDK to stay within limits.
 */
export class RateLimiter {
  private readonly rate: number;
  private readonly burst: number;
  private readonly now: () => number;
  private tokens: number;
  private last: number;

  constructor(rate: number, burst: number, now: () => number = () => Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.now = now;
    this.tokens = burst;
    this.last = now();
  }

  /** Takes `cost` tokens (default one). Returns `false` when the limit is exceeded. */
  tryTake(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
