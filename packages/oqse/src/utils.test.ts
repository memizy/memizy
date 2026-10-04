import { describe, it, expect } from 'vitest';
import { validateJsonDepth } from './utils';

function createNestedObject(levels: number): unknown {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  for (let i = 0; i < levels; i += 1) {
    const next: Record<string, unknown> = {};
    current.child = next;
    current = next;
  }

  return root;
}

describe('validateJsonDepth', () => {
  it('accepts objects nested to depth 9', () => {
    const data = createNestedObject(9);
    expect(() => validateJsonDepth(data)).not.toThrow();
  });

  it('throws for objects nested to depth 11', () => {
    const data = createNestedObject(11);
    expect(() => validateJsonDepth(data)).toThrow(
      'OQSE Security Error: Maximum nesting depth exceeded limit of 10 levels.'
    );
  });
});
