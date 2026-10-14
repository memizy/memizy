import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, type HostApi, type InitPayload } from '@memizy/protocol';
import { RateLimiter } from '@memizy/protocol/internal';
import { pacedHost } from './pacedHost';

afterEach(() => {
  vi.useRealTimers();
});

/** A host API like Penpal's: a proxy without own properties, logging every call with its time. */
function fakeHost() {
  const calls: { name: string; at: number }[] = [];
  const log = (name: string) => calls.push({ name, at: Date.now() });
  const impl: Partial<Record<keyof HostApi, (...args: any[]) => Promise<unknown>>> = {
    recordAnswer: async (answer) => log(`answer ${answer.itemId}`),
    getAsset: async (key) => (log(`asset ${key}`), new Blob()),
    reportError: async (error) => log(`error ${error.code}`),
    end: async () => log('end'),
  };
  const host = new Proxy({}, { get: (_target, name) => impl[name as keyof HostApi] ?? (async () => log(String(name))) }) as HostApi;
  return { host, calls };
}

const initFor = (players: number, authority = true) =>
  ({
    session: { self: 'p0', authority: authority ? 'p0' : 'board' },
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}` })),
  }) as unknown as InitPayload;

/** Replays the calls through the host's own limiter: none may be refused. */
function withinHostLimit(times: number[], rate: number, burst: number, cost = 1): boolean {
  let now = times[0] ?? 0;
  const limiter = new RateLimiter(rate, burst, () => now);
  return times.every((t) => ((now = t), limiter.tryTake(cost)));
}

describe('pacedHost', () => {
  it('sends answers in order within the host rate, and end after them', async () => {
    vi.useFakeTimers();
    const { host, calls } = fakeHost();
    const paced = pacedHost(host, initFor(1));
    const sent = Array.from({ length: 40 }, (_, i) => paced.recordAnswer({ itemId: `q${i}`, isCorrect: true }));
    const ended = paced.end({});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBeLessThan(40); // the rest waits for its turn
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([...sent, ended]);

    const answers = calls.filter((c) => c.name.startsWith('answer'));
    expect(answers.map((c) => c.name)).toEqual(Array.from({ length: 40 }, (_, i) => `answer q${i}`));
    expect(calls.at(-1)!.name).toBe('end');
    expect(withinHostLimit(answers.map((c) => c.at), LIMITS.answersPerSecond, LIMITS.answerBurst)).toBe(true);
  });

  it('the authority records for every player: its rate is per player', async () => {
    vi.useFakeTimers();
    const { host, calls } = fakeHost();
    const paced = pacedHost(host, initFor(4));
    void Promise.all(Array.from({ length: 40 }, (_, i) => paced.recordAnswer({ itemId: `q${i}`, isCorrect: true })));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(40); // 4 players: 40 answers fit into the burst
    const follower = fakeHost();
    const one = pacedHost(follower.host, initFor(4, false));
    void Promise.all(Array.from({ length: 40 }, (_, i) => one.recordAnswer({ itemId: `q${i}`, isCorrect: true })));
    await vi.advanceTimersByTimeAsync(0);
    expect(follower.calls.length).toBeLessThan(20); // a player records only its own answers
  });

  it('asks for assets within the host rate and drops extra error reports', async () => {
    vi.useFakeTimers();
    const { host, calls } = fakeHost();
    const paced = pacedHost(host, initFor(1));
    const assets = Array.from({ length: 30 }, (_, i) => paced.getAsset(`a${i}`));
    const reports = Array.from({ length: 15 }, () => paced.reportError({ code: 'NOISY', message: 'x' }));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([...assets, ...reports]);
    const asked = calls.filter((c) => c.name.startsWith('asset'));
    expect(asked).toHaveLength(30);
    expect(withinHostLimit(asked.map((c) => c.at), LIMITS.assetsPerSecond, LIMITS.assetBurst)).toBe(true);
    expect(calls.filter((c) => c.name === 'error NOISY')).toHaveLength(LIMITS.errorReportBurst);
  });

  it('passes every other method through', async () => {
    const { host, calls } = fakeHost();
    const paced = pacedHost(host, initFor(1));
    await paced.ready();
    await paced.send({ to: 'all', data: 1 });
    expect(calls.map((c) => c.name)).toEqual(['ready', 'send']);
  });
});
