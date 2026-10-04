/**
 * Renders LaTeX (KaTeX) and Mermaid diagrams inside already inserted HTML.
 * The libraries are large, so they are loaded from the CDN only when a page
 * actually contains math or diagrams.
 *
 * Rendered elements get `data-mz-rendered` equal to their `data-mz-src`, so the
 * DOM morph keeps them on the next render instead of re-rendering.
 */

const KATEX_VERSION = '0.16';
const MERMAID_VERSION = '11';

let katexPromise: Promise<any> | null = null;
let mermaidPromise: Promise<any> | null = null;
let mermaidCounter = 0;

function loadKatex(): Promise<any> {
  if (!katexPromise) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
    document.head.appendChild(link);
    katexPromise = import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/+esm`).then((m) => m.default ?? m);
  }
  return katexPromise;
}

function loadMermaid(theme: 'light' | 'dark'): Promise<any> {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/+esm`).then((m) => {
      const mermaid = m.default ?? m;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** Renders pending math and diagrams inside `root`. Never throws. */
export async function enhance(root: ParentNode, theme: 'light' | 'dark'): Promise<void> {
  const math = [...root.querySelectorAll<HTMLElement>('.mz-math')].filter((el) => el.dataset.mzRendered !== el.dataset.mzSrc);
  const diagrams = [...root.querySelectorAll<HTMLElement>('.mz-mermaid')].filter((el) => el.dataset.mzRendered !== el.dataset.mzSrc);

  if (math.length > 0) {
    try {
      const katex = await loadKatex();
      for (const el of math) {
        const tex = el.dataset.mzSrc ?? '';
        katex.render(tex, el, { displayMode: el.classList.contains('mz-math-display'), throwOnError: false });
        el.dataset.mzRendered = tex;
      }
    } catch (e) {
      console.warn('[memizy] LaTeX could not be rendered:', e);
    }
  }

  if (diagrams.length > 0) {
    try {
      const mermaid = await loadMermaid(theme);
      for (const el of diagrams) {
        const code = el.dataset.mzSrc ?? '';
        try {
          const { svg } = await mermaid.render(`mz-mermaid-${++mermaidCounter}`, code);
          el.innerHTML = svg;
        } catch (e) {
          el.classList.add('mz-mermaid-error');
          el.textContent = `Mermaid: ${(e as Error).message ?? e}`;
        }
        el.dataset.mzRendered = code;
      }
    } catch (e) {
      console.warn('[memizy] Mermaid could not be loaded:', e);
    }
  }
}
