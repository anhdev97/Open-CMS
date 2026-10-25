// Shared API shapes of the admin. Relative imports only (tested by the root vitest, see ruling R4).
import type { ContentGroupDefinition, LocalizedText } from '@opencloudcms/schema';

export type FieldKind =
  | 'text' | 'longText' | 'richText' | 'slug' | 'email' | 'url' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'json' | 'money' | 'asset' | 'reference' | 'taxonomy';

export interface FieldDefinition {
  id: string;
  name: string;
  kind: FieldKind;
  required: boolean;
  localizable: boolean;
  indexed: boolean;
  unique: boolean;
  label?: string;
  description?: string;
  options: Record<string, any>;
}

export interface ContentTypeDefinition {
  id: string;
  apiId: string;
  displayName: string | LocalizedText;
  group?: string;
  description?: string;
  /** Entries need a reviewer's approval before they are published (only `true` is stored). */
  review?: boolean;
  fields: FieldDefinition[];
}

export interface Meta {
  schemaEditable: boolean;
  defaultLocale: string;
  locales: string[];
  fieldKinds: FieldKind[];
  groups?: ContentGroupDefinition[];
}

export interface PlanResponse {
  changed: boolean;
  summary: string[];
  warnings: string[];
  sql: string[];
}

export interface ApplyResponse extends PlanResponse {
  status: 'created' | 'metadata-only' | 'up-to-date';
  schemaFile: string | null;
  migrationFile: string | null;
  generated: string[];
  applied: string[];
}

/** Random id for a new content type (`ct`) or field (`fld`): prefix, underscore, 6 base36 characters. */
export const newId = (prefix: 'ct' | 'fld') =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('')}`;
