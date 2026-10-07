/**
 * The "naughty player" of the Lab tests: a bare player instance (no iframe) that
 * speaks the plugin SDK's sync protocol and sends every action of the game with
 * nonsense payloads – the mistakes and tricks of real players (double taps, late
 * taps, edited payloads). It reports crashes, state changes caused by nonsense, and
 * teacher actions a player can trigger.
 */

import type { HostApi, PluginApi } from '@memizy/protocol';
import type { LocalSession } from '@memizy/host-sdk';

/** Action names the plugin uses in its HTML (`data-act`, `ui.act`, `act`, `dispatch`). */
export function actionNames(html: string): string[] {
  const names = new Set<string>();
  for (const re of [/data-act\s*=\s*["']([A-Za-z_$][\w$]*)["']/g, /\b(?:ui\.act|\.act|dispatch)\(\s*["'`]([A-Za-z_$][\w$]*)["'`]/g]) {
    for (const m of html.matchAll(re)) names.add(m[1]);
  }
  return [...names].filter((n) => !n.startsWith('$')).slice(0, 12);
}

/** Payloads a careless or cheating player might send. */
export const NONSENSE: unknown[] = [
  null,
  {},
  'answer',
  42,
  { answer: null },
  { answer: -1, round: -1, seq: -1, index: 999 },
  { answer: 'x'.repeat(3000), team: 'nobody', id: '<img src=x>' },
  { answer: ['a', { b: 1 }], payload: { nested: [[[]]] }, item: 'zzz', x: 'NaN', y: 1e12 },
];

const TEACHER = /^(next|skip|end|finish|reset|restart|start|begin|pause|resume|kick|reveal|advance)/i;

export interface ChaosReport {
  crashes: string[];
  changed: string[];
  teacher: string[];
  actions: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects the naughty player at `address` (must be in the roster) and runs it. */
export async function runChaosPlayer(session: LocalSession, address: string, pluginHtml: string, problemsSince: () => string[]): Promise<ChaosReport> {
  let lastState: unknown;
  let waiting: ((s: unknown) => void) | null = null;
  const noop = async () => {};
  const pluginApi: PluginApi = {
    start: noop,
    deliver: async (message) => {
      const data = message.data as { t?: string; s?: unknown } | null;
      if (data?.t === 'state') {
        lastState = data.s;
        waiting?.(data.s);
        waiting = null;
      }
    },
    playersChanged: noop,
    authorityChanged: noop,
    setChanged: noop,
    configChanged: noop,
    clockChanged: noop,
    sessionEnded: noop,
  };
  const instance = await session.connect(address, () => pluginApi);
  const host: HostApi = instance.hostApi;
  await host.hello({ protocol: '1.0', sdk: { name: 'memizy-lab-chaos', version: '1' }, plugin: { id: session.plugin.manifest.id, version: '0' }, features: [] });
  await host.ready();

  /** The current state as this player sees it (a full sync). */
  const state = async (): Promise<string> => {
    const got = new Promise<unknown>((resolve) => (waiting = resolve));
    await host.send({ to: 'authority', data: { t: 'sync' } }).catch(() => {});
    const s = await Promise.race([got, sleep(1500).then(() => lastState)]);
    return JSON.stringify(s ?? null);
  };
  const keysChanged = (a: string, b: string): string[] => {
    const x = JSON.parse(a) ?? {};
    const y = JSON.parse(b) ?? {};
    if (typeof x !== 'object' || typeof y !== 'object') return a === b ? [] : ['(state)'];
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
  };

  // Wait for the game to start (the start waits for this player too).
  for (let i = 0; i < 20 && (await state()) === 'null'; i++) await sleep(250);

  // What changes by itself (timers, countdowns) is not the player's fault.
  const quietA = await state();
  await sleep(900);
  const quietB = await state();
  const noise = new Set(keysChanged(quietA, quietB));

  const actions = actionNames(pluginHtml);
  const report: ChaosReport = { crashes: [], changed: [], teacher: [], actions };
  let seq = 1000;
  for (const name of actions) {
    const before = await state();
    const since = problemsSince().length;
    for (const payload of NONSENSE) {
      await host.send({ to: 'authority', data: { t: 'act', n: name, p: payload, i: ++seq } }).catch(() => {});
      await sleep(60); // stay under the message rate limit
    }
    // A double tap: the same nonsense again at once.
    await host.send({ to: 'authority', data: { t: 'act', n: name, p: {}, i: ++seq } }).catch(() => {});
    await host.send({ to: 'authority', data: { t: 'act', n: name, p: {}, i: ++seq } }).catch(() => {});
    await sleep(250);
    const after = await state();
    const crashes = problemsSince().slice(since).filter((p) => /ACTION_FAILED|INVALID_STATE|threw/i.test(p));
    if (crashes.length) report.crashes.push(`"${name}": ${crashes[0]}`);
    const changed = keysChanged(before, after).filter((k) => !noise.has(k));
    if (changed.length) {
      if (TEACHER.test(name)) report.teacher.push(`"${name}" (changed ${changed.slice(0, 4).join(', ')})`);
      else report.changed.push(`"${name}" changed ${changed.slice(0, 4).join(', ')}`);
    }
  }
  return report;
}
