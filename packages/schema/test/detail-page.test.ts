import { describe, expect, it } from 'vitest';
import { defineContentType, f, normalizeDefinition } from '../src/define';
import type { PageKind } from '../src/pages';
import { detailPatternsOverlap, matchDetailPath, parseDetailPath } from '../src/slug';
import type { ContentTypeDefinition } from '../src/types';
import { collectSchemaIssues } from '../src/validate';

const ID = '3f9a2c1e-7b4d-4e2a-9c1f-0a1b2c3d4e5f';
const type = (apiId: string, detailPage?: ContentTypeDefinition['detailPage'], extra: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition => ({
  ...defineContentType({
    id: `ct_${apiId}`, apiId, displayName: apiId,
    fields: { name: f.text({ id: `fld_${apiId}_name` }), slug: f.slug({ id: `fld_${apiId}_slug`, pattern: '{name}' }) },
  }),
  ...(detailPage ? { detailPage } : {}),
  ...extra,
});

describe('parseDetailPath', () => {
  it('accepts one trailing {slug} or {id} after static segments', () => {
    expect(parseDetailPath('/products/{slug}')).toEqual({ prefix: '/products', param: 'slug' });
    expect(parseDetailPath('/blog/posts/{id}')).toEqual({ prefix: '/blog/posts', param: 'id' });
  });
  it('rejects anything else', () => {
    for (const bad of [
      '/products/{slug}/x', 'products/{slug}', '/a/{slug}/{id}', '/products', '/products/', '/{slug}', '/products/{name}',
      '/Products/{slug}', '/api/{slug}', '/products//{slug}', '/products/x{slug}', '', 42,
    ]) expect(parseDetailPath(bad as string)).toBeNull();
  });
});

describe('detailPatternsOverlap', () => {
  it('overlaps when both match the same paths', () => {
    expect(detailPatternsOverlap('/products/{slug}', '/products/{id}')).toBe(true);
    expect(detailPatternsOverlap('/products/{slug}', '/products/{slug}')).toBe(true);
    expect(detailPatternsOverlap('/products/{slug}', '/posts/{slug}')).toBe(false);
    expect(detailPatternsOverlap('/products/{slug}', '/products/sale/{slug}')).toBe(false);
    expect(detailPatternsOverlap('/products/{slug}', 'bad')).toBe(false);
  });
});

describe('matchDetailPath', () => {
  const defs = [
    type('product', { path: '/products/{slug}', slugField: 'slug' }),
    type('post', { path: '/blog/{id}' }),
    type('note'),
  ];
  it('matches enabled types', () => {
    expect(matchDetailPath(defs, '/products/ao-thun')).toEqual({ apiId: 'product', value: 'ao-thun', param: 'slug' });
    expect(matchDetailPath(defs, `/blog/${ID}`)).toEqual({ apiId: 'post', value: ID, param: 'id' });
  });
  it('ignores non-matching, malformed and misconfigured cases', () => {
    expect(matchDetailPath(defs, '/products')).toBeNull();
    expect(matchDetailPath(defs, '/products/a/b')).toBeNull();
    expect(matchDetailPath(defs, '/products/Ao-Thun')).toBeNull();
    expect(matchDetailPath(defs, '/products/')).toBeNull();
    expect(matchDetailPath(defs, '/blog/not-an-id')).toBeNull();
    expect(matchDetailPath(defs, '/other/x')).toBeNull();
    const dangling = [type('product', { path: '/products/{slug}', slugField: 'gone' })];
    expect(matchDetailPath(dangling, '/products/x')).toBeNull();
    const priv = [type('product', { path: '/products/{slug}', slugField: 'slug' }, { private: true })];
    expect(matchDetailPath(priv, '/products/x')).toBeNull();
  });
});

describe('content type validation of detailPage', () => {
  it('accepts valid detail pages', () => {
    expect(collectSchemaIssues([type('product', { path: '/products/{slug}', slugField: 'slug' }), type('post', { path: '/posts/{id}' })])).toEqual([]);
  });
  it('reports bad paths, private types, slug fields and overlaps', () => {
    expect(collectSchemaIssues([type('product', { path: '/products/{slug}/x', slugField: 'slug' })])).toEqual([
      'content type "product": detailPage.path must start with "/" and end with one {slug} or {id} segment after valid page path segments',
    ]);
    expect(collectSchemaIssues([type('product', { path: '/products/{id}' }, { private: true })])).toEqual([
      'content type "product": a private type cannot have a detail page',
    ]);
    expect(collectSchemaIssues([type('product', { path: '/products/{slug}' })])).toEqual([
      'content type "product": detailPage with {slug} requires slugField',
    ]);
    expect(collectSchemaIssues([type('product', { path: '/products/{slug}', slugField: 'name' })])).toEqual([
      'content type "product": detailPage.slugField "name" must be a slug field of the type',
    ]);
    expect(collectSchemaIssues([type('product', { path: '/products/{slug}', slugField: 'nope' })])).toEqual([
      'content type "product": detailPage.slugField "nope" must be a slug field of the type',
    ]);
    expect(collectSchemaIssues([
      type('product', { path: '/products/{slug}', slugField: 'slug' }), type('item', { path: '/products/{id}' }),
    ])).toEqual(['content type "item": detailPage.path overlaps the detail page of "product"']);
    expect(collectSchemaIssues([type('product', 'x' as any)])).toEqual(['content type "product": detailPage must be an object with a path']);
  });
});

describe('definitions carry detailPage', () => {
  it('defineContentType and normalizeDefinition keep it', () => {
    const d = defineContentType({
      id: 'ct_p', apiId: 'p', displayName: 'P', detailPage: { path: '/p/{id}' }, fields: {},
    });
    expect(d.detailPage).toEqual({ path: '/p/{id}' });
    expect(normalizeDefinition(d).detailPage).toEqual({ path: '/p/{id}' });
    expect('detailPage' in normalizeDefinition({ ...d, detailPage: undefined })).toBe(false);
  });
});

describe('page kinds', () => {
  it('has a detail kind', () => {
    const k: PageKind = 'detail';
    expect(k).toBe('detail');
  });
});
