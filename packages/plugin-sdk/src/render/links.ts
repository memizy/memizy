/**
 * Links in a game open in a new tab. Inside the host's iframe a normal link would
 * replace the game with the linked page (and the game would be gone for this player),
 * so every click on an `http(s):` / `mailto:` link – in Rich Content or written by the
 * game itself – opens a new tab instead (the host's sandbox allows popups that escape
 * it). In-page links (`#…`) and links the game handles itself (`preventDefault`) are
 * left alone; other links (relative ones, which point nowhere in an iframe) do nothing.
 */

const OPEN_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function guardLinks(doc: Document = document): () => void {
  const view = doc.defaultView;
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (href.startsWith('#') || /^javascript:/i.test(href)) return;
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return; // relative: there is no page behind it inside the iframe
    }
    if (OPEN_PROTOCOLS.has(url.protocol)) view?.open(url.href, '_blank', 'noopener,noreferrer');
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
