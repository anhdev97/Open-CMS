/**
 * Core type model for OpenCloudCMS content types.
 *
 * A ContentTypeDefinition is the single source of truth. Physical tables,
 * migrations, validators and TypeScript types are all derived from it.
 */

import type { Locale, LocalizedText } from './i18n';

export type FieldKind =
  | 'text'
  | 'longText'
  | 'richText'
  | 'slug'
  | 'email'
  | 'url'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'money'
  | 'asset'
  | 'reference'
  | 'taxonomy';

export interface FieldOptionsMap {
  text: { maxLength?: number };
  longText: {};
  richText: {};
  slug: { from?: string; maxLength?: number };
  email: {};
  url: {};
  number: { format?: 'integer' | 'decimal'; precision?: number; scale?: number };
  boolean: {};
  date: {};
  datetime: {};
  json: {};
  money: { currencyMode?: 'market' | 'fixed'; currency?: string };
  asset: { multiple?: boolean; accept?: string[] };
  reference: { target: string; multiple?: boolean };
  taxonomy: { taxonomy: string; multiple?: boolean };
}

/** Flags shared by every field kind. */
export interface FieldFlags {
  /** Enforced when publishing (drafts may be incomplete). */
  required?: boolean;
  /** Stored per locale in the `<table>_l10n` table. */
  localizable?: boolean;
  /** Creates a B-tree index and allows filtering / sorting on the field. */
  indexed?: boolean;
  /** Unique per status (and per locale for localizable fields). Implies indexed. */
  unique?: boolean;
  label?: string;
  description?: string;
}

/** What the `f.*` builders return: a field without its name (the object key is the name). */
export type FieldSpec<K extends FieldKind = FieldKind> = FieldFlags & {
  /** Stable id. Never changes on rename, lets the diff engine tell rename from drop + add. */
  id: string;
  kind: K;
  options: FieldOptionsMap[K];
};

/** A normalized field as stored in snapshots and registries. */
export interface FieldDefinition<K extends FieldKind = FieldKind> {
  id: string;
  name: string;
  kind: K;
  required: boolean;
  localizable: boolean;
  indexed: boolean;
  unique: boolean;
  label?: string;
  description?: string;
  options: FieldOptionsMap[K];
}

export interface ContentTypeDefinition {
  /** Content group key (see `defineContentGroups`). */
  group?: string;
  /** Stable id, e.g. `ct_8f2a1c`. */
  id: string;
  /** camelCase API id, e.g. `product`. Drives table name `ct_product` and REST path. */
  apiId: string;
  displayName: string | LocalizedText;
  description?: string;
  /** Entries need a reviewer (`content.publish`) to be published. Default false; stored only when true. */
  review?: boolean;
  fields: FieldDefinition[];
}

export interface ContentTypeInput {
  group?: string;
  id: string;
  apiId: string;
  displayName: string | LocalizedText;
  description?: string;
  review?: boolean;
  fields: Record<string, FieldSpec>;
}

export interface OpenCloudCmsConfig {
  database: { url: string };
  /** Directory scanned for `*.schema.ts` files. Default `src/content-types`. */
  contentTypesDir?: string;
  /** Directory for generated code. Default `src/generated`. */
  generatedDir?: string;
  /** Directory for migration files and `_snapshot.json`. Default `migrations`. */
  migrationsDir?: string;
  /** Default locale used when a request does not specify one. Default `en-US`. */
  defaultLocale?: Locale;
  locales?: Locale[];
}

export interface ResolvedConfig extends Required<Omit<OpenCloudCmsConfig, 'locales'>> {
  locales: Locale[];
  root: string;
}
