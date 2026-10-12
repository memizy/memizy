/**
 * The examples in the specification (oqse.md) must stay valid: a broken example
 * teaches authors and AI models the wrong thing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeValidateOQSEFile } from './fileValidation';
import { detectFeatures } from './features';

const spec = readFileSync(new URL('../oqse.md', import.meta.url), 'utf8');

/** The first ```json block after a heading. */
function jsonAfter(heading: string): unknown {
  const start = spec.indexOf(heading);
  const block = /```json\n([\s\S]*?)\n```/.exec(spec.slice(start));
  if (start === -1 || !block) throw new Error(`No JSON example after "${heading}"`);
  return JSON.parse(block[1]);
}

describe('specification examples', () => {
  it('the complete example file is strictly valid, without warnings', () => {
    const result = safeValidateOQSEFile(jsonAfter('## Complete Example File'));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('the complete example declares exactly the features it uses', () => {
    const file = safeValidateOQSEFile(jsonAfter('## Complete Example File')).data!;
    expect(detectFeatures(file)).toEqual(file.meta.requirements?.features);
  });
});
