/**
 * Keeps the SDK within the host's guaranteed rates (SPEC 8.1): answers and asset
 * requests wait for their turn (in order), extra error reports are dropped, and
 * `end` is sent after the answers recorded before it.
 */

import { HOST_API_METHODS, LIMITS, type HostApi, type InitPayload } from '@memizy/protocol';
import { RateLimiter } from '@memizy/protocol/internal';

/** The SDK stays a little below the host's rates: messages over the network may arrive bunched. */
const MARGIN = 0.8;

class Pacer {
  private readonly limiter: RateLimiter;
  private readonly rate: number;
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;

  constructor(rate: number, burst: number) {
    this.rate = rate * MARGIN;
    this.limiter = new RateLimiter(this.rate, Math.max(1, Math.floor(burst * MARGIN)));
  }

  /** Runs `call` now if the rate allows it and nothing waits, otherwise after the calls before it. */
  run<T>(call: () => Promise<T>, cost = 1): Promise<T> {
    if (this.waiting === 0 && this.limiter.tryTake(cost)) return call();
    this.waiting++;
    const turn = this.tail.then(() => this.take(cost));
    this.tail = turn;
    return turn.then(() => {
      this.waiting--;
      return call();
    });
  }

  /** Resolves when every queued call has been sent. */
  idle(): Promise<void> {
    return this.tail;
  }

  private async take(cost: number): Promise<void> {
    while (!this.limiter.tryTake(cost)) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil((1000 * cost) / this.rate)));
    }
  }
}

/** Wraps the host API of one instance. `init` is read lazily (the roster changes). */
export function pacedHost(host: HostApi, init: InitPayload): HostApi {
  const answers = new Pacer(LIMITS.answersPerSecond, LIMITS.answerBurst);
  const assets = new Pacer(LIMITS.assetsPerSecond, LIMITS.assetBurst);
  const errors = new RateLimiter(LIMITS.errorReportsPerSecond, LIMITS.errorReportBurst);
  // The authority records for every player: the host counts its answers per player.
  const answerCost = () => (init.session.self === init.session.authority ? 1 / Math.max(1, init.players.length) : 1);
  let answered: Promise<unknown> = Promise.resolve();

  // Every method by name: the host API may be a proxy without own properties (Penpal).
  const direct = Object.fromEntries(
    HOST_API_METHODS.map((method) => [method, (...args: unknown[]) => (host[method] as (...a: unknown[]) => Promise<unknown>)(...args)]),
  ) as unknown as HostApi;
  return {
    ...direct,
    recordAnswer: (answer) => {
      const sent = answers.run(() => host.recordAnswer(answer), answerCost());
      answered = Promise.all([answered, sent.catch(() => {})]);
      return sent;
    },
    getAsset: (key, itemId) => assets.run(() => host.getAsset(key, itemId)),
    reportError: (error) => (errors.tryTake() ? host.reportError(error) : Promise.resolve()),
    end: (result) => answered.then(() => host.end(result)),
  };
}
