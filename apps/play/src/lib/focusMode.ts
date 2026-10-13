/**
 * Focus mode: the game takes the whole screen (the page hides its panels and keeps a
 * thin bar). Where the browser allows it, the page also goes full screen; leaving full
 * screen (Esc) leaves focus mode too. Only classes change, so plugin iframes keep running.
 */

import { onBeforeUnmount, ref } from 'vue';

export function useFocusMode() {
  const focused = ref(false);

  const onFullscreenChange = () => {
    if (!document.fullscreenElement && focused.value) focused.value = false;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && focused.value && !document.fullscreenElement) exit();
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onKey);
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  });

  function enter(): void {
    focused.value = true;
    // Not everywhere (iPhone Safari): focus mode works without it.
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }

  function exit(): void {
    focused.value = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  return { focused, enter, exit, toggle: () => (focused.value ? exit() : enter()) };
}
