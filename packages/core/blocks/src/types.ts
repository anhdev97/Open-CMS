import type { ReactNode } from 'react';
import type { Config, CustomField, CustomFieldRender, Data } from '@puckeditor/core';
import type { LocalizedText } from '@opencloudcms/schema';

/** Design-system colour tokens offered by `b.color` (stored as the token name). */
export const COLOR_TOKENS = ['primary', 'secondary', 'muted', 'accent', 'background', 'foreground', 'destructive'] as const;
/** Design-system spacing tokens offered by `b.spacing` (stored as the token string, e.g. `'4'`). */
export const SPACING_TOKENS = ['0', '2', '4', '6', '8', '12', '16', '24'] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type SpacingToken = (typeof SPACING_TOKENS)[number];

export type Label = string | LocalizedText;
export type OptionValue = string | number | boolean;
export type SelectOption<T extends OptionValue = OptionValue> = T | { value: T; label: Label };

interface FieldBase {
  label?: Label;
}

export interface TextBlockField extends FieldBase {
  kind: 'text';
  default?: string;
  placeholder?: string;
}
export interface LongTextBlockField extends FieldBase {
  kind: 'longText';
  default?: string;
  placeholder?: string;
}
/** Stored as the HTML string produced by Puck's `richtext` field. */
export interface RichTextBlockField extends FieldBase {
  kind: 'richText';
  default?: string;
}
export interface NumberBlockField extends FieldBase {
  kind: 'number';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}
export interface BooleanBlockField extends FieldBase {
  kind: 'boolean';
  default?: boolean;
}
export interface SelectBlockField<T extends OptionValue = OptionValue> extends FieldBase {
  kind: 'select';
  options: readonly SelectOption<T>[];
  default?: T;
}
export interface RadioBlockField<T extends OptionValue = OptionValue> extends FieldBase {
  kind: 'radio';
  options: readonly SelectOption<T>[];
  default?: T;
}
export interface LinkBlockField extends FieldBase {
  kind: 'link';
  default?: StoredLink | null;
}
export interface ImageBlockField extends FieldBase {
  kind: 'image';
  default?: StoredImage | null;
}
export interface ColorBlockField extends FieldBase {
  kind: 'color';
  default?: ColorToken;
}
export interface SpacingBlockField extends FieldBase {
  kind: 'spacing';
  default?: SpacingToken;
}
export interface EntryBlockField extends FieldBase {
  kind: 'entry';
  apiId: string;
  displayField?: string;
}
export interface EntriesBlockField extends FieldBase {
  kind: 'entries';
  /** Content type api id. Pass `''` together with `apiIdFrom` when the editor chooses the type per block. */
  apiId: string;
  /** Name of a sibling text prop that holds the api id at render/resolve time (overrides `apiId`). */
  apiIdFrom?: string;
  limit?: number;
  sortable?: boolean;
  filterable?: boolean;
  /**
   * Fixed equality filters, enforced by `resolvePage` and never stored: merged over the stored query filter (base wins
   * on the same field); picked entries that do not match are dropped.
   */
  baseFilter?: Record<string, string>;
  /** `field:asc|desc`. Used when the stored query has no sort, and always when `sortable` is not true. */
  defaultSort?: string;
  /** `resolvePage` uses `limit` whatever the stored value (and caps picks to it). */
  lockLimit?: boolean;
  /** Value when the block is inserted. Default `{ mode: 'pick', ids: [] }`. */
  default?: StoredEntries;
}
export interface ListBlockField<S extends Record<string, BlockField> = Record<string, BlockField>> extends FieldBase {
  kind: 'list';
  fields: S;
  min?: number;
  max?: number;
  default?: Record<string, unknown>[];
}
export interface SlotBlockField extends FieldBase {
  kind: 'slot';
  allow?: string[];
  /** Not enforced by Puck 0.24 slots; carried in the Puck field's `metadata.blockField` for the editor. */
  max?: number;
}

export type BlockField =
  | TextBlockField
  | LongTextBlockField
  | RichTextBlockField
  | NumberBlockField
  | BooleanBlockField
  | SelectBlockField<any>
  | RadioBlockField<any>
  | LinkBlockField
  | ImageBlockField
  | ColorBlockField
  | SpacingBlockField
  | EntryBlockField
  | EntriesBlockField
  | ListBlockField<any>
  | SlotBlockField;

export type BlockFieldKind = BlockField['kind'];

// ---- stored values (what the page JSON holds) ----

export type StoredLink = { kind: 'url'; href: string } | { kind: 'page'; documentId: string };
export type StoredImage = { assetId?: string; src: string; alt: string };
export type StoredEntry = { documentId: string };
export type StoredEntries =
  | { mode: 'pick'; ids: string[] }
  | { mode: 'query'; filter?: Record<string, unknown>; sort?: string; limit?: number };

// ---- resolved values (what `render` receives) ----

export type ResolvedLink = { href: string | null };
export type ResolvedImage = { src: string; alt: string; width?: number; height?: number };
export type ResolvedEntry = { documentId: string; [field: string]: unknown };

export type ResolvedValue<F> = F extends { kind: 'text' | 'longText' }
  ? string
  : F extends { kind: 'richText' }
    ? ReactNode
    : F extends { kind: 'number' }
      ? number
      : F extends { kind: 'boolean' }
        ? boolean
        : F extends { kind: 'select' | 'radio'; options: readonly SelectOption<infer T>[] }
          ? T
          : F extends { kind: 'color' }
            ? ColorToken
            : F extends { kind: 'spacing' }
              ? SpacingToken
              : F extends { kind: 'link' }
                ? ResolvedLink
                : F extends { kind: 'image' }
                  ? ResolvedImage | null
                  : F extends { kind: 'entry' }
                    ? ResolvedEntry | null
                    : F extends { kind: 'entries' }
                      ? ResolvedEntry[]
                      : F extends { kind: 'list'; fields: infer S extends Record<string, BlockField> }
                        ? ResolvedProps<S>[]
                        : F extends { kind: 'slot' }
                          ? ReactNode
                          : never;

export type ResolvedProps<F extends Record<string, BlockField>> = { [K in keyof F]: ResolvedValue<F[K]> };

export interface BlockMigration {
  /** Migrates props stored at version `from` to version `from + 1`. `id` and `_v` are handled by core. */
  from: number;
  up(props: Record<string, unknown>): Record<string, unknown>;
}

export interface BlockDefinition<F extends Record<string, BlockField> = Record<string, BlockField>> {
  /** Stable key stored in page data. PascalCase, unique. */
  name: string;
  label: Label;
  category: string;
  /** lucide icon name. */
  icon?: string;
  /** Stored in each item's props as `_v`. Default 1. */
  version?: number;
  fields: F;
  migrate?: BlockMigration[];
  render(props: ResolvedProps<F>): ReactNode;
  /**
   * Set by `defineComposedBlock`. `resolvePage` stamps the reserved prop `_locale` on its items and the Puck config
   * passes `_locale`/`_editor` to `render` (never stored: `writePageContent` drops undeclared props).
   */
  composed?: true;
  /**
   * Hand-written blocks (e.g. ejected from the Block Builder) that render like composed blocks: same reserved props
   * as `composed` (`resolvePage` stamps `_locale`; the Puck config passes `_locale`/`_editor`), without a spec.
   * Read them with `composedHelpers.locale(props)` / `composedHelpers.editor(props)`.
   */
  usesLocale?: true;
  /**
   * Entry fields (of the block's `entry`/`entries` values) that hold an asset id: `resolvePage` replaces a uuid there
   * by `{ id, url, alt, width, height }` (one `ContentFetcher.assets` call per page). Set by `defineComposedBlock`.
   */
  entryAssetPaths?: readonly string[];
}

export interface BlockRegistry {
  readonly list: readonly BlockDefinition<any>[];
  get(name: string): BlockDefinition<any> | undefined;
  has(name: string): boolean;
}

// ---- Puck ----

export type PuckData = Data;
export type PuckConfig = Config;

/** Field kinds rendered by the host (admin) through Puck `custom` fields. */
export type CustomFieldKind = 'link' | 'image' | 'entry' | 'entries';

export type StoredFieldValue<K extends CustomFieldKind> = K extends 'link'
  ? StoredLink | null
  : K extends 'image'
    ? StoredImage | null
    : K extends 'entry'
      ? StoredEntry | null
      : StoredEntries;

/**
 * Puck custom field produced for a data field. The originating block field (apiId, limit, displayField…) is in
 * `field.metadata.blockField`.
 */
export type BlockCustomField<K extends CustomFieldKind = CustomFieldKind> = CustomField<StoredFieldValue<K>> & {
  metadata: { blockField: Extract<BlockField, { kind: K }> };
};

/** One Puck custom-field renderer per data field kind (supplied by the admin editor). */
export type CustomFieldRenderers = { [K in CustomFieldKind]: CustomFieldRender<StoredFieldValue<K>> };
