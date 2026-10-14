import { ref, watch, type Ref } from 'vue';

const quiet = new WeakSet<Ref<unknown>>();

/**
 * A ref kept in localStorage (per-browser convenience only; fails silently). With
 * `override` (e.g. a choice from a link) the ref starts with it and the stored value is
 * kept: only a later change by the user is saved.
 */
export function persisted<T>(key: string, initial: T, override?: T): Ref<T> {
  let value = initial;
  try {
    const raw = localStorage.getItem(`memizy-play:${key}`);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    /* storage unavailable or corrupted */
  }
  const state = ref(override !== undefined ? override : value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    state,
    (next) => {
      if (quiet.has(state)) {
        quiet.delete(state);
        return;
      }
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

/** Changes a `persisted` ref for this visit only (the stored value stays). */
export function setUnsaved<T>(state: Ref<T>, value: T): void {
  if (state.value === value) return;
  quiet.add(state as Ref<unknown>);
  state.value = value;
}
