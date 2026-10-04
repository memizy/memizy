import type { FeatureProfile } from './oqse';

export interface TokenMap {
  [tokenId: string]: {
    type: 'asset' | 'blank';
    key: string;
    originalTag: string;
  };
}

export interface RichTextProcessingOptions {
  /** * Function to parse Markdown to HTML (e.g., `marked.parse`). 
   * For Tier 1, this should ideally be configured to escape raw HTML.
   */
  markdownParser: (markdown: string) => string;
  
  /** * Function to sanitize HTML (e.g., `DOMPurify.sanitize`).
   * REQUIRED if the set declares the 'html' feature (Tier 2).
   */
  htmlSanitizer?: (html: string) => string;
  
  /** Callback to render an <asset:key /> tag into HTML (e.g., <img src="...">) */
  assetReplacer?: (key: string) => string;
  
  /** Callback to render a <blank:key /> tag into HTML (e.g., <input type="text">) */
  blankReplacer?: (key: string) => string;
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

/**
 * Finds the first raw HTML tag written by the author, ignoring code, math (when `latex` is on),
 * Markdown autolinks (`<https://...>`), HTML comments and OQSE tags. Returns `null` if there is none.
 */
export function findRawHtml(text: string, options: RawHtmlCheckOptions = {}): string | null {
  let stripped = text
    .replace(new RegExp(OQSE_TAG_PATTERN.source, 'gi'), '')
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '')
    .replace(AUTOLINK_RE, '');
  if (options.latex) stripped = stripped.replace(DISPLAY_MATH_RE, '').replace(INLINE_MATH_RE, '');
  return HTML_TAG_RE.exec(stripped)?.[0] ?? null;
}

/**
 * Step 2 (Tier 1): Strict HTML Validation.
 * If 'html' is not allowed, any raw HTML tags written by the user must cause a validation error.
 */
export function validateTier1Markdown(textWithoutOqseTags: string, options: RawHtmlCheckOptions = {}): void {
  const tag = findRawHtml(textWithoutOqseTags, options);
  if (tag) {
    throw new Error(
      `OQSE Security Error: Raw HTML tags are not allowed in Tier 1 (Pure Markdown), found ${tag}. ` +
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

  const isTier2HtmlEnabled = requirements?.features?.includes('html') ?? false;

  // 1. TOKENIZE (Protect internal tags)
  const { text: tokenizedMarkdown, tokens } = tokenizeOqseTags(rawContent);

  // 2. TIER 1 VALIDATION (Fail fast if raw HTML is present but not allowed)
  if (!isTier2HtmlEnabled) {
    validateTier1Markdown(tokenizedMarkdown, { latex: requirements?.features?.includes('latex') ?? false });
  }

  // 3. MARKDOWN TO HTML
  let processedHtml = options.markdownParser(tokenizedMarkdown);

  // 4. TIER 2 SANITIZATION
  if (isTier2HtmlEnabled) {
    if (!options.htmlSanitizer) {
      throw new Error(
        "OQSE Security Error: Set requires 'html' (Tier 2), but no htmlSanitizer (like DOMPurify) was provided to the options."
      );
    }
    processedHtml = options.htmlSanitizer(processedHtml);
  }

  // 5. DETOKENIZE (Inject final interactive elements)
  return detokenizeOqseTags(processedHtml, tokens, options);
}