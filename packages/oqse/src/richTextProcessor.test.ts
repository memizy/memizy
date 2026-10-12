import { describe, it, expect } from 'vitest';
import { assertNoRawHtml, findRawHtml, prepareRichTextForDisplay } from './richTextProcessor';
import type { FeatureProfile } from './oqse';

const sanitizer = (html: string) => `[SANITIZED] ${html}`;

describe('Rich Text Processor - raw HTML and sanitizing', () => {
  it('without the html feature, raw HTML is an error', () => {
    expect(() => assertNoRawHtml('Here is a <strong>forbidden</strong> tag.')).toThrow(/raw HTML is not allowed/);
  });

  it('allows <sub>, <sup> and <br> without attributes, and HTML in code', () => {
    expect(findRawHtml('H<sub>2</sub>O, m<sup>2</sup><br>line<br/>x<br />')).toBeNull();
    expect(findRawHtml('<sub class="x">2</sub>')).toBe('<sub class="x">');
    expect(() => assertNoRawHtml('Showing code: `<strong>hello</strong>`')).not.toThrow();
    expect(() => assertNoRawHtml("Here is a GFM block:\n~~~\n<div class='test'>\n~~~\n")).not.toThrow();
  });

  it('tokenizes, parses, sanitizes and detokenizes OQSE tags', () => {
    const result = prepareRichTextForDisplay('Image: <asset:img_01 /> and a blank <blank:word1 />.', undefined, {
      markdownParser: (text: string) => `<p>${text}</p>`,
      htmlSanitizer: sanitizer,
      assetReplacer: (key) => `<img src="mock-${key}.jpg" />`,
      blankReplacer: (key) => `<input data-key="${key}" />`,
    });
    expect(result).toContain('[SANITIZED] <p>Image: <img src="mock-img_01.jpg" />');
    expect(result).toContain('<input data-key="word1" />');
    expect(result).not.toContain('<asset:img_01 />');
  });

  it('always sanitizes, with and without the html feature', () => {
    const reqs: FeatureProfile = { features: ['html'] };
    expect(prepareRichTextForDisplay("Safe <span style='color:red'>text</span>.", reqs, { markdownParser: (t) => t, htmlSanitizer: sanitizer })).toContain('[SANITIZED] Safe');
    expect(prepareRichTextForDisplay('[link](javascript:alert(1))', undefined, { markdownParser: (t) => t, htmlSanitizer: sanitizer })).toContain('[SANITIZED]');
  });

  it('requires a sanitizer', () => {
    expect(() => prepareRichTextForDisplay('Text', undefined, { markdownParser: (t: string) => t } as never)).toThrow(/htmlSanitizer/);
  });
});
