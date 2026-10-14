#!/usr/bin/env node
/**
 * Adds `.js` to the relative imports of the generated type declarations
 * (`./plugin` → `./plugin.js`, `./relay` → `./relay/index.js`), so the
 * published typings also resolve with `moduleResolution: node16 / nodenext`
 * (they already do with `bundler`).
 *
 * Usage (after the build of a package): node ../../scripts/dts-extensions.mjs dist
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

function declarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return declarations(path);
    return name.endsWith('.d.ts') ? [path] : [];
  });
}

let changed = 0;
for (const file of declarations(root)) {
  const source = readFileSync(file, 'utf8');
  const result = source.replace(SPECIFIER_RE, (match, before, quote, specifier) => {
    if (/\.(js|mjs|cjs|json)$/.test(specifier)) return match;
    const base = resolve(dirname(file), specifier);
    if (existsSync(`${base}.d.ts`)) return `${before}${quote}${specifier}.js${quote}`;
    if (existsSync(join(base, 'index.d.ts'))) return `${before}${quote}${specifier.replace(/\/$/, '')}/index.js${quote}`;
    throw new Error(`${file}: cannot resolve the type import "${specifier}"`);
  });
  if (result !== source) {
    writeFileSync(file, result);
    changed++;
  }
}
console.log(`dts-extensions: ${changed} declaration files updated in ${root}`);
