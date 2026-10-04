/**
 * Study sets available in Memizy Play: built-in sample sets, uploaded files
 * (.oqse.json / .json / .oqse.md) and sets loaded from a URL. Uploaded and
 * URL sets are kept in IndexedDB (same origin as memizy.com).
 */

import { createStore, del, entries, set as idbSet } from 'idb-keyval';
import { loadOQSEFile, parseMarkdownSet, formatOQSEIssues, type OQSEFile, type OQSEIssue } from '@memizy/oqse';
import animals from '@/data/sets/animals.oqse.json';
import workshop from '@/data/sets/workshop.oqse.json';
import generalKnowledge from '@/data/sets/general-knowledge.oqse.json';
import testSuite from '@/data/sets/test-suite.oqse.json';
import notesMarkdown from '@/data/sets/web-app-notes.oqse.md?raw';

export interface StudySet {
  /** Stable key (`builtin:…`, or the set id for stored sets). */
  key: string;
  source: 'builtin' | 'upload' | 'url';
  title: string;
  file: OQSEFile;
  warnings: OQSEIssue[];
}

export type LoadSetResult = { success: true; set: StudySet } | { success: false; errors: string[] };

const store = createStore('memizy-play-sets', 'sets');

/** Parses JSON or OQSE Markdown text into a set (tolerant load). */
export function parseSetText(text: string, fileName: string, source: StudySet['source']): LoadSetResult {
  let data: unknown;
  if (fileName.toLowerCase().endsWith('.md')) {
    try {
      data = parseMarkdownSet(text).file;
    } catch (e) {
      return { success: false, errors: [(e as Error).message] };
    }
  } else {
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { success: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
    }
  }
  const loaded = loadOQSEFile(data);
  if (!loaded.success || !loaded.data) return { success: false, errors: formatOQSEIssues(loaded.errors) };
  const file = loaded.data;
  return {
    success: true,
    set: { key: source === 'builtin' ? `builtin:${file.meta.id}` : file.meta.id, source, title: file.meta.title, file, warnings: [...loaded.errors, ...loaded.warnings] },
  };
}

function builtin(data: unknown, name: string): StudySet {
  const result = parseSetText(typeof data === 'string' ? data : JSON.stringify(data), name, 'builtin');
  if (!result.success) throw new Error(`Built-in set ${name} is invalid: ${result.errors.join('; ')}`);
  return result.set;
}

export const BUILTIN_SETS: StudySet[] = [
  builtin(animals, 'animals.oqse.json'),
  builtin(workshop, 'workshop.oqse.json'),
  builtin(generalKnowledge, 'general-knowledge.oqse.json'),
  builtin(notesMarkdown, 'web-app-notes.oqse.md'),
  builtin(testSuite, 'test-suite.oqse.json'),
];

export async function loadStoredSets(): Promise<StudySet[]> {
  try {
    const all = await entries<string, { source: StudySet['source']; text: string; name: string }>(store);
    return all.flatMap(([, value]) => {
      const result = parseSetText(value.text, value.name, value.source);
      return result.success ? [result.set] : [];
    });
  } catch {
    return []; // IndexedDB unavailable (private mode…)
  }
}

/** Parses and stores an uploaded file. */
export async function importSetFile(file: File): Promise<LoadSetResult> {
  const text = await file.text();
  const result = parseSetText(text, file.name, 'upload');
  if (result.success) await idbSet(result.set.key, { source: 'upload', text, name: file.name }, store).catch(() => {});
  return result;
}

/** Downloads, parses and stores a set from a URL (e.g. the open library on GitHub). */
export async function importSetFromUrl(url: string): Promise<LoadSetResult> {
  let text: string;
  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, errors: [`HTTP ${response.status} ${response.statusText}`] };
    text = await response.text();
  } catch (e) {
    return { success: false, errors: [(e as Error).message] };
  }
  const name = new URL(url, location.href).pathname.split('/').pop() ?? 'set.json';
  const result = parseSetText(text, name, 'url');
  if (result.success) await idbSet(result.set.key, { source: 'url', text, name }, store).catch(() => {});
  return result;
}

export async function removeStoredSet(key: string): Promise<void> {
  await del(key, store).catch(() => {});
}
