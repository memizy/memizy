import type { FeatureProfile } from './oqse';
import { shiftHeadings } from './markdownUtils';

export interface TokenMap {
  [tokenId: string]: {
    type: 'asset' | 'blank';
    key: string;
    originalTag: string;
  };
}

export interface RichTextProcessingOptions {
  /** Function to parse Markdown to HTML (e.g., `marked.parse`). */
  markdownParser: (markdown: string) => string;
  
  /**
   * Function to sanitize HTML (e.g., `DOMPurify.sanitize`). Always applied: even pure
   * Markdown can produce unsafe links.
   */
  htmlSanitizer: (html: string) => string;
  
  /** Callback to render an <asset:key /> tag into HTML (e.g., <img src="...">) */
  assetReplacer?: (key: string) => string;
  
  /** Callback to render a <blank:key /> tag into HTML (e.g., <input type="text">) */
  blankReplacer?: (key: string) => string;

  /**
   * Shifts Markdown heading levels before rendering (clamped to 1-6), so content fits the
   * plugin's layout. Note content headings start at level 2 (the note title is level 1);
   * e.g. a plugin that shows the note title as h3 can pass 2.
   */
  headingOffset?: number;
}

/**
 * Pattern of OQSE inline tags: `<asset:key />` and `<blank:token />` (tag name is case-insensitive).
 * Asset keys are normalized to lowercase before lookup.
 */
export const OQSE_TAG_PATTERN = /<(asset|blank):([a-zA-Z0-9_-]+)\s*\/>/gi;

/** Returns the (lowercased) asset keys referenced via `<asset:key />` in a Rich Content string. */
export function findAssetKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(new RegExp(OQSE_TAG_PATTERN.source, 'gi'))) {
    if (match[1].toLowerCase() === 'asset') keys.push(match[2].toLowerCase());
  }
  return keys;
}

/**
 * Step 1: Tokenization.
 * Temporarily replaces <asset:key /> and <blank:key /> with unpredictable alphanumeric
 * tokens so they survive Markdown parsing and HTML sanitization unchanged.
 * (Tokens must not contain Markdown syntax such as `_` or `*`, otherwise the parser alters them.)
 */
export function tokenizeOqseTags(rawText: string): { text: string; tokens: TokenMap } {
  const tokens: TokenMap = {};

  const tokenizedText = rawText.replace(new RegExp(OQSE_TAG_PATTERN.source, 'gi'), (match, type: string, key: string) => {
    let tokenId: string;
    do {
      tokenId = `oqsetoken${Math.random().toString(36).slice(2, 14)}x`;
    } while (tokenId in tokens || rawText.includes(tokenId));
    const tagType = type.toLowerCase() as 'asset' | 'blank';
    tokens[tokenId] = {
      type: tagType,
      key: tagType === 'asset' ? key.toLowerCase() : key, // asset keys are case-insensitive
      originalTag: match,
    };
    return tokenId;
  });

  return { text: tokenizedText, tokens };
}

export interface RawHtmlCheckOptions {
  /** Whether the set declares the `latex` feature (`$...$` segments are then ignored). */
  latex?: boolean;
}

const FENCED_CODE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE_RE = /(`+)[\s\S]*?\1/g;
const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
const AUTOLINK_RE = /<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/;
/** Tags allowed without the `html` feature, without attributes: sub- and superscripts, line breaks. */
const ALWAYS_ALLOWED_HTML_RE = /<\/?(?:sub|sup)>|<br\s*\/?>/gi;

/**
 * Finds the first raw HTML tag written by the author, ignoring code, math (when `latex` is on),
 * Markdown autolinks (`<https://...>`), HTML comments, OQSE tags and the tags allowed without
 * the `html` feature (`<sub>`, `<sup>`, `<br>` without attributes). Returns `null` if there is none.
 */
export function findRawHtml(text: string, options: RawHtmlCheckOptions = {}): string | null {
  let stripped = text
    .replace(new RegExp(OQSE_TAG_PATTERN.source, 'gi'), '')
    .replace(ALWAYS_ALLOWED_HTML_RE, '')
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '')
    .replace(AUTOLINK_RE, '');
  if (options.latex) stripped = stripped.replace(DISPLAY_MATH_RE, '').replace(INLINE_MATH_RE, '');
  return HTML_TAG_RE.exec(stripped)?.[0] ?? null;
}

/**
 * Step 2: without the `html` feature, raw HTML (other than `<sub>`, `<sup>`, `<br>`) is an error.
 */
export function assertNoRawHtml(textWithoutOqseTags: string, options: RawHtmlCheckOptions = {}): void {
  const tag = findRawHtml(textWithoutOqseTags, options);
  if (tag) {
    throw new Error(
      `OQSE Security Error: raw HTML is not allowed without the 'html' feature, found ${tag}. ` +
      "If the set requires HTML formatting, it MUST declare the 'html' feature in meta.requirements."
    );
  }
}

/**
 * Step 4: Detokenization.
 * Replaces the safe tokens back with the final interactive HTML elements.
 */
export function detokenizeOqseTags(
  safeHtml: string, 
  tokens: TokenMap, 
  options: Pick<RichTextProcessingOptions, 'assetReplacer' | 'blankReplacer'>
): string {
  let finalText = safeHtml;
  
  for (const [tokenId, data] of Object.entries(tokens)) {
    let replacement = data.originalTag; // Fallback to original if no replacer provided
    
    if (data.type === 'asset' && options.assetReplacer) {
      replacement = options.assetReplacer(data.key);
    } else if (data.type === 'blank' && options.blankReplacer) {
      replacement = options.blankReplacer(data.key);
    }
    
    // Replace the token in the HTML
    finalText = finalText.replace(tokenId, replacement);
  }
  
  return finalText;
}

/**
 * Main Facade for rendering OQSE Rich Content securely.
 * Executes the complete Tokenization -> Validation -> Parsing -> Sanitization -> Detokenization pipeline.
 */
export function prepareRichTextForDisplay(
  rawContent: string, 
  requirements: FeatureProfile | undefined,
  options: RichTextProcessingOptions
): string {
  if (!rawContent) return '';

  if (typeof options.htmlSanitizer !== 'function') {
    throw new Error('OQSE Security Error: an htmlSanitizer (like DOMPurify) is required, the rendered HTML is always sanitized.');
  }
  const htmlAllowed = requirements?.features?.includes('html') ?? false;

  // 1. TOKENIZE (Protect internal tags)
  const { text: tokenizedMarkdown, tokens } = tokenizeOqseTags(shiftHeadings(rawContent, options.headingOffset ?? 0));

  // 2. RAW HTML (fail fast when it is not allowed)
  if (!htmlAllowed) assertNoRawHtml(tokenizedMarkdown, { latex: requirements?.features?.includes('latex') ?? false });

  // 3. MARKDOWN TO HTML, 4. SANITIZATION (always)
  const processedHtml = options.htmlSanitizer(options.markdownParser(tokenizedMarkdown));

  // 5. DETOKENIZE (Inject final interactive elements)
  return detokenizeOqseTags(processedHtml, tokens, options);
}