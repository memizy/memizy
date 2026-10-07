/** Minimal styles for SDK-generated elements (only `mz-*` classes). */
const CSS = `
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
:where(html,html *){touch-action:manipulation;touch-action:pan-x pan-y}
@media (pointer:coarse){input,textarea,select{font-size:max(16px,1em)!important}}
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
.mz-q{--mz-q-accent:#ff7a29;--mz-q-bg:rgba(127,127,127,.08);--mz-q-fg:inherit;--mz-q-border:rgba(127,127,127,.35);--mz-q-radius:12px;--mz-q-gap:10px;--mz-q-right:#16a34a;--mz-q-wrong:#e11d48;--mz-q-count-bg:var(--mz-q-border);display:flex;flex-direction:column;gap:var(--mz-q-gap);font:inherit;color:var(--mz-q-fg)}
.mz-q-question{font-weight:700;font-size:1.15em;line-height:1.35}
.mz-q-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:var(--mz-q-gap)}
.mz-q-two{grid-template-columns:1fr 1fr}.mz-q-three{grid-template-columns:repeat(3,1fr)}
.mz-q-opt,.mz-q-submit,.mz-q-reset,.mz-q-cell{font:inherit;color:inherit;cursor:pointer;border:2px solid var(--mz-q-border);background:var(--mz-q-bg);border-radius:var(--mz-q-radius);touch-action:manipulation}
.mz-q-opt{display:flex;align-items:center;gap:10px;min-height:52px;padding:10px 14px;text-align:left;font-weight:600}
.mz-q-key{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--mz-q-border);font-weight:800}
.mz-q-label{flex:1;min-width:0}
.mz-q-count{flex:none;min-width:2em;padding:2px 8px;border-radius:999px;background:var(--mz-q-count-bg,var(--mz-q-border));font-weight:800;text-align:center}
.mz-q-opt:not(:disabled):hover,.mz-q-cell:not(:disabled):hover{border-color:var(--mz-q-accent)}
.mz-q-picked,.mz-q-chosen{border-color:var(--mz-q-accent);box-shadow:0 0 0 2px var(--mz-q-accent) inset}
.mz-q-right{border-color:var(--mz-q-right);background:color-mix(in srgb,var(--mz-q-right) 22%,transparent)}
.mz-q-wrong{border-color:var(--mz-q-wrong);background:color-mix(in srgb,var(--mz-q-wrong) 22%,transparent)}
.mz-q-dim{opacity:.5}
.mz-q-submit{align-self:flex-start;padding:10px 20px;font-weight:800;background:var(--mz-q-accent);border-color:var(--mz-q-accent);color:#fff}
.mz-q-reset{padding:8px 14px;font-weight:600}
.mz-q button:disabled,.mz-q select:disabled,.mz-q input:disabled{cursor:default;opacity:.6}
.mz-q-chosen:disabled,.mz-q-right:disabled,.mz-q-wrong:disabled{opacity:1}
.mz-q-row{display:flex;gap:var(--mz-q-gap);flex-wrap:wrap;align-items:center}
.mz-q-form{display:flex;gap:var(--mz-q-gap);flex-wrap:wrap;align-items:center}
.mz-q-input,.mz-q-select{font:inherit;color:inherit;background:var(--mz-q-bg);border:2px solid var(--mz-q-border);border-radius:var(--mz-q-radius);padding:10px 12px;min-width:0}
.mz-q-form>.mz-q-input{flex:1 1 200px}
textarea.mz-q-input{flex-basis:100%;resize:vertical}
.mz-q-blank{width:8em;padding:4px 8px}
.mz-q-text{line-height:2.2}
.mz-q-order{margin:0;padding-left:1.6em;display:flex;flex-direction:column;gap:6px;min-height:8px}
.mz-q-order .mz-q-opt{width:100%;min-height:44px}
.mz-q-pairs{display:flex;flex-direction:column;gap:8px}
.mz-q-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center}
.mz-q-grid{border-collapse:separate;border-spacing:6px}.mz-q-grid th{font-weight:600;text-align:left}
.mz-q-cell{width:40px;height:40px}
.mz-q-slider{display:flex;gap:12px;align-items:center}.mz-q-range{flex:1}.mz-q-value{font-weight:800;min-width:4ch}
.mz-q-picture{position:relative;display:inline-block;max-width:100%}.mz-q-picture img{display:block;max-width:100%;height:auto;border-radius:var(--mz-q-radius)}
.mz-q-pinboard{cursor:crosshair}.mz-q-noimage{padding:40px;border:2px dashed var(--mz-q-border);border-radius:var(--mz-q-radius)}
.mz-q-pin{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:var(--mz-q-accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:none}
.mz-q-front,.mz-q-back{padding:16px;border-radius:var(--mz-q-radius);background:var(--mz-q-bg);border:2px solid var(--mz-q-border)}
.mz-no3d{display:grid;place-items:center;height:100%;min-height:120px;padding:16px;text-align:center;font:600 1.05rem/1.4 system-ui,sans-serif;opacity:.8}
.mz-q-given{font-weight:700}.mz-q-unit{opacity:.7}.mz-q-unsupported{opacity:.7;font-style:italic}
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById('memizy-sdk-styles')) return;
  const style = doc.createElement('style');
  style.id = 'memizy-sdk-styles';
  style.textContent = CSS;
  doc.head.appendChild(style);
}
