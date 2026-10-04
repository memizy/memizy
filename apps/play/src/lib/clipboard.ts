import { ref } from 'vue';

/** Copies text to the clipboard; `copied` is true for a moment afterwards. */
export function useCopy() {
  const copied = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string, key = 'default'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    copied.value = key;
    clearTimeout(timer);
    timer = setTimeout(() => (copied.value = null), 1800);
  }

  return { copied, copy };
}
