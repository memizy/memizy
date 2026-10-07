import { afterEach, describe, expect, it } from 'vitest';
import { lockViewport, preventZoom } from './noZoom';
import { injectStyles } from './styles';

afterEach(() => {
  document.head.innerHTML = '';
});

describe('no zoom on phones', () => {
  it('locks the viewport and keeps other keys', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">';
    lockViewport(document);
    expect(document.querySelector('meta[name="viewport"]')!.getAttribute('content')).toBe('width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no');
    document.head.innerHTML = '';
    lockViewport(document);
    expect(document.querySelector('meta[name="viewport"]')!.getAttribute('content')).toBe('width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  });

  it('cancels pinch gestures and two-finger moves, not one-finger moves', () => {
    const allow = preventZoom(document);
    const fire = (type: string, touches = 0) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: { length: touches } });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire('gesturestart')).toBe(true);
    expect(fire('touchmove', 2)).toBe(true);
    expect(fire('touchmove', 1)).toBe(false);
    allow();
    expect(fire('gesturestart')).toBe(false);
  });

  it('styles: no double-tap or pinch zoom, text fields at least 16 px on touch screens', () => {
    injectStyles(document);
    const css = document.getElementById('memizy-sdk-styles')!.textContent!;
    expect(css).toContain('touch-action:manipulation;touch-action:pan-x pan-y');
    expect(css).toContain('@media (pointer:coarse){input,textarea,select{font-size:max(16px,1em)!important}}');
    expect(css).toContain('-webkit-text-size-adjust:100%');
  });
});
