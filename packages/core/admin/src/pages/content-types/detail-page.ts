// Detail page settings and slug patterns in the content type pages (collection list spec §2–3, plan Task 7).
// Pure; relative imports only (root vitest).
import {
  detailPatternsOverlap,
  parseDetailPath,
  parseSlugPattern,
  renderSlugPattern,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN_FIELD_KINDS,
  slugPattern,
} from '@opencloudcms/schema';
import type { ContentTypeDefinition, FieldDefinition } from '../../lib/types';

/** Sample documentId of the live examples. */
export const SAMPLE_ID = '3f9a2c1e-5b7d-4e8f-9a1b-2c3d4e5f6a7b';

/** The detail page form state: off, or a path with `{slug}` (+ slug field) or `{id}`. */
export interface DetailDraft {
  on: boolean;
  /** Slug field name, or '' for `{id}` (the entry id). */
  slugField: string;
  path: string;
}

export const detailDraftOf = (def: Pick<ContentTypeDefinition, 'detailPage'>): DetailDraft =>
  def.detailPage ? { on: true, slugField: def.detailPage.slugField ?? '', path: def.detailPage.path } : { on: false, slugField: '', path: '' };

/** `productVariant` → `product-variant` (a page path segment). */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

/** Path of a newly enabled detail page: `/<api-id>/{slug}`, or `/<api-id>/{id}` without a slug field. */
export function defaultDetailPath(apiId: string, slugField: string): string {
  return `/${kebab(apiId) || 'items'}/${slugField ? '{slug}' : '{id}'}`;
}

/** The path with its last segment matching the slug field choice (`{slug}` with a field, `{id}` without). */
export function withParam(path: string, slugField: string): string {
  const param = slugField ? '{slug}' : '{id}';
  if (/\/\{(slug|id)\}$/.test(path)) return path.replace(/\{(slug|id)\}$/, param);
  return `${path.replace(/\/+$/, '')}/${param}`;
}

/** The stored `detailPage` of the draft (undefined when off). */
export function detailPageOf(d: DetailDraft): ContentTypeDefinition['detailPage'] {
  if (!d.on) return undefined;
  return { path: d.path.trim(), ...(d.slugField ? { slugField: d.slugField } : {}) };
}

export type DetailIssue =
  | { key: 'pathInvalid' }
  | { key: 'slugFieldRequired' }
  | { key: 'slugFieldMissing'; field: string }
  | { key: 'overlap'; type: string };

/** Why the detail page cannot be saved (null when it can). Private types never have one (the section is hidden). */
export function detailIssue(d: DetailDraft, fields: readonly FieldDefinition[], self: { id: string }, types: readonly ContentTypeDefinition[]): DetailIssue | null {
  if (!d.on) return null;
  const parsed = parseDetailPath(d.path.trim());
  if (!parsed) return { key: 'pathInvalid' };
  if (parsed.param === 'slug' && !d.slugField) return { key: 'slugFieldRequired' };
  if (d.slugField) {
    const f = fields.find((x) => x.name === d.slugField);
    if (!f || f.kind !== 'slug') return { key: 'slugFieldMissing', field: d.slugField };
  }
  const other = types.find((ty) => ty.id !== self.id && ty.detailPage && detailPatternsOverlap(ty.detailPage.path, d.path.trim()));
  return other ? { key: 'overlap', type: other.apiId } : null;
}

/** The URL of an example entry: `/products/{slug}` → `/products/example-slug`. */
export function detailExample(path: string, slugExample = 'example-slug'): string {
  return path.trim().replace(/\{slug\}$/, slugExample).replace(/\{id\}$/, SAMPLE_ID);
}

/**
 * Why `field` cannot be removed or change kind (it is the detail page's slug field), or null. The admin refuses it
 * while the detail page is on (spec §3: disable the detail page first).
 */
export const slugFieldInUse = (d: DetailDraft, field: Pick<FieldDefinition, 'name'>): boolean => d.on && !!d.slugField && d.slugField === field.name;

// ---- slug patterns (field Sheet) -------------------------------------------------------------------------------

/** The field's pattern as edited: `options.pattern`, or the legacy `from` read as `{from}`; '' for none (= the id). */
export const patternOf = (f: Pick<FieldDefinition, 'kind' | 'options'>): string => slugPattern(f as never) ?? '';

/** Placeholders a pattern may use: the type's text/longText/number/email/taxonomy fields, then `{id}` and `{id6}`. */
export function patternPlaceholders(fields: readonly FieldDefinition[]): string[] {
  return [...fields.filter((f) => f.name && SLUG_PATTERN_FIELD_KINDS.includes(f.kind as never)).map((f) => f.name), 'id', 'id6'];
}

/** Problems of a pattern for `fields` and `maxLength` (none for an empty pattern: the slug is then the entry id). */
export function patternIssues(pattern: string, fields: readonly FieldDefinition[], maxLength = SLUG_MAX_LENGTH): string[] {
  if (!pattern.trim()) return [];
  return parseSlugPattern(pattern.trim(), { fields: fields as never }, maxLength).issues;
}

/** Live example of a pattern: each field placeholder filled with its label (or name), the sample id for `{id}`. */
export function patternExample(pattern: string, fields: readonly FieldDefinition[], maxLength = SLUG_MAX_LENGTH, locale = 'en-US'): string {
  if (!pattern.trim()) return SAMPLE_ID;
  const values = Object.fromEntries(fields.map((f) => [f.name, f.label || f.name]));
  return renderSlugPattern(pattern.trim(), values, SAMPLE_ID, locale, maxLength) || SAMPLE_ID;
}

/** Slug options as saved: `pattern` (the legacy `from` is dropped) when set, and `maxLength` when set. */
export function slugOptions(options: Record<string, unknown>, pattern: string, maxLength: number | undefined): Record<string, unknown> {
  const { from: _from, pattern: _pattern, maxLength: _max, ...rest } = options;
  return {
    ...rest,
    ...(pattern.trim() ? { pattern: pattern.trim() } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
}
