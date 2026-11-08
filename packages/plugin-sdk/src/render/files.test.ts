import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, downloadFile, safeFileName } from './files';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ui.download', () => {
  it('saves directly with <a download> under a 1.1 host', () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    URL.createObjectURL = vi.fn(() => 'blob:null/1');
    URL.revokeObjectURL = vi.fn();
    expect(downloadFile('výsledky.csv', 'a;b', { type: 'text/csv', direct: true, locale: 'cs' })).toBe('saved');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('výsledky.csv');
    expect(clicked[0].getAttribute('href')).toBe('blob:null/1');
    expect(document.querySelector('a')).toBeNull(); // removed again
  });

  it('under an older host saves from a new window, or says the window was blocked', () => {
    const popup = document.implementation.createHTMLDocument('x');
    const clicks: string[] = [];
    const win = { document: popup, Blob, URL: { createObjectURL: () => 'blob:popup/1' } };
    vi.spyOn(window, 'open').mockReturnValueOnce(win as never).mockReturnValueOnce(null);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(`${this.download} ${this.getAttribute('href')}`);
    });
    expect(downloadFile('a/b.txt', 'x', { direct: false, locale: 'cs', sandboxed: true })).toBe('window');
    expect(clicks).toEqual(['a_b.txt blob:popup/1']);
    expect(popup.body.textContent).toContain('Stáhnout znovu');
    expect(downloadFile('b.txt', 'x', { direct: false, locale: 'en', sandboxed: true })).toBe('blocked');
  });

  it('cleans file names', () => {
    expect(safeFileName('../x:y?.csv')).toBe('.._x_y_.csv');
    expect(safeFileName('')).toBe('download');
  });
});

describe('ui.copy', () => {
  it('uses the clipboard API with HTML and text under a 1.1 host', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    (globalThis as any).ClipboardItem = class {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    };
    await expect(copyToClipboard('A\t1', '<table></table>', { direct: true })).resolves.toBe(true);
    expect(Object.keys((write.mock.calls[0] as any)[0][0].items)).toEqual(['text/html', 'text/plain']);
  });

  it('under an older host copies a selection during the click', async () => {
    const exec = vi.fn(() => true);
    (document as any).execCommand = exec;
    await expect(copyToClipboard('A', '<b>A</b>', { direct: false, sandboxed: true })).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.body.children).toHaveLength(0); // the helper element is gone
  });
});
