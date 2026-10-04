import { ref, watch, type Ref } from 'vue';

/** A ref kept in localStorage (per-browser convenience only; fails silently). */
export function persisted<T>(key: string, initial: T): Ref<T> {
  let value = initial;
  try {
    const raw = localStorage.getItem(`memizy-play:${key}`);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    /* storage unavailable or corrupted */
  }
  const state = ref(value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    state,
    (next) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(`memizy-play:${key}`, JSON.stringify(next));
        } catch {
          /* quota or unavailable */
        }
      }, 300);
    },
    { deep: true },
  );
  return state;
}
