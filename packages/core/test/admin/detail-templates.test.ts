// Detail templates in Pages and the page editor (collection list spec §3, plan Task 8).
import { describe, expect, it } from 'vitest';
import {
  detailTemplatesOf,
  pageHidesDetail,
  pagePreviewUrl,
  pagesTab,
  previewDetailUrl,
  splitPagesList,
  typesWithoutTemplate,
} from '../../admin/src/lib/pages';
import { fromEditorData, toEditorData } from '../../admin/src/page-editor/field-logic';

const rows = [
  { documentId: 'a', kind: 'page', path: '/' },
  { documentId: 'b', kind: 'base' },
  { documentId: 'c', kind: 'detail', detailApiId: 'product' },
];
const PATHS = { product: { path: '/products/{slug}', slugField: 'slug' }, post: { path: '/posts/{id}' } };

describe('Pages list', () => {
  it('detail templates have their own tab and are not in the pages tab', () => {
    expect(pagesTab('detail')).toBe('detail');
    expect(pagesTab('x')).toBe('pages');
    expect(splitPagesList(rows).map((p) => p.documentId)).toEqual(['a']);
    expect(detailTemplatesOf(rows).map((p) => p.documentId)).toEqual(['c']);
  });

  it('"New detail template" offers the enabled types without a template', () => {
    const types = [
      { apiId: 'product', detailPage: { path: '/products/{slug}' } },
      { apiId: 'post', detailPage: { path: '/posts/{id}' } },
      { apiId: 'note', private: true, detailPage: { path: '/notes/{id}' } },
      { apiId: 'faq' },
    ];
    expect(typesWithoutTemplate(types, detailTemplatesOf(rows)).map((t) => t.apiId)).toEqual(['post']);
  });
});

describe('page editor', () => {
  it('an ordinary page whose path matches a pattern is flagged (it hides that entry)', () => {
    expect(pageHidesDetail(PATHS, '/products/sale')).toEqual({ apiId: 'product', pattern: '/products/{slug}', value: 'sale' });
    expect(pageHidesDetail(PATHS, '/products')).toBeNull();
    expect(pageHidesDetail(PATHS, '/products/Sale!')).toBeNull();
    expect(pageHidesDetail(PATHS, '/posts/not-a-uuid')).toBeNull();
  });

  it('a template previews at the chosen entry URL', () => {
    expect(previewDetailUrl(PATHS.product, { documentId: 'd', slug: 'ao-thun' })).toBe('/products/ao-thun');
    expect(previewDetailUrl(PATHS.post, { documentId: '3f9a2c1e-5b7d-4e8f-9a1b-2c3d4e5f6a7b' })).toBe('/posts/3f9a2c1e-5b7d-4e8f-9a1b-2c3d4e5f6a7b');
    expect(previewDetailUrl(undefined, { slug: 'x' })).toBeNull();
    expect(pagePreviewUrl('id1', 'en-US', '/products/ao-thun')).toBe('/__opencloudcms/preview?page=id1&locale=en-US&path=%2Fproducts%2Fao-thun');
  });

  it('a template has no path in the editor data or the save body', () => {
    const data = toEditorData({ title: 'Product detail', path: null }, { root: { props: {} }, content: [] } as never, 'detail');
    expect(data.root.props).not.toHaveProperty('path');
    expect(toEditorData({ title: 'P', path: '/p' }, { root: { props: {} }, content: [] } as never, 'page').root.props).toMatchObject({ path: '/p' });
    const registry = { list: [], get: () => undefined, has: () => false } as never;
    expect(fromEditorData(data, registry, null, 'detail')).not.toHaveProperty('path');
  });
});
