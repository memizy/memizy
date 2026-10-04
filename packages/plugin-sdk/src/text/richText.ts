/**
 * Rendering of OQSE Rich Content (Markdown, LaTeX, Mermaid, media tags) to
 * safe HTML. LaTeX and Mermaid are rendered after the HTML is in the page
 * (see enhance.ts), so `ui.text` stays synchronous.
 */

import { Marked } from 'marked';
import DOMPurify from 'dompurify';
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
let mermaidBlocks: string[] = [];

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    code({ text, lang }) {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        mermaidBlocks.push(text);
        return `<div class="mz-mermaid">mzmermaid${mermaidBlocks.length - 1}x</div>\n`;
      }
      return false;
    },
  },
});

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
  const { text: withoutTags, tokens } = tokenizeOqseTags(String(source));

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
  let html = DOMPurify.sanitize(parsed, { ADD_ATTR: ['target'] });

  diagrams.forEach((code, i) => {
    html = html.replace(
      `<div class="mz-mermaid">mzmermaid${i}x</div>`,
      `<div class="mz-mermaid" data-mz-src="${escapeHtml(code)}">${escapeHtml(code)}</div>`,
    );
  });

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
  if (!media || !isSafeUrl(media.value)) return `<span class="mz-missing-asset">[${escapeHtml(key)}]</span>`;
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
    default:
      element = `<span class="mz-asset-model">${escapeHtml(media.altText ?? key)}</span>`;
  }
  return caption ? `<figure class="mz-media">${element}${caption}</figure>` : element;
}

function isSafeUrl(value: string): boolean {
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
