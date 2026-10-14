import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeValidateOQSEFile } from './fileValidation';

// The validator page (docs/index.html, GitHub Pages) offers this set as its sample.
describe('docs/test-suite.oqse.json', () => {
  it('is a valid OQSE 1.0 file', () => {
    const set = JSON.parse(readFileSync(new URL('../docs/test-suite.oqse.json', import.meta.url), 'utf8'));
    const result = safeValidateOQSEFile(set);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});
