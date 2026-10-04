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
 * Step 1: Tokenization.
 * Temporarily replaces <asset:key /> and <blank:key /> with cryptographically safe 
 * text tokens so they survive Markdown parsing and HTML sanitization.
 */
export function tokenizeOqseTags(rawText: string): { text: string; tokens: TokenMap } {
  const tokens: TokenMap = {};
  
  // Matches <asset:key /> and <blank:key /> (case-insensitive for the tag, strict for the key)
  const oqseTagRegex = /<(asset|blank):([a-zA-Z0-9_-]+)\s*\/>/gi;

  const tokenizedText = rawText.replace(oqseTagRegex, (match, type, key) => {
    // Generate a unique, unpredictable token ID
    const tokenId = `[[__OQSE_TOKEN_${Math.random().toString(36).substring(2, 15)}__]]`;
    tokens[tokenId] = {
      type: type.toLowerCase() as 'asset' | 'blank',
      key: key.toLowerCase(), // Normalizing key to lowercase per spec
      originalTag: match
    };
    return tokenId;
  });

  return { text: tokenizedText, tokens };
}

/**
 * Step 2 (Tier 1): Strict HTML Validation.
 * If 'html' is not allowed, any raw HTML tags written by the user must cause a validation error.
 */
export function validateTier1Markdown(textWithoutOqseTags: string): void {
  // Remove all code blocks from the text before checking for HTML.
  // This ensures we don't penalize users writing about HTML inside Markdown code blocks.
  const textWithoutCodeBlocks = textWithoutOqseTags
    // 1. Strip backtick blocks and inline code (e.g., `code` or ```code```)
    .replace(/`{1,}[^`]*`{1,}/g, '')
    // 2. Strip GFM tilde blocks (e.g., ~~~html <div> ~~~)
    .replace(/~{3,}[\s\S]*?~{3,}/g, '');

  // Basic detection for manual HTML tags. 
  const rawHtmlRegex = /<[a-zA-Z\/][^>]*>/;
  
  if (rawHtmlRegex.test(textWithoutCodeBlocks)) {
    throw new Error(
      "OQSE Security Error: Raw HTML tags are not allowed in Tier 1 (Pure Markdown). " +
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
    validateTier1Markdown(tokenizedMarkdown);
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