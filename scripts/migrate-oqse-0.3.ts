// One-off conversion of OQSE sets from 0.2 to 0.3 (choices with IDs, answers by ID).
// Usage (from engine/): bun scripts/migrate-oqse-0.3.ts <dir> [--apply]
// Converts every *.oqse.json and *.oqse.md under <dir>; dry run without --apply.
// Requires a built packages/oqse (bun run build:packages).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';

const oqse = await import(pathToFileURL(resolve(import.meta.dir, '../packages/oqse/dist/index.js')).href);
const { safeValidateOQSEFile, formatOQSEIssues } = oqse;

const root = process.argv[2];
const apply = process.argv.includes('--apply');
if (!root) {
  console.error('Usage: bun scripts/migrate-oqse-0.3.ts <dir> [--apply]');
  process.exit(1);
}
const NEW_SCHEMA = 'https://cdn.jsdelivr.net/npm/@memizy/oqse@0.3/schemas/oqse-v0.3.json';

type Rec = Record<string, any>;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.oqse.json') || name.endsWith('.oqse.md')) yield p;
  }
}

/** a, b, …, z, aa, ab, … */
const letter = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letter(Math.floor(i / 26) - 1) + letter(i % 26));
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
const num = (prefix: string) => (i: number) => `${prefix}${i + 1}`;

/** Rebuilds the object with `replacements` in place of the old keys (keeps the key order). */
function rewrite(obj: Rec, replacements: Record<string, [string, unknown] | null>, extra: Record<string, unknown> = {}) {
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

function migrateItem(item: Rec, changes: Set<string>) {
  switch (item.type) {
    case 'mcq-single':
    case 'mcq-multi': {
      if (!Array.isArray(item.options) || typeof item.options[0] === 'object') return;
      const { list, ids } = choices(item.options, letter, item.optionExplanations);
      if (item.type === 'mcq-single') rewrite(item, { options: ['options', list], correctIndex: ['correctId', ids[item.correctIndex]], optionExplanations: null });
      else rewrite(item, { options: ['options', list], correctIndices: ['correctIds', (item.correctIndices as number[]).map((i) => ids[i])], optionExplanations: null });
      changes.add(`${item.type}: choices`);
      return;
    }
    case 'fill-in-select': {
      for (const blank of Object.values(item.blanks ?? {}) as Rec[]) {
        if (!Array.isArray(blank.options) || typeof blank.options[0] === 'object') continue;
        const { list, ids } = choices(blank.options, letter);
        rewrite(blank, { options: ['options', list], correctIndex: ['correctId', ids[blank.correctIndex]] });
        changes.add('fill-in-select: choices');
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
      changes.add('match-complex: choices');
      return;
    }
    case 'categorize': {
      if (!Array.isArray(item.categories) || typeof item.categories[0] === 'object') return;
      const c = choices(item.categories, num('c'));
      for (const entry of item.items ?? []) rewrite(entry, { correctCategoryIndex: ['correctCategoryId', c.ids[entry.correctCategoryIndex]] });
      rewrite(item, { categories: ['categories', c.list] });
      changes.add('categorize: choices');
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
      changes.add('matrix: choices');
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
      changes.add('diagram-label: choices');
      return;
    }
  }
}

function migrateJson(original: string, changes: Set<string>): { text: string; json: Rec } {
  const json = JSON.parse(original);
  if (json.$schema && json.$schema !== NEW_SCHEMA) { json.$schema = NEW_SCHEMA; changes.add('$schema'); }
  if (json.version !== '0.3') { changes.add(`version ${json.version} -> 0.3`); json.version = '0.3'; }
  for (const item of json.items ?? []) migrateItem(item, changes);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^\{\r?\n(\s+)"/.exec(original)?.[1] ?? '  ';
  return { json, text: JSON.stringify(json, null, indent).replace(/\n/g, eol) + (original.endsWith('\n') ? eol : '') };
}

function migrateMarkdown(original: string, changes: Set<string>): string {
  // Markdown sets contain only notes: only the version changes.
  return original.replace(/^(oqse:\s*)(["']?)0\.2\2\s*$/m, (_m, key: string, quote: string) => {
    changes.add('version 0.2 -> 0.3');
    return `${key}${quote || '"'}0.3${quote || '"'}`;
  });
}

let failed = 0;
for (const file of walk(resolve(root))) {
  const original = readFileSync(file, 'utf8');
  const changes = new Set<string>();
  let text: string;
  let status = 'VALID';
  if (file.endsWith('.md')) {
    text = migrateMarkdown(original, changes);
    try {
      oqse.parseMarkdownSet(text);
    } catch (e) {
      status = `INVALID (${(e as Error).message.split('\n')[0]})`;
    }
  } else {
    const migrated = migrateJson(original, changes);
    text = migrated.text;
    const result = safeValidateOQSEFile(migrated.json);
    if (!result.success) status = `INVALID (${formatOQSEIssues(result.errors).slice(0, 3).join(' | ')})`;
  }
  if (status !== 'VALID') failed++;
  console.log(`${relative(resolve(root), file)}\n  ${[...changes].join(', ') || 'no changes'}\n  -> ${status}`);
  if (apply && changes.size > 0) writeFileSync(file, text);
}
console.log(apply ? '\nApplied.' : '\nDry run only (use --apply to write).');
if (failed) {
  console.log(`${failed} file(s) are not valid OQSE 0.3 after the conversion: fix them by hand.`);
  process.exitCode = 1;
}
