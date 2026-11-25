/**
 * Prints a content type definition back to a `*.schema.ts` source file.
 * Used when a content type is created / edited from the admin UI, so the UI
 * and hand-written files share the same source of truth.
 */
import type { ContentGroupDefinition, ContentTypeDefinition, FieldDefinition, LocaleSettings, ThemeDefinition } from '@opencloudcms/schema';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function lit(value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
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
  if (field.readOnly) arg.readOnly = true;
  for (const [k, v] of Object.entries(field.options ?? {})) {
    if (v !== undefined && v !== null && v !== '') arg[k] = v;
  }
  return `    ${field.name}: f.${field.kind}(${lit(arg, '')}),`;
}

export function printSchemaFile(def: ContentTypeDefinition): string {
  const lines = [
    '// Source of truth for this content type. Edit by hand or from the admin',
    '// Content Type Builder (which rewrites this file), then run `opencloudcms migrate:create`.',
    "import { defineContentType, f } from '@opencloudcms/schema';",
    '',
    'export default defineContentType({',
    `  id: ${lit(def.id, '')},`,
    `  apiId: ${lit(def.apiId, '')},`,
    `  displayName: ${lit(def.displayName, '')},`,
    ...(def.group ? [`  group: ${lit(def.group, '')},`] : []),
    ...(def.description ? [`  description: ${lit(def.description, '')},`] : []),
    ...(def.review ? ['  review: true,'] : []),
    ...(def.private ? ['  private: true,'] : []),
    '  fields: {',
    ...def.fields.map(printField),
    '  },',
    '});',
    '',
  ];
  return lines.join('\n');
}

export function printContentGroupsFile(groups: ContentGroupDefinition[]): string {
  return [
    '// Content groups. Managed by OpenCloudCMS: edit by hand or from the admin',
    '// Content Type Builder (which rewrites this file).',
    "import { defineContentGroups } from '@opencloudcms/schema';",
    '',
    'export default defineContentGroups([',
    ...groups.map((g) => `  ${lit({ key: g.key, title: g.title, order: g.order }, '')},`),
    ']);',
    '',
  ].join('\n');
}

export function printLocalesFile(s: LocaleSettings): string {
  return [
    '// Supported locales. Managed by OpenCloudCMS: edit by hand or from the admin',
    '// Settings > Languages (which rewrites this file).',
    "import { defineLocales } from '@opencloudcms/schema';",
    '',
    'export default defineLocales({',
    `  defaultLocale: ${lit(s.defaultLocale, '')},`,
    `  locales: ${lit(s.locales, '')},`,
    '});',
    '',
  ].join('\n');
}

/** `src/theme.ts`: brand colors and palettes, written by the admin Page builder > Theme. */
export function printThemeFile(t: ThemeDefinition): string {
  const pad = '  ';
  const colors = Object.entries(t.colors).map(([k, v]) => `    ${IDENT.test(k) ? k : lit(k, '')}: ${lit(v, '')},`);
  const palettes = Object.entries(t.palettes).map(([id, p]) => {
    const body: Record<string, unknown> = {};
    if (p.label !== undefined) body.label = p.label;
    body.values = p.values;
    return `    ${IDENT.test(id) ? id : lit(id, '')}: ${lit(body, '')},`;
  });
  return [
    '// Brand colors and palettes. Managed by OpenCloudCMS: edit by hand or from the admin',
    '// Page builder > Theme (which rewrites this file).',
    "import { defineTheme } from '@opencloudcms/schema';",
    '',
    'export default defineTheme({',
    `${pad}colors: {`,
    ...colors,
    `${pad}},`,
    `${pad}palettes: {`,
    ...palettes,
    `${pad}},`,
    `${pad}activePalette: ${lit(t.activePalette, '')},`,
    '});',
    '',
  ].join('\n');
}
