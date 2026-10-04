/**
 * Automatic tests of a plugin in the Lab. Every scenario runs the real plugin
 * in hidden sandboxed iframes through a LocalSession and checks the
 * protocol-level behaviour (the Lab cannot look inside the opaque-origin
 * iframes): connecting, starting, errors reported by the SDK, rejected calls,
 * synchronization, late joining, reloads, message rates and sizes.
 */

import type { OQSEFile } from '@memizy/oqse';
import { LocalSession, SETTINGS_ADDRESS, mountPlugin, prepareSetForPlugin, type LoadedPlugin, type MountedPlugin, type SessionConfig, type SessionEvent } from '@memizy/host-sdk';

export type LabTestStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface LabTestResult {
  id: string;
  status: LabTestStatus;
  /** Short English summary (also used in the "fix it" prompt). */
  summary: string;
  details: string[];
}

export interface LabTestOptions {
  plugin: LoadedPlugin;
  set: OQSEFile;
  /** Hidden element where the test iframes are mounted. */
  container: HTMLElement;
  onProgress?: (done: number, total: number, current: string) => void;
}

const READY_TIMEOUT_MS = 10_000;
const OBSERVE_MS = 2500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  session: LocalSession;
  events: SessionEvent[];
  mounts: MountedPlugin[];
  container: HTMLElement;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

function box(parent: HTMLElement, width: number, height: number): HTMLElement {
  const el = parent.ownerDocument.createElement('div');
  el.style.cssText = `width:${width}px;height:${height}px;position:relative;`;
  parent.appendChild(el);
  return el;
}

async function open(options: LabTestOptions, config: Partial<SessionConfig>, addresses: string[]): Promise<Run> {
  const container = box(options.container, 1, 1);
  container.style.cssText = 'position:absolute;left:-10000px;top:0;width:1400px;';
  const session = new LocalSession({ plugin: options.plugin, set: options.set, mode: 'solo', countdownMs: 0, readyTimeoutMs: READY_TIMEOUT_MS, ...config } as SessionConfig);
  const events: SessionEvent[] = [];
  session.on((e) => events.push(e));
  const mounts = await Promise.all(addresses.map((a) => mountPlugin(session, a, box(container, a === 'board' ? 1280 : 390, a === 'board' ? 720 : 760), { overlays: false })));
  return { session, events, mounts, container };
}

async function close(run: Run): Promise<void> {
  await run.session.end('closed').catch(() => {});
  for (const m of run.mounts) m.unmount();
  run.container.remove();
}

function problems(run: Run, since = 0): string[] {
  return run.events.slice(since).flatMap((e) => {
    if (e.type === 'pluginError') return [`${e.address}: ${e.code}: ${e.message}`];
    if (e.type === 'rejected') return [`${e.address}: ${e.method} rejected with ${e.code}: ${e.message}`];
    return [];
  });
}

function readyCheck(run: Run, addresses: string[]): () => boolean {
  return () => addresses.every((a) => run.events.some((e) => e.type === 'ready' && e.address === a));
}

function trafficStats(run: Run): { maxRate: number; maxRateSender: string; maxBytes: number } {
  let maxRate = 0;
  let maxRateSender = '';
  let maxBytes = 0;
  const times = new Map<string, number[]>();
  for (const e of run.events) {
    if (e.type !== 'traffic') continue;
    maxBytes = Math.max(maxBytes, e.bytes);
    const now = performance.now();
    const list = (times.get(e.from) ?? []).filter((t) => now - t < 1000);
    list.push(now);
    times.set(e.from, list);
    if (list.length > maxRate) {
      maxRate = list.length;
      maxRateSender = e.from;
    }
  }
  return { maxRate, maxRateSender, maxBytes };
}

function result(id: string, summary: string, details: string[], status?: LabTestStatus): LabTestResult {
  return { id, summary, details, status: status ?? (details.length ? 'fail' : 'pass') };
}

/** Runs all scenarios that apply to the plugin's manifest. */
export async function runLabTests(options: LabTestOptions): Promise<LabTestResult[]> {
  const runtime = options.plugin.runtime;
  const results: LabTestResult[] = [];
  const scenarios: { id: string; label: string; run: () => Promise<LabTestResult[]> }[] = [];
  const players3 = [{ id: 'p1', name: 'Anna' }, { id: 'p2', name: 'Ben' }, { id: 'p3', name: 'Cyril' }];
  const multi = runtime.multiplayer;
  const usable = prepareSetForPlugin(options.set, options.plugin.manifest).set.items.length;

  results.push(
    usable > 0
      ? result('data', `The study set has ${usable} items the plugin declares.`, [])
      : result('data', 'The study set has no items of the types the plugin declares.', ['Choose another set or declare more item types in the manifest.'], 'warn'),
  );

  if (runtime.solo) {
    scenarios.push({
      id: 'solo',
      label: 'Solo',
      run: async () => {
        const run = await open(options, { mode: 'solo', players: [{ id: 'me', name: 'Me' }] }, ['me']);
        try {
          const ready = await waitFor(readyCheck(run, ['me']), READY_TIMEOUT_MS);
          if (!ready) return [result('solo', 'Solo: the plugin did not connect within 10 s.', ['Does the page call defineGame and import the SDK correctly?'])];
          await waitFor(() => run.events.some((e) => e.type === 'started'), 2000);
          await sleep(OBSERVE_MS);
          return [result('solo', 'Solo: the game starts and runs without errors.', problems(run))];
        } finally {
          await close(run);
        }
      },
    });
  }

  if (multi) {
    for (const hostAs of multi.hostAs) {
      const id = hostAs === 'presenter' ? 'presenter' : 'host-plays';
      const label = hostAs === 'presenter' ? 'Multiplayer – presenter board' : 'Multiplayer – host plays along';
      scenarios.push({
        id,
        label,
        run: async () => {
          const count = Math.max(multi.players.min, Math.min(3, multi.players.max));
          const roster = players3.slice(0, count).map((p, i) => ({ ...p, isHost: hostAs === 'player' && i === 0 }));
          const addresses = [...(hostAs === 'presenter' ? ['board'] : []), ...roster.map((p) => p.id)];
          const run = await open(options, { mode: 'multiplayer', hostAs, players: roster }, addresses);
          const out: LabTestResult[] = [];
          try {
            const ready = await waitFor(readyCheck(run, addresses), READY_TIMEOUT_MS);
            if (!ready) {
              const missing = addresses.filter((a) => !run.events.some((e) => e.type === 'ready' && e.address === a));
              return [result(id, `${label}: not all screens connected within 10 s.`, [`Missing: ${missing.join(', ')}`])];
            }
            await run.session.start();
            await sleep(OBSERVE_MS);
            const authority = run.session.authority;
            const synced = roster.filter((p) => p.id !== authority).every((p) => run.events.some((e) => e.type === 'traffic' && e.from === authority && e.to === p.id));
            const details = problems(run);
            if (!synced) details.push('The authority did not send the game state to all players (does initialState return an object?).');
            out.push(result(id, `${label}: all screens connect, start and stay synchronized.`, details));

            const stats = trafficStats(run);
            out.push(
              stats.maxRate > 20
                ? result(`${id}-rate`, `${label}: message rate is high (${stats.maxRate}/s from ${stats.maxRateSender}).`, ['Do not call actions in loops, timers or animation frames; the limit is 30 messages per second.'], 'warn')
                : result(`${id}-rate`, `${label}: message rate is fine (max ${stats.maxRate}/s).`, []),
            );
            out.push(
              stats.maxBytes > 32 * 1024
                ? result(`${id}-size`, `${label}: the game state is large (${Math.round(stats.maxBytes / 1024)} KB).`, ['Keep the state small: store item IDs, not whole items (limit 64 KB).'], 'warn')
                : result(`${id}-size`, `${label}: message size is fine (max ${Math.round(stats.maxBytes / 1024)} KB).`, []),
            );

            if (multi.lateJoin) {
              const before = run.events.length;
              run.session.addPlayer({ id: 'late', name: 'Late Larry' });
              run.mounts.push(await mountPlugin(run.session, 'late', box(run.container, 390, 760), { overlays: false }));
              const joined = await waitFor(() => run.events.slice(before).some((e) => e.type === 'traffic' && e.to === 'late' && e.from === authority), 5000);
              const lateProblems = problems(run, before);
              if (!joined) lateProblems.push('A player who joined during the game did not receive the game state.');
              out.push(result(`${id}-late`, `${label}: a player can join a running game.`, lateProblems));
            }

            const before = run.events.length;
            await run.session.reload(authority);
            const resumed = await waitFor(() => run.events.slice(before).some((e) => e.type === 'authority' && e.connected), READY_TIMEOUT_MS);
            await sleep(1000);
            const reloadProblems = problems(run, before);
            if (!resumed) reloadProblems.push('After a reload of the host screen the game did not resume.');
            out.push(result(`${id}-reload`, `${label}: the game survives a reload of the host screen.`, reloadProblems));
            return out;
          } finally {
            await close(run);
          }
        },
      });
    }

    if (runtime.settingsScreen) {
      scenarios.push({
        id: 'settings',
        label: 'Lobby settings screen',
        run: async () => {
          const run = await open(options, { mode: 'multiplayer', hostAs: multi.hostAs[0], players: players3.slice(0, Math.max(1, multi.players.min)).map((p, i) => ({ ...p, isHost: i === 0 })) }, [SETTINGS_ADDRESS]);
          try {
            const reported = await waitFor(() => run.events.some((e) => e.type === 'settings'), READY_TIMEOUT_MS);
            const details = problems(run);
            if (!reported) details.push('The settings screen did not report the settings (renderSettings / data-setting).');
            return [result('settings', 'Lobby settings screen: renders and reports settings.', details)];
          } finally {
            await close(run);
          }
        },
      });
    }
  }

  for (let i = 0; i < scenarios.length; i++) {
    options.onProgress?.(i, scenarios.length, scenarios[i].label);
    try {
      results.push(...(await scenarios[i].run()));
    } catch (error) {
      results.push(result(scenarios[i].id, `${scenarios[i].label}: the test could not run.`, [(error as Error).message]));
    }
  }
  options.onProgress?.(scenarios.length, scenarios.length, '');
  return results;
}
