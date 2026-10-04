import { readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'dist/src/index.d.ts';
const targetPath = 'dist/index.d.ts';

const content = readFileSync(sourcePath, 'utf8').replaceAll("'./", "'./src/");
writeFileSync(targetPath, content);
