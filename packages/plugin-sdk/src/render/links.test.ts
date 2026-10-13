import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardLinks } from './links';
import { renderRichText } from '../text/richText';

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function click(el: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(event);
  return event;
}

describe('links', () => {
  it('opens external links in a new tab instead of replacing the game', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    stop = guardLinks(document);
    document.body.innerHTML = `<a href="https://example.com/x?a=1"><b>more</b></a><a href="mailto:t@example.com">mail</a>`;
    const event = click(document.querySelector('b')!);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/x?a=1', '_blank', 'noopener,noreferrer');
    click(document.querySelectorAll('a')[1]);
    expect(open).toHaveBeenLastCalledWith('mailto:t@example.com', '_blank', 'noopener,noreferrer');
  });

  it('leaves in-page links and links the game handles alone; relative links do nothing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    stop = guardLinks(document);
    document.body.innerHTML = `<a id="hash" href="#rules">rules</a><a id="own" href="https://example.com">own</a><a id="rel" href="page.html">rel</a>`;
    document.getElementById('own')!.addEventListener('click', (e) => e.preventDefault());
    expect(click(document.getElementById('hash')!).defaultPrevented).toBe(false);
    click(document.getElementById('own')!);
    expect(click(document.getElementById('rel')!).defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('Rich Content links get target="_blank" and rel="noopener noreferrer"', () => {
    const html = renderRichText('See [the source](https://example.com).', { latex: false, resolveMedia: () => undefined, locale: 'en' });
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
