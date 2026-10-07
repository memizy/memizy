/**
 * JSON diff producing patches in the mutative / immer format (`{ op, path, value }`),
 * used for per-player views (`playerView`): the authority diffs the last view it sent
 * to a device against the new one.
 */

import type { Patches } from 'mutative';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Patch = Patches[number];

const isObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function diffJson(before: unknown, after: unknown, path: (string | number)[] = [], out: Patch[] = []): Patch[] {
  if (before === after) return out;
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(before)) {
      if (!(key in after)) out.push({ op: 'remove', path: [...path, key] } as Patch);
    }
    for (const [key, value] of Object.entries(after)) {
      if (!(key in before)) out.push({ op: 'add', path: [...path, key], value } as Patch);
      else diffJson(before[key], value, [...path, key], out);
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < after.length; i++) diffJson(before[i], after[i], [...path, i], out);
    return out;
  }
  out.push({ op: 'replace', path, value: after } as Patch);
  return out;
}
