/**
 * Files and the clipboard from a game (`ui.download`, `ui.copy`).
 *
 * Protocol 1.1 hosts let the game's frame download files and write to the clipboard
 * (SPEC 8.4). Under an older host (or protocol), the frame has neither: a download opens
 * a new window that escapes the sandbox and saves the file there, copying selects the
 * content and uses `execCommand('copy')` while the click still counts.
 */

import { escapeHtml } from '../text/richText';

/** Whether this document runs in a sandboxed frame without its own origin (a Memizy host). */
function sandboxed(): boolean {
  try {
    return window.parent !== window && window.origin === 'null';
  } catch {
    return true;
  }
}

/** A file name without path separators or control characters (at most 120 characters). */
export function safeFileName(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);
  return clean || 'download';
}

export type DownloadResult = 'saved' | 'window' | 'blocked';

/**
 * Saves `content` as a file named `fileName`. Call it from a click (browsers allow downloads
 * and new windows only then). Returns `'saved'`, `'window'` (an older host: the file is saved
 * from a new window, which the player may close) or `'blocked'` (the browser blocked that
 * window).
 */
export function downloadFile(fileName: string, content: Blob | string, options: { type?: string; direct: boolean; locale: string; sandboxed?: boolean }): DownloadResult {
  const name = safeFileName(fileName);
  const type = options.type ?? (content instanceof Blob && content.type ? content.type : 'text/plain;charset=utf-8');
  if (options.direct || !(options.sandboxed ?? sandboxed())) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    return 'saved';
  }
  // An older host: the frame may not download, but a new window escapes the sandbox.
  const win = window.open('', '_blank');
  if (!win) return 'blocked';
  const cs = options.locale.toLowerCase().startsWith('cs');
  const again = cs ? 'Stáhnout znovu' : 'Download again';
  const close = cs ? 'Po stažení můžeš okno zavřít.' : 'You can close this window after the download.';
  const doc = win.document;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;margin:24px"><p><a id="dl" href="#" style="font-weight:bold">⬇️ ${escapeHtml(again)}: ${escapeHtml(name)}</a></p><p>${escapeHtml(close)}</p></body></html>`,
  );
  doc.close();
  const link = doc.getElementById('dl') as HTMLAnchorElement | null;
  if (!link) return 'blocked';
  const W = win as unknown as typeof globalThis;
  const blob = content instanceof Blob ? content : new W.Blob([content], { type });
  link.href = W.URL.createObjectURL(blob);
  link.download = name;
  link.click();
  return 'window';
}

/** Copies through a selection of a hidden element and `execCommand('copy')` (needs the click). */
function copyBySelection(text: string, html: string | undefined): boolean {
  const box = document.createElement(html ? 'div' : 'textarea');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;white-space:pre-wrap;opacity:0';
  if (box instanceof HTMLTextAreaElement) box.value = text;
  else {
    box.contentEditable = 'true';
    box.innerHTML = html!;
  }
  document.body.appendChild(box);
  const selection = getSelection();
  const active = document.activeElement as HTMLElement | null;
  let ok = false;
  try {
    if (box instanceof HTMLTextAreaElement) box.select();
    else if (selection) {
      const range = document.createRange();
      range.selectNodeContents(box);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  box.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

/** Copies through the clipboard API (`text/html` and `text/plain`, or plain text). */
async function copyByApi(text: string, html: string | undefined): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (!clipboard) return false;
  try {
    if (html && typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return true;
    }
    if (typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* not allowed here */
  }
  return false;
}

/**
 * Copies `text` (and `html` for rich paste, e.g. tables into Word) to the clipboard. Call it
 * from a click. Resolves `true` when it worked.
 */
export function copyToClipboard(text: string, html: string | undefined, options: { direct: boolean; sandboxed?: boolean }): Promise<boolean> {
  const plain = String(text ?? '');
  const rich = typeof html === 'string' && html ? html : undefined;
  // In an older host's sandbox the API is blocked: the selection must be copied during the click.
  if (!options.direct && (options.sandboxed ?? sandboxed())) return Promise.resolve(copyBySelection(plain, rich) || false);
  return copyByApi(plain, rich).then((ok) => ok || copyBySelection(plain, rich));
}
