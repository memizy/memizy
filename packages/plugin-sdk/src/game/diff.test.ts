import { describe, expect, it } from 'vitest';
import { apply } from 'mutative';
import { diffJson } from './diff';

describe('diffJson', () => {
  const cases: [unknown, unknown][] = [
    [{ a: 1, b: { c: [1, 2, 3] } }, { a: 2, b: { c: [1, 5, 3] }, d: 'x' }],
    [{ list: [1, 2] }, { list: [1, 2, 3] }],
    [{ gone: true, keep: { x: null } }, { keep: { x: 0 } }],
    [{ deep: { a: { b: { c: 1 } } } }, { deep: { a: { b: { c: 2, d: [] } } } }],
    [{ v: [1, { a: 1 }] }, { v: 'now a string' }],
    [{ same: { x: [1] } }, { same: { x: [1] } }],
  ];
  it.each(cases)('patches %j into %j', (before, after) => {
    const patches = diffJson(before, after);
    expect(apply(structuredClone(before) as object, patches)).toEqual(after);
  });

  it('is empty for equal values', () => {
    expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });
});
