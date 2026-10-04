# OQSE SDK

Official TypeScript SDK for the Open Quiz & Study Exchange ecosystem, published as @memizy/oqse.

🚀 **[OQSE Web Validator](https://memizy.github.io/oqse-specification/)** - Online tool for easy testing and debugging of OQSE JSON structures in the browser.

This repository contains:
- The human-readable specifications split into four standalone documents:
  - [OQSE (Study Sets)](./oqse.md)
  - [OQSEM (Application Manifests)](./oqse-manifest.md)
  - [OQSEP (User Progress)](./oqse-progress.md)
   - [OQSEH (Set Headers)](./oqse-header.md)
- Runtime validators built with Zod.
- Manually authored TypeScript types for developer ergonomics.
- Auto-generated JSON Schemas distributed with the package.

## Package

- Name: @memizy/oqse
- Purpose: validate, parse, and type OQSE, OQSEM (Application Manifest), and OQSEP (User Progress) data.

## Schemas

The auto-generated JSON Schemas are published with this repository and are available at the following URLs:

- Core OQSE Schema: https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-v0.1.json
- Manifest Schema: https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-manifest-v0.1.json
- Progress Schema: https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-progress-v0.1.json
- Header Schema: https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-header-v0.1.json

## Architecture & Single Source of Truth

The human-readable Markdown specifications are the **absolute single source of truth** for the OQSE ecosystem.

1. **The Specifications**
   The four Markdown files ([oqse.md](./oqse.md), [oqse-manifest.md](./oqse-manifest.md), [oqse-progress.md](./oqse-progress.md), and [oqse-header.md](./oqse-header.md)) constitute the normative documentation for concepts, rules, and semantics. 

2. **Zod Schemas**
   Runtime validators (`*Validation.ts`) are implementations. They **MUST match** the rules defined in the Markdown specs. They are not the source of truth; if they disagree with the text spec, the code is considered a bug.

3. **TypeScript Types**
   TypeScript types (`oqse.ts`, `manifest.ts`, `progress.ts`) manually mirror the Zod schemas for better Developer Experience. They must also strictly adhere to the Markdown specifications.

4. JSON schemas are strictly auto-generated using npm run generate:schemas and contributors MUST NOT edit them manually.
   If validation behavior changes, update the Zod schemas first, then regenerate.

## Development

Install dependencies:

```bash
npm install
```

Build and regenerate schemas:

```bash
npm run build
```

Generate only JSON schemas:

```bash
npm run generate:schemas
```

Run tests:

```bash
npm test
```

## Contributing Rule

Never edit files in schemas/ by hand. Always regenerate via npm run generate:schemas.
