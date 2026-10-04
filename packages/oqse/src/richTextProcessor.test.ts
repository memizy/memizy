import { describe, it, expect } from 'vitest';
import { prepareRichTextForDisplay, validateTier1Markdown } from './richTextProcessor';
import type { FeatureProfile } from './oqse';

describe('Rich Text Processor - Security & Tiers', () => {
  it('Tier 1: Should throw an error if raw HTML is used', () => {
    const maliciousText = "Here is a <strong>forbidden</strong> tag.";
    expect(() => validateTier1Markdown(maliciousText)).toThrow(/Raw HTML tags are not allowed/);
  });

  it('Tier 1: Should NOT throw if HTML is inside a backtick code block', () => {
    const validText = "Showing code: `<strong>hello</strong>`";
    expect(() => validateTier1Markdown(validText)).not.toThrow();
  });

  it('Tier 1: Should NOT throw if HTML is inside a tilde (~~~) code block', () => {
    const validText = "Here is a GFM block:\n~~~\n<div class='test'>\n~~~\n";
    expect(() => validateTier1Markdown(validText)).not.toThrow();
  });

  it('Pipeline: Should correctly tokenize, parse, and detokenize OQSE tags', () => {
    const rawInput = "Image: <asset:img_01 /> and a blank <blank:word1 />.";
    
    // Fake markdown parser for testing
    const mockMarkdownParser = (text: string) => `<p>${text}</p>`;
    
    const result = prepareRichTextForDisplay(rawInput, undefined, {
      markdownParser: mockMarkdownParser,
      assetReplacer: (key) => `<img src="mock-${key}.jpg" />`,
      blankReplacer: (key) => `<input data-key="${key}" />`
    });

    expect(result).toContain('<img src="mock-img_01.jpg" />');
    expect(result).toContain('<input data-key="word1" />');
    expect(result).not.toContain('<asset:img_01 />'); // Original tags must disappear
  });

  it('Tier 2: Should apply HTML Sanitizer if html feature is declared', () => {
    const rawInput = "Safe <span style='color:red'>text</span>.";
    const reqs: FeatureProfile = { features: ['html'] } as any;
    
    const result = prepareRichTextForDisplay(rawInput, reqs, {
      markdownParser: (text) => text,
      // Fake sanitizer that adds a prefix
      htmlSanitizer: (html) => `[SANITIZED] ${html}`
    });

    expect(result).toContain('[SANITIZED] Safe');
  });

  it('Tier 2: Should throw if html feature is declared but no sanitizer is provided', () => {
    const reqs: FeatureProfile = { features: ['html'] } as any;
    expect(() => {
      prepareRichTextForDisplay("Text", reqs, { markdownParser: (t) => t });
    }).toThrow(/no htmlSanitizer/);
  });
});
