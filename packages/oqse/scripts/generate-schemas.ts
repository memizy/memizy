// scripts/generate-schemas.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as z from 'zod'; // Importujeme hlavní zod objekt

// Naimportujeme tvá hlavní Zod schémata
import { OQSEFileSchema } from '../src/oqseValidation';
import { OQSEManifestSchema } from '../src/manifestValidation';
import { OQSEProgressSchema } from '../src/progressValidation';
import { OQSEHeaderSchema } from '../src/headerValidation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemasDir = path.resolve(__dirname, '../schemas');

if (!fs.existsSync(schemasDir)) {
  fs.mkdirSync(schemasDir);
}

console.log('Generuji JSON schémata pomocí nativního Zod 4...');

// 1. Vygenerování schématu pro OQSE File (v0.1)
const oqseJsonSchema = z.toJSONSchema(OQSEFileSchema, {
  target: "draft-07" // JSON Schema Draft 7 pro maximální kompatibilitu
});

fs.writeFileSync(
  path.join(schemasDir, 'oqse-v0.1.json'),
  JSON.stringify(oqseJsonSchema, null, 2)
);
console.log('✅ Vytvořeno: schemas/oqse-v0.1.json');

// 2. Vygenerování schématu pro OQSE Manifest (v0.1)
const manifestJsonSchema = z.toJSONSchema(OQSEManifestSchema, {
  target: "draft-07"
});

fs.writeFileSync(
  path.join(schemasDir, 'oqse-manifest-v0.1.json'),
  JSON.stringify(manifestJsonSchema, null, 2)
);
console.log('✅ Vytvořeno: schemas/oqse-manifest-v0.1.json');

const progressJsonSchema = z.toJSONSchema(OQSEProgressSchema, { target: "draft-07" });
fs.writeFileSync(
  path.join(schemasDir, 'oqse-progress-v0.1.json'),
  JSON.stringify(progressJsonSchema, null, 2)
);
console.log('✅ Vytvořeno: schemas/oqse-progress-v0.1.json');

const headerJsonSchema = z.toJSONSchema(OQSEHeaderSchema, { target: 'draft-07' });
fs.writeFileSync(
  path.join(schemasDir, 'oqse-header-v0.1.json'),
  JSON.stringify(headerJsonSchema, null, 2)
);
console.log('✅ Vytvořeno: schemas/oqse-header-v0.1.json');
