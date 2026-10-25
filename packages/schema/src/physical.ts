/**
 * Physical storage mapping: how a content type becomes Postgres tables.
 *
 *   ct_<api_id>                    one row per (document, status) with shared fields
 *   ct_<api_id>_l10n               one row per (entry, locale) with localizable fields
 *   ct_<api_id>__rel__<field>      join table for every multiple relation field
 *
 * Both the migration generator and the runtime repository use these helpers,
 * so the two can never disagree about table or column names.
 */
import type { ContentTypeDefinition, FieldDefinition } from './types';

export const SYSTEM_TABLES = {
  assets: 'opencms_assets',
  assetFolders: 'opencms_asset_folders',
  taxonomies: 'opencms_taxonomies',
  taxonomyTerms: 'opencms_taxonomy_terms',
  entryVersions: 'opencms_entry_versions',
  workflow: 'opencms_workflow',
} as const;

export const PG_MAX_IDENTIFIER = 63;

export function snake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function hash8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Keeps identifiers within Postgres' 63 byte limit, deterministically. */
export function pgName(name: string): string {
  if (name.length <= PG_MAX_IDENTIFIER) return name;
  return `${name.slice(0, PG_MAX_IDENTIFIER - 9)}_${hash8(name)}`;
}

export const mainTable = (def: Pick<ContentTypeDefinition, 'apiId'>) => pgName(`ct_${snake(def.apiId)}`);
export const l10nTable = (def: Pick<ContentTypeDefinition, 'apiId'>) => pgName(`ct_${snake(def.apiId)}_l10n`);
export const relTable = (def: Pick<ContentTypeDefinition, 'apiId'>, field: Pick<FieldDefinition, 'name'>) =>
  pgName(`ct_${snake(def.apiId)}__rel__${snake(field.name)}`);

export interface PhysicalColumn {
  name: string;
  /** Postgres type, e.g. `varchar(255)`. */
  type: string;
  notNull?: boolean;
  defaultSql?: string;
  references?: { table: string; column: string; onDelete: 'cascade' | 'set null' };
}

export type FieldStorage =
  | { mode: 'columns'; location: 'main' | 'l10n'; table: string; columns: PhysicalColumn[] }
  | { mode: 'relation'; table: string; targetTable: string | null };

export function isMultiRelation(field: FieldDefinition): boolean {
  return (
    (field.kind === 'asset' || field.kind === 'reference' || field.kind === 'taxonomy') &&
    !!(field.options as { multiple?: boolean }).multiple
  );
}

function relationTargetTable(field: FieldDefinition): string | null {
  if (field.kind === 'asset') return SYSTEM_TABLES.assets;
  if (field.kind === 'taxonomy') return SYSTEM_TABLES.taxonomyTerms;
  // References point at a *document* (draft and published rows share it), so no FK.
  return null;
}

/** Postgres column(s) for a scalar / single relation field. */
export function fieldColumns(field: FieldDefinition): PhysicalColumn[] {
  const col = snake(field.name);
  const o = field.options as Record<string, any>;
  switch (field.kind) {
    case 'text':
      return [{ name: col, type: `varchar(${o.maxLength ?? 255})` }];
    case 'slug':
      return [{ name: col, type: `varchar(${o.maxLength ?? 255})` }];
    case 'email':
      return [{ name: col, type: 'varchar(320)' }];
    case 'url':
      return [{ name: col, type: 'varchar(2048)' }];
    case 'longText':
      return [{ name: col, type: 'text' }];
    case 'richText':
    case 'json':
      return [{ name: col, type: 'jsonb' }];
    case 'number':
      return o.format === 'decimal'
        ? [{ name: col, type: `numeric(${o.precision ?? 18}, ${o.scale ?? 2})` }]
        : [{ name: col, type: 'integer' }];
    case 'boolean':
      return [{ name: col, type: 'boolean' }];
    case 'date':
      return [{ name: col, type: 'date' }];
    case 'datetime':
      return [{ name: col, type: 'timestamptz' }];
    case 'money':
      return [
        { name: `${col}_amount`, type: 'numeric(19, 4)' },
        { name: `${col}_currency`, type: 'char(3)' },
      ];
    case 'asset':
      return [
        { name: `${col}_id`, type: 'uuid', references: { table: SYSTEM_TABLES.assets, column: 'id', onDelete: 'set null' } },
      ];
    case 'taxonomy':
      return [
        { name: `${col}_id`, type: 'uuid', references: { table: SYSTEM_TABLES.taxonomyTerms, column: 'id', onDelete: 'set null' } },
      ];
    case 'reference':
      return [{ name: `${col}_document_id`, type: 'uuid' }];
    default:
      throw new Error(`Unknown field kind "${(field as FieldDefinition).kind}"`);
  }
}

export function fieldStorage(def: ContentTypeDefinition, field: FieldDefinition): FieldStorage {
  if (isMultiRelation(field)) {
    return { mode: 'relation', table: relTable(def, field), targetTable: relationTargetTable(field) };
  }
  const location = field.localizable ? 'l10n' : 'main';
  return {
    mode: 'columns',
    location,
    table: location === 'main' ? mainTable(def) : l10nTable(def),
    columns: fieldColumns(field),
  };
}

export function mainBaseColumns(): PhysicalColumn[] {
  return [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'document_id', type: 'uuid', notNull: true },
    { name: 'status', type: 'varchar(16)', notNull: true },
    { name: 'created_at', type: 'timestamptz', notNull: true, defaultSql: 'now()' },
    { name: 'updated_at', type: 'timestamptz', notNull: true, defaultSql: 'now()' },
    { name: 'published_at', type: 'timestamptz' },
  ];
}

export function l10nBaseColumns(def: ContentTypeDefinition): PhysicalColumn[] {
  return [
    { name: 'entry_id', type: 'uuid', notNull: true, references: { table: mainTable(def), column: 'id', onDelete: 'cascade' } },
    { name: 'locale', type: 'varchar(16)', notNull: true },
    { name: 'status', type: 'varchar(16)', notNull: true },
  ];
}

export function relBaseColumns(def: ContentTypeDefinition, field: FieldDefinition): PhysicalColumn[] {
  const target = relationTargetTable(field);
  return [
    { name: 'entry_id', type: 'uuid', notNull: true, references: { table: mainTable(def), column: 'id', onDelete: 'cascade' } },
    {
      name: 'target_id',
      type: 'uuid',
      notNull: true,
      ...(target ? { references: { table: target, column: 'id', onDelete: 'cascade' as const } } : {}),
    },
    { name: 'sort_order', type: 'integer', notNull: true, defaultSql: '0' },
  ];
}

export interface IndexSpec {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
}

export const mainPkeyName = (def: ContentTypeDefinition) => pgName(`${mainTable(def)}_pkey`);
export const l10nPkeyName = (def: ContentTypeDefinition) => pgName(`${l10nTable(def)}_pkey`);
export const relPkeyName = (def: ContentTypeDefinition, field: FieldDefinition) => pgName(`${relTable(def, field)}_pkey`);
export const relTargetIndexName = (def: ContentTypeDefinition, field: FieldDefinition) =>
  pgName(`${relTable(def, field)}_target_idx`);
export const documentStatusIndexName = (def: ContentTypeDefinition) => pgName(`${mainTable(def)}_document_status_uq`);

/** Index created for an `indexed` / `unique` field, or null. */
export function fieldIndex(def: ContentTypeDefinition, field: FieldDefinition): IndexSpec | null {
  if (!field.indexed && !field.unique) return null;
  const storage = fieldStorage(def, field);
  if (storage.mode !== 'columns') return null; // relation tables are always indexed on target_id
  const col = storage.columns[0].name;
  const scope = storage.location === 'l10n' ? ['locale'] : [];
  if (field.unique) {
    return { name: pgName(`${storage.table}_${col}_uq`), table: storage.table, columns: [...scope, 'status', col], unique: true };
  }
  return { name: pgName(`${storage.table}_${col}_idx`), table: storage.table, columns: [...scope, col], unique: false };
}

/** Every index (including primary keys) that belongs to a content type. Used for renames. */
export function typeIndexNames(def: ContentTypeDefinition): string[] {
  const names = [mainPkeyName(def), documentStatusIndexName(def), l10nPkeyName(def)];
  for (const field of def.fields) {
    if (isMultiRelation(field)) names.push(relPkeyName(def, field), relTargetIndexName(def, field));
    const idx = fieldIndex(def, field);
    if (idx) names.push(idx.name);
  }
  return names;
}

/** Every table that belongs to a content type. */
export function typeTableNames(def: ContentTypeDefinition): string[] {
  return [
    mainTable(def),
    l10nTable(def),
    ...def.fields.filter(isMultiRelation).map((fld) => relTable(def, fld)),
  ];
}
