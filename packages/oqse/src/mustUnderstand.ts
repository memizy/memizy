/**
 * Must-understand properties (OQSE "Must-Understand Properties"): an item lists properties
 * it depends on; an application that does not support all of them skips the item instead
 * of showing it or checking it wrong. No Zod here: `checkAnswer` (in the plugin SDK) uses it.
 */

import { KNOWN_ITEM_PROPERTIES } from './knownProperties.generated';

/**
 * The entries of `item.mustUnderstand` that this OQSE version does not define for the item's
 * type and that are not in `understood` (properties the application supports itself, e.g.
 * its own `x-` properties). Empty: the item can be shown and checked. Custom `x-` types: always
 * empty (the application that defines the type decides).
 */
export function missingMustUnderstand(item: { type: string; mustUnderstand?: unknown }, understood: Iterable<string> = []): string[] {
  const entries = Array.isArray(item.mustUnderstand) ? item.mustUnderstand.filter((e): e is string => typeof e === 'string') : [];
  if (entries.length === 0 || item.type.startsWith('x-')) return [];
  const known = new Set(KNOWN_ITEM_PROPERTIES[item.type] ?? []);
  for (const name of understood) known.add(name);
  return entries.filter((entry) => !known.has(entry));
}
