// Generates src/knownProperties.generated.ts: the property paths every official item type
// defines in this OQSE version (for `mustUnderstand` without Zod at run time).
import fs from 'node:fs';
import path from 'node:path';
import { OQSEItemSchema } from '../src/oqseValidation';
import { knownPropertiesSource } from '../src/knownPropertiesSource';

const target = path.resolve(import.meta.dirname, '../src/knownProperties.generated.ts');
fs.writeFileSync(target, knownPropertiesSource(OQSEItemSchema as never));
console.log('✅ Created: src/knownProperties.generated.ts');
