// Converts pre-release OQSE files (0.2, 0.3) to 1.0: sets (*.oqse.json, OQSE *.json),
// OQSE Markdown (*.oqse.md) and plugin manifests in *.html. A tool for this repository only.
// Usage (from engine/): bun scripts/migrate-oqse/cli.ts <dir> [--apply]
// Dry run without --apply. Requires built packages (bun run build:packages).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { formatOQSEIssues, parseMarkdownSet, safeValidateOQSEFile } from '../../packages/oqse/dist/index.js';
import { safeParsePluginManifest, extractManifestFromHtml } from '../../packages/protocol/dist/index.js';
import { migrateMarkdownSet, migratePluginHtml, migrateSet, type MigrationResult } from './migrate';

const root = process.argv[2];
const apply = process.argv.includes('--apply');
if (!root) {
  console.error('Usage: bun scripts/migrate-oqse/cli.ts <dir> [--apply]');
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(json|md|html?)$/i.test(name)) yield path;
  }
}

/** Keeps the line endings, indentation and final newline of the original JSON. */
function stringify(original: string, json: unknown): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^\{\r?\n(\s+)"/.exec(original)?.[1] ?? '  ';
  return JSON.stringify(json, null, indent).replace(/\n/g, eol) + (original.endsWith('\n') ? eol : '');
}

let failed = 0;
let converted = 0;
for (const file of walk(resolve(root))) {
  const original = readFileSync(file, 'utf8');
  let migration: MigrationResult<string>;
  let status = 'valid';

  if (/\.html?$/i.test(file)) {
    if (!extractManifestFromHtml(original).success) continue; // not a plugin
    migration = migratePluginHtml(original);
    const manifest = extractManifestFromHtml(migration.result);
    const parsed = manifest.success ? safeParsePluginManifest(manifest.data) : null;
    if (!parsed?.success) status = `INVALID (${parsed ? parsed.errors.slice(0, 3).join(' | ') : 'no manifest'})`;
  } else if (/\.md$/i.test(file)) {
    if (!/^---\r?\n[\s\S]*?^oqse:/m.test(original)) continue; // not an OQSE Markdown set
    migration = migrateMarkdownSet(original);
    try {
      parseMarkdownSet(migration.result);
    } catch (e) {
      status = `INVALID (${(e as Error).message.split('\n')[0]})`;
    }
  } else {
    let json: any;
    try {
      json = JSON.parse(original);
    } catch {
      continue;
    }
    if (!json || typeof json !== 'object' || !json.meta || !Array.isArray(json.items)) continue; // not a set
    const set = migrateSet(json);
    migration = { ...set, result: stringify(original, set.result) };
    const check = safeValidateOQSEFile(set.result);
    if (!check.success) status = `INVALID (${formatOQSEIssues(check.errors).slice(0, 3).join(' | ')})`;
    else if (check.warnings.length) status = `valid, ${check.warnings.length} warning(s): ${formatOQSEIssues(check.warnings).slice(0, 2).join(' | ')}`;
  }

  if (status.startsWith('INVALID')) failed++;
  if (migration.changes.length) converted++;
  console.log(`${relative(resolve(root), file)}`);
  console.log(`  changes: ${migration.changes.join('; ') || 'none'}`);
  for (const note of migration.review) console.log(`  CHECK: ${note}`);
  console.log(`  → ${status}`);
  if (apply && migration.changes.length) writeFileSync(file, migration.result);
}

console.log(`\n${converted} file(s) ${apply ? 'converted' : 'to convert'}. ${apply ? '' : 'Dry run only (use --apply to write).'}`);
if (failed) {
  console.log(`${failed} file(s) are not valid OQSE 1.0 after the conversion: fix them by hand.`);
  process.exitCode = 1;
}
