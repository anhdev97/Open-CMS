// Content type "Detail page" settings and slug patterns (collection list spec §2–3, plan Task 7).
import { describe, expect, it } from 'vitest';
import { buildDefinition, infoValues } from '../../admin/src/pages/content-types/TypeEdit';
import {
  defaultDetailPath,
  detailDraftOf,
  detailExample,
  detailIssue,
  patternExample,
  patternIssues,
  patternOf,
  patternPlaceholders,
  slugFieldInUse,
  slugOptions,
  withParam,
} from '../../admin/src/pages/content-types/detail-page';
import { detailBadges } from '../../admin/src/pages/content-types/TypeDetail';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';

const fld = (name: string, kind: FieldDefinition['kind'], options: Record<string, unknown> = {}): FieldDefinition => ({
  id: `fld_${name}`, name, kind, required: false, localizable: false, indexed: false, unique: false, options,
});
const product: ContentTypeDefinition = {
  id: 'ct_product', apiId: 'product', displayName: 'Product', fields: [fld('name', 'text'), fld('slug', 'slug', { pattern: '{name}' })],
};

describe('detail page section', () => {
  it('the switch writes detailPage; off or private drops it; unchanged keeps the stored form', () => {
    const values = infoValues(product);
    const on = { on: true, slugField: 'slug', path: '/products/{slug}' };
    expect(buildDefinition(product, values, product.fields, on).detailPage).toEqual({ path: '/products/{slug}', slugField: 'slug' });
    expect(buildDefinition(product, values, product.fields, { ...on, on: false }).detailPage).toBeUndefined();
    expect(buildDefinition(product, { ...values, private: true }, product.fields, on).detailPage).toBeUndefined();
    const stored = { ...product, detailPage: { path: '/products/{slug}', slugField: 'slug' } };
    expect(buildDefinition(stored, infoValues(stored), stored.fields, detailDraftOf(stored)).detailPage).toBe(stored.detailPage);
    // Without a detail draft (older callers) the stored value stays.
    expect(buildDefinition(stored, infoValues(stored), stored.fields).detailPage).toBe(stored.detailPage);
  });

  it('{slug} without a slug field is blocked; {id} needs none; overlapping paths are refused', () => {
    expect(detailIssue({ on: true, slugField: '', path: '/products/{slug}' }, product.fields, product, [])).toEqual({ key: 'slugFieldRequired' });
    expect(detailIssue({ on: true, slugField: '', path: '/products/{id}' }, product.fields, product, [])).toBeNull();
    expect(detailIssue({ on: true, slugField: 'name', path: '/products/{slug}' }, product.fields, product, [])).toEqual({ key: 'slugFieldMissing', field: 'name' });
    expect(detailIssue({ on: true, slugField: 'slug', path: 'products' }, product.fields, product, [])).toEqual({ key: 'pathInvalid' });
    const other: ContentTypeDefinition = { id: 'ct_other', apiId: 'other', displayName: 'Other', fields: [], detailPage: { path: '/products/{id}' } };
    expect(detailIssue({ on: true, slugField: 'slug', path: '/products/{slug}' }, product.fields, product, [product, other])).toEqual({ key: 'overlap', type: 'other' });
    expect(detailIssue({ on: false, slugField: '', path: '' }, product.fields, product, [])).toBeNull();
  });

  it('default path, param switch and the live example', () => {
    expect(defaultDetailPath('productVariant', 'slug')).toBe('/product-variant/{slug}');
    expect(defaultDetailPath('post', '')).toBe('/post/{id}');
    expect(withParam('/products/{slug}', '')).toBe('/products/{id}');
    expect(withParam('/products/{id}', 'slug')).toBe('/products/{slug}');
    expect(detailExample('/products/{slug}')).toBe('/products/example-slug');
  });

  it('the slug field cannot be removed or retyped while the detail page is on', () => {
    expect(slugFieldInUse({ on: true, slugField: 'slug', path: '/p/{slug}' }, { name: 'slug' })).toBe(true);
    expect(slugFieldInUse({ on: false, slugField: 'slug', path: '' }, { name: 'slug' })).toBe(false);
    expect(slugFieldInUse({ on: true, slugField: 'slug', path: '/p/{slug}' }, { name: 'name' })).toBe(false);
  });

  it('status badges: misconfigured, no template, duplicate slugs', () => {
    expect(detailBadges(null)).toEqual([]);
    const base = { detailPage: { path: '/p/{slug}', slugField: 'slug' }, detailTemplate: true, templateId: 'x', misconfigured: false, duplicateSlugs: 0 };
    expect(detailBadges(base)).toEqual([]);
    expect(detailBadges({ ...base, detailTemplate: false, misconfigured: true, duplicateSlugs: 2 }).map((b) => b.key)).toEqual(['misconfigured', 'noTemplate', 'duplicateSlugs']);
  });
});

describe('slug pattern in the field sheet', () => {
  it('legacy from reads as {from}; placeholders, issues, example and saved options', () => {
    expect(patternOf({ kind: 'slug', options: { from: 'name' } })).toBe('{name}');
    expect(patternOf({ kind: 'slug', options: {} })).toBe('');
    expect(patternPlaceholders(product.fields)).toEqual(['name', 'id', 'id6']);
    expect(patternIssues('', product.fields)).toEqual([]);
    expect(patternIssues('{nope}', product.fields).join()).toMatch(/unknown placeholder/);
    expect(patternExample('{name}-{id6}', [fld('name', 'text')])).toBe('name-3f9a2c');
    expect(slugOptions({ from: 'name' }, '{name}', undefined)).toEqual({ pattern: '{name}' });
    expect(slugOptions({ pattern: '{name}' }, '', 80)).toEqual({ maxLength: 80 });
  });
});
