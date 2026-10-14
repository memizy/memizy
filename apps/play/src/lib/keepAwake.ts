/**
 * While a hosted game runs, this page is where the game runs for everybody: keep the
 * screen on (Screen Wake Lock, re-acquired after the tab was hidden – browsers release it
 * then) and notice when the tab was in the background for a while (browsers slow down
 * hidden tabs), so the host can be told.
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

type WakeLockSentinel = { release(): Promise<void>; addEventListener?(type: 'release', fn: () => void): void };
type WakeLockApi = { request(type: 'screen'): Promise<WakeLockSentinel> };

/** Longer than this in the background counts as "the game may have slowed down". */
export const AWAY_NOTICE_MS = 3000;

export function useKeepAwake(active: Ref<boolean>) {
  /** Set after the tab came back from a longer time in the background (the page clears it). */
  const cameBack = ref(false);
  let lock: WakeLockSentinel | null = null;
  let hiddenAt: number | null = null;

  async function acquire(): Promise<void> {
    if (lock || !active.value || document.visibilityState !== 'visible') return;
    try {
      lock = (await (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock?.request('screen')) ?? null;
      lock?.addEventListener?.('release', () => (lock = null));
    } catch {
      /* not supported, or not allowed (e.g. battery saver) */
    }
  }

  async function release(): Promise<void> {
    const current = lock;
    lock = null;
    await current?.release().catch(() => {});
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      lock = null; // browsers release the lock of a hidden page; take a new one when it is back
      if (active.value) hiddenAt = Date.now();
      return;
    }
    if (active.value && hiddenAt !== null && Date.now() - hiddenAt > AWAY_NOTICE_MS) cameBack.value = true;
    hiddenAt = null;
    void acquire();
  };

  document.addEventListener('visibilitychange', onVisibility);
  watch(active, (on) => (on ? void acquire() : void release()), { immediate: true });
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    void release();
  });

  return { cameBack };
}
