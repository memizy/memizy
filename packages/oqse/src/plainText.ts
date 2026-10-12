/**
 * `toPlainText` – the fallback of the `markdown` feature (and of `latex`, `html` and the
 * blocks) from the OQSE specification: Rich Content as plain text, for applications
 * that draw text themselves (e.g. on a canvas).
 */

import { resolveAsset } from './assets';
import type { OQSEAnyItem, OQSEMeta } from './oqse';
import { OQSE_TAG_PATTERN } from './richTextProcessor';

export interface PlainTextOptions {
  /** The set declares `latex`: `$…$` / `$$…$$` are formulas (shown as their source). */
  latex?: boolean;
  /** For `<asset:key />`: the image's `altText` (item assets first, then the set's). */
  item?: Pick<OQSEAnyItem, 'assets'>;
  meta?: Pick<OQSEMeta, 'assets'>;
}

/**
 * Rich Content as plain text: Markdown markup and HTML tags removed, links and images
 * replaced by their text, `<asset:key />` by the media's `altText`, `<blank:token />` by
 * `____`, formulas by their source without `$`, list items as `• `.
 */
export function toPlainText(text: string, options: PlainTextOptions = {}): string {
  let s = text.replace(/\r\n?/g, '\n');

  // OQSE tags.
  s = s.replace(new RegExp(OQSE_TAG_PATTERN.source, 'gi'), (_m, kind: string, key: string) =>
    kind.toLowerCase() === 'blank' ? '____' : resolveAsset(key, options.item, options.meta)?.altText ?? '',
  );

  // Fenced code blocks: keep the code, drop the fences.
  s = s.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, (_m, _fence, code: string) => code.replace(/\n$/, ''));

  // Formulas: the source without delimiters.
  if (options.latex) {
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => tex.trim());
    s = s.replace(/\$([^$\n]+)\$/g, '$1');
  }

  // Inline code, images, links, autolinks.
  s = s.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code: string) => code.trim());
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/<((?:https?|mailto):[^\s<>]+|[^\s<>@]+@[^\s<>@]+)>/g, '$1');

  // HTML: line breaks, then every other tag (and comments).
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^<>]*>/g, '');

  // Block markup at line starts.
  s = s
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) // table separator
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // headings
        .replace(/^\s*(>\s?)+/, '') // quotes
        .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1• ') // task lists
        .replace(/^(\s*)[-*+]\s+/, '$1• ') // bullet lists
        .replace(/^\s*\|(.*)\|\s*$/, (_m, cells: string) => cells.split('|').map((c) => c.trim()).join(' | ')) // tables
        .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, ''), // horizontal rules
    )
    .join('\n');

  // Emphasis and strikethrough (underscores only at word boundaries, not in snake_case).
  s = s
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '$1')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2');

  // Backslash escapes, then blank lines.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>$])/g, '$1');
  return s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
