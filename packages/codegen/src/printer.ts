/**
 * Prints a content type definition back to a `*.schema.ts` source file.
 * Used when a content type is created / edited from the admin UI, so the UI
 * and hand-written files share the same source of truth.
 */
import type { ContentTypeDefinition, FieldDefinition } from '@opencms/schema';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function lit(value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => lit(v, indent)).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    return `{ ${entries.map(([k, v]) => `${IDENT.test(k) ? k : lit(k, indent)}: ${lit(v, indent)}`).join(', ')} }`;
  }
  throw new Error(`Cannot print value of type ${typeof value}`);
}

function printField(field: FieldDefinition): string {
  const arg: Record<string, unknown> = { id: field.id };
  if (field.label) arg.label = field.label;
  if (field.description) arg.description = field.description;
  if (field.required) arg.required = true;
  if (field.localizable) arg.localizable = true;
  if (field.unique) arg.unique = true;
  else if (field.indexed) arg.indexed = true;
  for (const [k, v] of Object.entries(field.options ?? {})) {
    if (v !== undefined && v !== null && v !== '') arg[k] = v;
  }
  return `    ${field.name}: f.${field.kind}(${lit(arg, '')}),`;
}

export function printSchemaFile(def: ContentTypeDefinition): string {
  const lines = [
    '// Source of truth for this content type. Edit by hand or from the admin',
    '// Content Type Builder (which rewrites this file), then run `opencms migrate:create`.',
    "import { defineContentType, f } from '@opencms/schema';",
    '',
    'export default defineContentType({',
    `  id: ${lit(def.id, '')},`,
    `  apiId: ${lit(def.apiId, '')},`,
    `  displayName: ${lit(def.displayName, '')},`,
    ...(def.description ? [`  description: ${lit(def.description, '')},`] : []),
    '  fields: {',
    ...def.fields.map(printField),
    '  },',
    '});',
    '',
  ];
  return lines.join('\n');
}
