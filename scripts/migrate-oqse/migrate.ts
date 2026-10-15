/**
 * Conversion of pre-release OQSE files to 1.0 (a tool for this repository only, not part of
 * the published packages: the library reads 1.x and never converts anything itself).
 *
 * Steps: 0.1 → 0.2 (renamed fields, `math` → `latex`), 0.2 → 0.3 (choices with IDs, answers
 * by ID) and 0.3 → 1.0 (no `trimWhitespace`,
 * `range` → `correctAnswer` ± `tolerance`, image `altText`, declared features). Things that
 * need a human decision are reported in `review`, never changed.
 */

import { convertLegacySource, detectFeatures, looksLikeLatex, normalizeAnswerText, type OQSEFile } from '../../packages/oqse/dist/index.js';

export const SCHEMA_URL = 'https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-v1.0.json';

type Rec = Record<string, any>;

export interface MigrationResult<T> {
  result: T;
  /** What the conversion changed. */
  changes: string[];
  /** What a human should check (nothing of it was changed). */
  review: string[];
}

// ============================================================================
// 0.1 → 0.2: consistent names of correct answers and shuffle flags, `math` → `latex`
// ============================================================================

/** Renames a key in place (keeps the key order); does nothing if it is missing. */
function rename(obj: Rec, from: string, to: string, changes: Set<string>, label: string): void {
  if (!(from in obj) || to in obj) return;
  rewrite(obj, { [from]: [to, obj[from]] });
  changes.add(label);
}

const stripDollars = (latex: unknown) => (typeof latex === 'string' ? latex.trim().replace(/^\$\$?|\$\$?$/g, '').trim() : latex);

function itemFrom01(item: Rec, changes: Set<string>): void {
  switch (item.type) {
    case 'true-false':
      rename(item, 'answer', 'correctAnswer', changes, 'true-false: answer → correctAnswer');
      return;
    case 'numeric-input':
      rename(item, 'value', 'correctAnswer', changes, 'numeric-input: value → correctAnswer');
      return;
    case 'short-answer':
      rename(item, 'answers', 'correctAnswers', changes, 'short-answer: answers → correctAnswers');
      return;
    case 'chess-puzzle':
      rename(item, 'answers', 'correctAnswers', changes, 'chess-puzzle: answers → correctAnswers');
      return;
    case 'mcq-single':
    case 'mcq-multi':
      rename(item, 'shuffleOptions', 'shuffle', changes, 'shuffleOptions → shuffle');
      return;
    case 'timeline':
      rename(item, 'randomize', 'shuffle', changes, 'timeline: randomize → shuffle');
      return;
    case 'math-input': {
      const before = JSON.stringify([item.correctAnswer, item.alternativeAnswers]);
      item.correctAnswer = stripDollars(item.correctAnswer);
      if (Array.isArray(item.alternativeAnswers)) item.alternativeAnswers = item.alternativeAnswers.map(stripDollars);
      if (JSON.stringify([item.correctAnswer, item.alternativeAnswers]) !== before) changes.add('math-input: answers without $');
      return;
    }
  }
}

function setFrom01(json: Rec, changes: Set<string>): void {
  const features: unknown = json.meta?.requirements?.features;
  if (Array.isArray(features) && features.includes('math')) {
    json.meta.requirements.features = features.map((f) => (f === 'math' ? 'latex' : f));
    changes.add('feature math → latex');
  }
  for (const item of json.items ?? []) itemFrom01(item, changes);
}

// ============================================================================
// 0.2 → 0.3: choices with IDs, answers by ID
// ============================================================================

/** a, b, …, z, aa, ab, … */
const letter = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letter(Math.floor(i / 26) - 1) + letter(i % 26));
const num = (prefix: string) => (i: number) => `${prefix}${i + 1}`;

/** Converts a list of texts to choices; `ids[i]` is the ID of the i-th text. */
function choices(texts: unknown, idOf: (i: number) => string, explanations?: unknown): { list: Rec[]; ids: string[] } {
  const arr = Array.isArray(texts) ? texts : [];
  const ids = arr.map((_, i) => idOf(i));
  const list = arr.map((text, i) => {
    if (text && typeof text === 'object') return text as Rec; // already a choice
    const choice: Rec = { id: ids[i], text };
    const explanation = Array.isArray(explanations) ? explanations[i] : undefined;
    if (typeof explanation === 'string' && explanation.trim()) choice.explanation = explanation;
    return choice;
  });
  return { list, ids };
}

/** Rebuilds the object with `replacements` in place of the old keys (keeps the key order). */
function rewrite(obj: Rec, replacements: Record<string, [string, unknown] | null>, extra: Record<string, unknown> = {}): void {
  const entries: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k in replacements) {
      const r = replacements[k];
      if (r) entries.push(r);
    } else entries.push([k, v]);
  }
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
  Object.assign(obj, extra);
}

function itemFrom02(item: Rec, changes: Set<string>): void {
  switch (item.type) {
    case 'mcq-single':
    case 'mcq-multi': {
      if (!Array.isArray(item.options) || typeof item.options[0] === 'object') return;
      const { list, ids } = choices(item.options, letter, item.optionExplanations);
      if (item.type === 'mcq-single') rewrite(item, { options: ['options', list], correctIndex: ['correctId', ids[item.correctIndex]], optionExplanations: null });
      else rewrite(item, { options: ['options', list], correctIndices: ['correctIds', (item.correctIndices as number[]).map((i) => ids[i])], optionExplanations: null });
      changes.add(`${item.type}: choices with IDs`);
      return;
    }
    case 'fill-in-select': {
      for (const blank of Object.values(item.blanks ?? {}) as Rec[]) {
        if (!Array.isArray(blank.options) || typeof blank.options[0] === 'object') continue;
        const { list, ids } = choices(blank.options, letter);
        rewrite(blank, { options: ['options', list], correctIndex: ['correctId', ids[blank.correctIndex]] });
        changes.add('fill-in-select: choices with IDs');
      }
      return;
    }
    case 'sort-items': {
      if (!Array.isArray(item.items) || typeof item.items[0] === 'object') return;
      const { list, ids } = choices(item.items, num('i'));
      rewrite(item, { items: ['items', list] }, { correctOrder: ids }); // 0.2 listed the items in the correct order
      changes.add('sort-items: choices + correctOrder');
      return;
    }
    case 'match-pairs': {
      if (!Array.isArray(item.prompts) || typeof item.prompts[0] === 'object') return;
      const p = choices(item.prompts, num('p'));
      const m = choices(item.matches, num('m'));
      rewrite(item, { prompts: ['prompts', p.list], matches: ['matches', m.list] }, { pairs: Object.fromEntries(p.ids.map((id, i) => [id, m.ids[i]])) });
      changes.add('match-pairs: choices + pairs');
      return;
    }
    case 'match-complex': {
      if (!Array.isArray(item.leftItems) || typeof item.leftItems[0] === 'object') return;
      const l = choices(item.leftItems, num('l'));
      const r = choices(item.rightItems, num('r'));
      rewrite(item, {
        leftItems: ['leftItems', l.list],
        rightItems: ['rightItems', r.list],
        connections: ['connections', (item.connections as [number, number][]).map(([a, b]) => [l.ids[a], r.ids[b]])],
      });
      changes.add('match-complex: choices with IDs');
      return;
    }
    case 'categorize': {
      if (!Array.isArray(item.categories) || typeof item.categories[0] === 'object') return;
      const c = choices(item.categories, num('c'));
      for (const entry of item.items ?? []) rewrite(entry, { correctCategoryIndex: ['correctCategoryId', c.ids[entry.correctCategoryIndex]] });
      rewrite(item, { categories: ['categories', c.list] });
      changes.add('categorize: choices with IDs');
      return;
    }
    case 'matrix': {
      if (!Array.isArray(item.rows) || typeof item.rows[0] === 'object') return;
      const rows = choices(item.rows, num('r'));
      const cols = choices(item.columns, num('c'));
      rewrite(item, {
        rows: ['rows', rows.list],
        columns: ['columns', cols.list],
        correctCells: ['correctCells', (item.correctCells as [number, number][]).map(([a, b]) => [rows.ids[a], cols.ids[b]])],
      });
      changes.add('matrix: choices with IDs');
      return;
    }
    case 'diagram-label': {
      if (!Array.isArray(item.labels) || typeof item.labels[0] === 'object') return;
      const labels = choices(item.labels, letter);
      (item.zones as Rec[]).forEach((zone, i) => {
        const index = zone.correctLabelIndex;
        rewrite(zone, { correctLabelIndex: null });
        const withId: Rec = { id: `z${i + 1}`, ...zone, correctLabelId: labels.ids[index] };
        rewrite(zone, Object.fromEntries(Object.keys(zone).map((k) => [k, null])), withId);
      });
      rewrite(item, { labels: ['labels', labels.list] });
      changes.add('diagram-label: choices with IDs');
      return;
    }
  }
}

// ============================================================================
// 0.3 → 1.0
// ============================================================================

/** `assets/img/cell-diagram.png?v=2` → "cell diagram" (as `loadOQSEFile` does). */
function altTextFromFileName(value: string): string {
  const name = String(value).split(/[?#]/)[0].split('/').pop() ?? '';
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
}

function fillAltTexts(assets: Rec | undefined, where: string, changes: Set<string>, review: string[]): void {
  for (const [key, media] of Object.entries(assets ?? {}) as [string, Rec][]) {
    if (media?.type !== 'image' || (typeof media.altText === 'string' && media.altText.trim())) continue;
    media.altText = altTextFromFileName(media.value) || key;
    changes.add('altText of images derived from file names');
    review.push(`${where}.${key}: altText "${media.altText}" was derived from the file name – write a real description.`);
  }
}

/** Accepted answers that differ only in diacritics ("byt" / "být"): the new default makes them equal. */
function diacriticsClash(answers: unknown): string[] | null {
  if (!Array.isArray(answers)) return null;
  const seen = new Map<string, string>();
  for (const answer of answers.filter((a): a is string => typeof a === 'string')) {
    const key = normalizeAnswerText(answer);
    const other = seen.get(key);
    if (other !== undefined && normalizeAnswerText(other, { ignoreDiacritics: false }) !== normalizeAnswerText(answer, { ignoreDiacritics: false })) return [other, answer];
    seen.set(key, answer);
  }
  return null;
}

function itemTo10(item: Rec, index: number, latex: boolean, changes: Set<string>, review: string[]): void {
  const where = `items[${index}]`;
  if ((item.type === 'short-answer' || item.type === 'fill-in-blanks') && 'trimWhitespace' in item) {
    delete item.trimWhitespace;
    changes.add('trimWhitespace removed (whitespace is always trimmed)');
  }
  if (item.type === 'numeric-input' && item.range && typeof item.range === 'object') {
    const { min, max } = item.range as { min: number; max: number };
    rewrite(item, { range: null, correctAnswer: ['correctAnswer', (min + max) / 2] }, { tolerance: Math.abs(max - min) / 2 });
    changes.add('numeric-input: range → correctAnswer ± tolerance');
  }
  if (item.ignoreDiacritics === undefined) {
    const lists = item.type === 'short-answer' ? [item.correctAnswers] : item.type === 'fill-in-blanks' ? Object.values(item.blanks ?? {}) : [];
    for (const list of lists) {
      const clash = diacriticsClash(list);
      if (clash) review.push(`${where}: answers "${clash[0]}" and "${clash[1]}" differ only in diacritics; ignoreDiacritics is now true by default – set it to false if the difference matters.`);
    }
  }
  if (!latex) {
    for (const value of Object.values(item)) {
      if (typeof value === 'string' && looksLikeLatex(value)) {
        review.push(`${where}: the text looks like a LaTeX formula, but the set does not declare "latex".`);
        break;
      }
    }
  }
  if (item.type === 'math-input' && 'correctAnswer' in item && !('correctAnswers' in item)) {
    const answers = [item.correctAnswer, ...(Array.isArray(item.alternativeAnswers) ? item.alternativeAnswers : [])].map(stripDollars);
    rewrite(item, { correctAnswer: ['correctAnswers', answers], alternativeAnswers: null });
    changes.add('math-input: correctAnswer + alternativeAnswers → correctAnswers');
  }
  if (item.type === 'math-input' && 'tolerance' in item) {
    delete item.tolerance;
    changes.add('math-input: tolerance removed (answers are compared as LaTeX)');
  }
  if (item.type === 'match-complex' && 'leftItems' in item && !('prompts' in item)) {
    rewrite(item, { leftItems: ['prompts', item.leftItems], rightItems: ['matches', item.rightItems] });
    changes.add('match-complex: leftItems / rightItems → prompts / matches');
  }
  fillAltTexts(item.assets, `${where}.assets`, changes, review);
}

/** Converts an OQSE set (0.2, 0.3 or 1.x) to 1.0. The input is not changed. */
export function migrateSet(input: unknown): MigrationResult<Rec> {
  const json = structuredClone(input) as Rec;
  const changes = new Set<string>();
  const review: string[] = [];
  const version = String(json.version ?? '');
  const [major, minor] = version.split('.').map(Number);
  const pre = !(major >= 1);
  if (pre && !(minor >= 2)) setFrom01(json, changes); // 0.1 or no version
  if (pre && !(minor >= 3)) for (const item of json.items ?? []) itemFrom02(item, changes);
  if (!/^1\.\d+$/.test(version)) {
    json.version = '1.0';
    changes.add(`version ${version || '(none)'} → 1.0`);
  }
  if (typeof json.$schema === 'string' && json.$schema !== SCHEMA_URL) {
    json.$schema = SCHEMA_URL;
    changes.add('$schema');
  }
  const meta: Rec = json.meta ?? {};
  const latex = (meta.requirements?.features ?? []).includes('latex');
  (json.items ?? []).forEach((item: Rec, i: number) => itemTo10(item, i, latex, changes, review));
  fillAltTexts(meta.assets, 'meta.assets', changes, review);
  // Sources: `type` + `value` of the drafts and release candidates → kind, url / doi / isbn.
  if (Array.isArray(meta.sourceMaterials)) {
    meta.sourceMaterials = meta.sourceMaterials.map((source: Rec) => {
      const converted = source && typeof source === 'object' ? convertLegacySource(source) : null;
      if (!converted) return source;
      changes.add('sourceMaterials type/value → kind, url / doi / isbn');
      return converted;
    });
  }

  // Declare the features the content uses (as an editor does when saving).
  const declared: string[] = meta.requirements?.features ?? [];
  const missing = detectFeatures(json as OQSEFile).filter((f: string) => f !== 'html' && !declared.includes(f));
  if (missing.length) {
    meta.requirements = { ...(meta.requirements ?? {}), features: [...declared, ...missing] };
    changes.add(`requirements.features + ${missing.join(', ')}`);
  }
  return { result: json, changes: [...changes], review };
}

/** OQSE Markdown: only the version changes (a set of notes). */
export function migrateMarkdownSet(text: string): MigrationResult<string> {
  const changes: string[] = [];
  const result = text.replace(/^(oqse:\s*)(["']?)(0\.\d+)\2\s*$/m, (_m, key: string, quote: string, version: string) => {
    changes.push(`version ${version} → 1.0`);
    return `${key}${quote || '"'}1.0${quote || '"'}`;
  });
  return { result, changes, review: [] };
}

const DATA_ISLAND_RE = /(<script\b[^>]*\btype\s*=\s*["']application\/oqse-manifest\+json["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i;

/** A plugin HTML file: the manifest's `version` 0.x → 1.0 (the manifest structure is the same). */
export function migratePluginHtml(html: string): MigrationResult<string> {
  const changes: string[] = [];
  const review: string[] = [];
  const result = html.replace(DATA_ISLAND_RE, (_m, open: string, body: string, close: string) => {
    const updated = body.replace(/("version"\s*:\s*)"(0\.\d+)"/, (_v, key: string, version: string) => {
      changes.push(`manifest version ${version} → 1.0`);
      return `${key}"1.0"`;
    });
    try {
      const manifest = JSON.parse(updated);
      const types = manifest?.capabilities?.types;
      if (Array.isArray(types) && types.length === 1 && types[0] === 'note') {
        review.push('The game declares only "note": if it uses no questions at all, use "set": "none" in appSpecific.memizy instead.');
      }
    } catch {
      review.push('The manifest is not valid JSON.');
    }
    return open + updated + close;
  });
  return { result, changes, review };
}
