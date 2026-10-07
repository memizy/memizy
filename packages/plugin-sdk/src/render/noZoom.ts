/**
 * Games must not zoom on phones. iOS Safari zooms the page when a player taps into a
 * text field with a font under 16 px (and does not zoom back), on a double tap and on
 * a pinch – also inside the game's iframe, and it ignores `user-scalable=no`.
 *
 * - CSS (styles.ts): `touch-action` without double-tap and pinch zoom, no text inflation,
 *   text fields at least 16 px on touch screens.
 * - Here: the viewport of the game page (when it runs on its own) and Safari's pinch
 *   gestures (`gesturestart` …), which CSS alone does not stop.
 */

const VIEWPORT: Record<string, string> = { width: 'device-width', 'initial-scale': '1', 'maximum-scale': '1', 'user-scalable': 'no' };

/** Sets the viewport of the page so that it cannot be zoomed (keeps other keys, e.g. `viewport-fit`). */
export function lockViewport(doc: Document): void {
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'viewport';
    doc.head.appendChild(meta);
  }
  const entries = new Map<string, string>();
  for (const part of meta.content.split(',')) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key) entries.set(key.toLowerCase(), value ?? '');
  }
  for (const [key, value] of Object.entries(VIEWPORT)) entries.set(key, value);
  meta.content = [...entries].map(([key, value]) => (value ? `${key}=${value}` : key)).join(', ');
}

/** Stops pinch zoom (Safari gestures, two-finger moves). Returns a function that removes the listeners. */
export function preventZoom(doc: Document): () => void {
  lockViewport(doc);
  const stop = (event: Event) => event.preventDefault();
  const twoFingers = (event: TouchEvent) => {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const type of gestures) doc.addEventListener(type, stop, { passive: false });
  doc.addEventListener('touchmove', twoFingers, { passive: false });
  return () => {
    for (const type of gestures) doc.removeEventListener(type, stop);
    doc.removeEventListener('touchmove', twoFingers);
  };
}
