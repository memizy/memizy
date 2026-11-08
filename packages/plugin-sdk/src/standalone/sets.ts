/**
 * The player's own sets in standalone mode (the game opened outside Memizy): an OQSE JSON
 * file, OQSE Markdown (notes), or `?set=<url>`. The validator comes from the CDN only when
 * a set is loaded, so the SDK bundle stays without it (and without Zod).
 */

import type { OQSEAnyItem, OQSEFile } from '@memizy/oqse';
import { itemsOfTypes } from './sampleSet';

/** What the SDK needs of `@memizy/oqse` to read a set. */
export interface SetReader {
  loadOQSEFile(input: unknown): { success: boolean; data?: OQSEFile; errors?: unknown[] };
  safeParseMarkdownSet(markdown: string): { success: boolean; data?: { file: OQSEFile }; error?: { message?: string } };
}

/** The validator of OQSE sets, from the CDN (the same major version as this SDK reads). */
export const OQSE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@memizy/oqse@1/+esm';

let reader: Promise<SetReader> | null = null;

/** Loads the set reader once (tests pass their own). */
export function loadSetReader(custom?: () => Promise<SetReader>): Promise<SetReader> {
  if (custom) return custom();
  reader ??= import(/* @vite-ignore */ OQSE_CDN_URL).then((m) => m as SetReader).catch((error) => {
    reader = null;
    throw error;
  });
  return reader;
}

export type ReadSet = { ok: true; file: OQSEFile; usable: OQSEAnyItem[] } | { ok: false; error: string };

function describe(errors: unknown[] | undefined): string {
  const first = errors?.[0] as { message?: unknown; path?: unknown } | string | undefined;
  if (!first) return 'not a valid OQSE set';
  if (typeof first === 'string') return first;
  const path = typeof first.path === 'string' && first.path ? ` (${first.path})` : '';
  return `${String(first.message ?? 'not a valid OQSE set')}${path}`;
}

/**
 * Reads a set from text: OQSE JSON, or OQSE Markdown (by the file name or when it is not
 * JSON). `types` are the item types the game plays; a set without any of them is refused.
 */
export async function readSet(text: string, name: string, types: readonly string[] | null, read: SetReader): Promise<ReadSet> {
  const trimmed = text.trimStart();
  const markdown = /\.(md|markdown)$/i.test(name) || !(trimmed.startsWith('{') || trimmed.startsWith('['));
  let file: OQSEFile | undefined;
  if (markdown) {
    const parsed = read.safeParseMarkdownSet(text);
    if (!parsed.success || !parsed.data) return { ok: false, error: parsed.error?.message ?? 'not a valid OQSE Markdown set' };
    file = parsed.data.file;
  } else {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    const loaded = read.loadOQSEFile(json);
    if (!loaded.success || !loaded.data) return { ok: false, error: describe(loaded.errors) };
    file = loaded.data;
  }
  const usable = itemsOfTypes(file.items as OQSEAnyItem[], types);
  if (!usable.length) return { ok: false, error: `none of its ${file.items.length} items is of a type this game plays (${(types ?? []).join(', ')})` };
  return { ok: true, file, usable };
}
