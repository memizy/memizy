/** Minimal styles for SDK-generated elements (only `mz-*` classes). */
const CSS = `
.mz-waiting{display:grid;place-items:center;min-height:60vh;font:1.25rem system-ui,sans-serif;opacity:.75;text-align:center;padding:16px}
.mz-error{margin:16px;padding:12px 16px;border-radius:8px;background:#fdecea;color:#611a15;font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap}
.mz-math-display{display:block;margin:.75em 0;text-align:center;overflow-x:auto}
.mz-mermaid{display:block;margin:.75em 0;overflow-x:auto;white-space:pre}
.mz-mermaid svg{max-width:100%;height:auto}
.mz-mermaid-error{color:#b3261e;font:13px monospace}
.mz-blank{display:inline-block;min-width:4em;border-bottom:2px solid currentColor;margin:0 .2em}
.mz-missing-asset{opacity:.6;font-style:italic}
.mz-media{margin:.75em 0}
.mz-media img,.mz-media video,.mz-note img,.mz-note video{max-width:100%;height:auto}
.mz-note-hidden{margin-top:1em}
.mz-note-hidden>summary{cursor:pointer;font-weight:600}
.mz-standalone-banner{position:fixed;left:0;right:0;bottom:0;padding:6px 12px;font:12px system-ui,sans-serif;background:#1d2b53;color:#fff;opacity:.9;z-index:2147483647;text-align:center}
.mz-standalone-result{position:fixed;left:50%;top:16px;transform:translateX(-50%);padding:10px 16px;border-radius:8px;font:600 15px system-ui,sans-serif;background:#2e7d32;color:#fff;z-index:2147483647}
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById('memizy-sdk-styles')) return;
  const style = doc.createElement('style');
  style.id = 'memizy-sdk-styles';
  style.textContent = CSS;
  doc.head.appendChild(style);
}
