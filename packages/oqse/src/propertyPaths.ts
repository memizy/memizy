/**
 * Property paths an item schema defines (for `mustUnderstand`, OQSE "Must-Understand
 * Properties"). Lists and maps are passed through: `options.text` is the `text` of every
 * option, `blanks.correctId` the `correctId` of every blank. Used by the build to generate
 * `knownProperties.generated.ts` (so that `checkAnswer` needs no Zod) and by its test.
 */

type SchemaLike = { _zod: { def: any } };

/** All dotted property paths of `schema` (prefixes included), up to `maxDepth` levels. */
export function propertyPaths(schema: SchemaLike, maxDepth = 6): string[] {
  const paths = new Set<string>();
  const visit = (node: SchemaLike, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    const def = node._zod.def;
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'nonoptional':
      case 'readonly':
      case 'catch':
        return visit(def.innerType, prefix, depth);
      case 'pipe':
        return visit(def.in, prefix, depth);
      case 'lazy':
        return visit(def.getter(), prefix, depth);
      case 'array':
        return visit(def.element, prefix, depth);
      case 'record':
        return visit(def.valueType, prefix, depth);
      case 'union':
        for (const option of def.options as SchemaLike[]) visit(option, prefix, depth);
        return;
      case 'intersection':
        visit(def.left, prefix, depth);
        visit(def.right, prefix, depth);
        return;
      case 'object':
        for (const [key, field] of Object.entries(def.shape as Record<string, SchemaLike>)) {
          const path = prefix ? `${prefix}.${key}` : key;
          paths.add(path);
          visit(field, path, depth + 1);
        }
        return;
      default:
        return;
    }
  };
  visit(schema, '', 0);
  return [...paths].sort();
}
