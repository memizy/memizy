/**
 * Rendering of OQSE Rich Content (Markdown, LaTeX, Mermaid, media tags) to
 * safe HTML. LaTeX and Mermaid are rendered after the HTML is in the page
 * (see enhance.ts), so `ui.text` stays synchronous.
 */

import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// Content of a set lives inside the game's DOM, so it must not act like the game:
// no `data-*` (`data-act`, `data-local`…), no `id` (the game's elements, morph keys),
// no form controls (they would join the game's forms; a GFM task list keeps its disabled checkboxes) and only a few style properties
// (OQSE Security: no UI redressing).
const SANITIZE_CONFIG = {
  ADD_ATTR: ['target'],
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ['id', 'name', 'form', 'formaction'],
  FORBID_TAGS: ['form', 'button', 'select', 'option', 'optgroup', 'textarea', 'datalist', 'output', 'style'],
};

const STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
  'vertical-align',
]);
// Keywords, lengths, percentages, hex colors and rgb()/hsl() colors; no url(), var(), expressions.
const STYLE_VALUE_RE = /^(?:[a-z-]+|#[0-9a-f]{3,8}|-?[\d.]+(?:%|px|em|rem)?|(?:rgba?|hsla?)\([\d\s.,%/]+\))(?:\s+(?:[a-z-]+|#[0-9a-f]{3,8}|-?[\d.]+(?:%|px|em|rem)?|(?:rgba?|hsla?)\([\d\s.,%/]+\)))*$/i;

/** Keeps only harmless typographic declarations of a `style` attribute. */
export function safeStyle(style: string): string {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (STYLE_PROPERTIES.has(property) && STYLE_VALUE_RE.test(value)) kept.push(`${property}: ${value}`);
  }
  return kept.join('; ');
}

// Without a DOM (Node: server code, tests) DOMPurify has no hooks; importing must still work.
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'input') return;
    const element = node as Element;
    if (element.getAttribute('type') !== 'checkbox' || !element.hasAttribute('disabled')) element.remove();
  });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Links open in a new tab (inside the host's iframe a link would replace the game).
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.hasAttribute?.('style')) {
      const style = safeStyle(node.getAttribute('style') ?? '');
      if (style) node.setAttribute('style', style);
      else node.removeAttribute('style');
    }
  });
}
import { detokenizeOqseTags, tokenizeOqseTags, shiftHeadings, type MediaObject, type NoteItem } from '@memizy/oqse';

export interface RichTextContext {
  /** The set declares the `latex` feature (otherwise `$` is a literal character). */
  latex: boolean;
  /** Media lookup for `<asset:key />` (item assets first, then set assets). */
  resolveMedia(key: string): MediaObject | undefined;
  locale: string;
}

// Mermaid sources collected during one (synchronous) render; injected after sanitizing,
// because DOMPurify drops attributes containing "-->" (which Mermaid arrows do).
// The placeholder has a random part so that authors cannot forge it.
let mermaidBlocks: { token: string; code: string }[] = [];

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    code({ text, lang }) {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        const token = `mzmermaid${mermaidBlocks.length}x${Math.random().toString(36).slice(2, 10)}`;
        mermaidBlocks.push({ token, code: text });
        return `<div class="mz-mermaid">${token}</div>\n`;
      }
      return false;
    },
  },
});

const UNKNOWN_OQSE_TAG_RE = /<[a-z][a-z0-9-]*:[a-zA-Z0-9_-]+\s*\/>/g;
const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g;
// Inline math: no space after the opening / before the closing `$`, not escaped, single line.
const INLINE_MATH_RE = /(^|[^\\$])\$(?!\s)([^$\n]*?[^\s\\$])\$(?!\d)/g;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders Rich Content to sanitized HTML. */
export function renderRichText(source: string | null | undefined, ctx: RichTextContext, options: { inline?: boolean } = {}): string {
  if (source === null || source === undefined || source === '') return '';
  const tokenized = tokenizeOqseTags(String(source));
  const tokens = tokenized.tokens;
  // OQSE tags of a later version (`<name:key />` other than asset / blank) are removed (OQSE "Reserved tag syntax").
  const withoutTags = tokenized.text.replace(UNKNOWN_OQSE_TAG_RE, '');

  // Protect math from the Markdown parser (underscores, asterisks, backslashes).
  const math = new Map<string, { tex: string; display: boolean }>();
  let text = withoutTags;
  if (ctx.latex) {
    const protect = (tex: string, display: boolean) => {
      const token = `mzmath${math.size}x${Math.random().toString(36).slice(2, 8)}`;
      math.set(token, { tex, display });
      return token;
    };
    text = text.replace(DISPLAY_MATH_RE, (_m, tex: string) => protect(tex.trim(), true));
    text = text.replace(INLINE_MATH_RE, (_m, before: string, tex: string) => before + protect(tex, false));
  }

  mermaidBlocks = [];
  const parsed = options.inline ? (marked.parseInline(text) as string) : (marked.parse(text) as string);
  const diagrams = mermaidBlocks;
  let html = DOMPurify.sanitize(parsed, SANITIZE_CONFIG);

  for (const { token, code } of diagrams) {
    html = html.replace(
      `<div class="mz-mermaid">${token}</div>`,
      `<div class="mz-mermaid" data-mz-src="${escapeHtml(code)}">${escapeHtml(code)}</div>`,
    );
  }

  for (const [token, { tex, display }] of math) {
    const tag = display ? 'div' : 'span';
    html = html.replace(token, `<${tag} class="mz-math${display ? ' mz-math-display' : ''}" data-mz-src="${escapeHtml(tex)}">${escapeHtml(tex)}</${tag}>`);
  }

  return detokenizeOqseTags(html, tokens, {
    assetReplacer: (key) => renderMedia(key, ctx.resolveMedia(key)),
    blankReplacer: (key) => `<span class="mz-blank" data-mz-blank="${escapeHtml(key)}"></span>`,
  });
}

function renderMedia(key: string, media: MediaObject | undefined): string {
  if (!media || !isMediaUrl(media.value)) return `<span class="mz-missing-asset">[${escapeHtml(key)}]</span>`;
  const src = escapeHtml(media.value);
  const caption = media.caption ? `<figcaption>${escapeHtml(media.caption)}</figcaption>` : '';
  const size = `${media.width ? ` width="${Number(media.width)}"` : ''}${media.height ? ` height="${Number(media.height)}"` : ''}`;
  let element: string;
  switch (media.type) {
    case 'image':
      element = `<img src="${src}" alt="${escapeHtml(media.altText ?? '')}"${size} loading="lazy">`;
      break;
    case 'audio':
      element = `<audio controls src="${src}"></audio>`;
      break;
    case 'video':
      element = `<video controls src="${src}"${size}></video>`;
      break;
    case 'model':
      element = `<span class="mz-asset-model">${escapeHtml(media.altText ?? key)}</span>`;
      break;
    default:
      // A media type of a later OQSE version: a link (its fallback, OQSE "Open Values").
      element = `<a class="mz-asset-link" href="${src}" target="_blank" rel="noopener noreferrer">${escapeHtml(media.altText ?? media.caption ?? key)}</a>`;
  }
  return caption ? `<figure class="mz-media">${element}${caption}</figure>` : element;
}

/** A media value the page can load: a web URL, or an object URL made from a host asset. */
export function isMediaUrl(value: string): boolean {
  return /^(https?:|blob:)/i.test(value);
}

/** Renders a whole note: title, content and the hidden part (relative headings, SPEC of OQSE). */
export function renderNoteHtml(note: NoteItem, ctx: RichTextContext, options: { titleLevel?: number } = {}): string {
  const level = Math.min(6, Math.max(1, Math.round(options.titleLevel ?? 1)));
  const offset = level - 1;
  const title = note.title ? `<h${level} class="mz-note-title">${escapeHtml(note.title)}</h${level}>` : '';
  const content = renderRichText(shiftHeadings(note.content, offset), ctx);
  const hidden = note.hiddenContent
    ? `<details class="mz-note-hidden"><summary>${ctx.locale.startsWith('cs') ? 'Zobrazit' : 'Show'}</summary>${renderRichText(shiftHeadings(note.hiddenContent, offset), ctx)}</details>`
    : '';
  return `<article class="mz-note">${title}${content}${hidden}</article>`;
}
