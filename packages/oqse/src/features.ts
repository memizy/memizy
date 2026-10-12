/**
 * "Detecting Features from Content" in the OQSE specification: the features a set's
 * Rich Content uses, so a forgotten declaration in `meta.requirements` does not matter.
 */

import { OFFICIAL_FEATURE_KEYS } from './manifest';
import type { OQSEFile } from './oqse';
import { findRawHtml } from './richTextProcessor';
import { itemRichText, metaRichText } from './richTextFields';

/** Languages written right to left (BCP 47 primary language subtags). */
export const RTL_LANGUAGES: readonly string[] = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'dv', 'ug'];

const BLOCK_FEATURES: Record<string, string> = { mermaid: 'mermaid', smiles: 'smiles', abc: 'abc-notation' };

const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]*)/gm;
const FENCED_BLOCK_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const MATH_RE = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;

/** Markdown constructs (checked on text without code blocks and, with `latex`, without formulas). */
const MARKDOWN_RES: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]+\S/m, // heading
  /(\*\*|__)(?=\S)[^\n]*?\S\1/, // strong
  /(^|[^\w*])\*(?=[^\s*])[^*\n]*?[^\s*]\*(?![\w*])/m, // emphasis *x*
  /(^|[^\w])_(?=[^\s_])[^_\n]*?[^\s_]_(?!\w)/m, // emphasis _x_ (not inside words)
  /~~(?=\S)[^\n]*?\S~~/, // strikethrough
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/m, // list item
  /^ {0,3}>/m, // block quote
  /!?\[[^\]\n]*\]\([^)\n]*\)/, // link or image
  /`[^`\n]+`/, // inline code
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*\|/m, // table separator row
  /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/m, // horizontal rule
];

/** Text between two `$` that looks like a formula. */
const LOOKS_LIKE_LATEX_RE = /\$\$[^$]*[\\^_{}][^$]*\$\$|\$[^$\n]*[\\^_{}][^$\n]*\$/;

function primaryLanguage(tag: string | undefined): string | undefined {
  return tag?.split(/[-_]/)[0]?.toLowerCase();
}

function textFeatures(text: string, latex: boolean, found: Set<string>): void {
  for (const match of text.matchAll(FENCE_RE)) {
    found.add('markdown');
    const language = match[1].toLowerCase();
    if (language) found.add(BLOCK_FEATURES[language] ?? 'syntax-highlighting');
  }
  if (findRawHtml(text, { latex })) found.add('html');
  let prose = text.replace(FENCED_BLOCK_RE, '');
  if (latex) prose = prose.replace(MATH_RE, '');
  if (MARKDOWN_RES.some((re) => re.test(prose))) found.add('markdown');
}

/**
 * The features the Rich Content of a set uses (in registry order). `latex` is never
 * detected (a `$` may be a price); `rtl` comes from `meta.language` and items' `lang`.
 */
export function detectFeatures(file: Pick<OQSEFile, 'meta' | 'items'>): string[] {
  const latex = file.meta.requirements?.features?.includes('latex') ?? false;
  const found = new Set<string>();
  for (const [, text] of metaRichText(file.meta)) textFeatures(text, latex, found);
  for (const item of file.items) for (const [, text] of itemRichText(item)) textFeatures(text, latex, found);
  const languages = [file.meta.language, ...file.items.map((item) => item.lang)];
  if (languages.some((tag) => RTL_LANGUAGES.includes(primaryLanguage(tag) ?? ''))) found.add('rtl');
  return OFFICIAL_FEATURE_KEYS.filter((key) => found.has(key));
}

/** Declared `requirements.features` together with the detected ones. */
export function effectiveFeatures(file: Pick<OQSEFile, 'meta' | 'items'>): string[] {
  return [...new Set([...(file.meta.requirements?.features ?? []), ...detectFeatures(file)])];
}

/** Whether a Rich Content text looks like it contains a formula (`latex` heuristic, a warning only). */
export function looksLikeLatex(text: string): boolean {
  return LOOKS_LIKE_LATEX_RE.test(text.replace(FENCED_BLOCK_RE, '').replace(/`[^`\n]+`/g, ''));
}
