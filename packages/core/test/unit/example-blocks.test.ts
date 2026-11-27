import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isComposedIndexWired, loadComposedBlocks, loadConfig, loadDefinitions } from '@opencloudcms/codegen';
import { checkSpecAgainstTypes } from '../../src/block-builder/blocks-checks';

// The my-store example ships Block Builder blocks (two product blocks + the storefront); they must load and fit its content types.
const root = path.resolve(__dirname, '../../../../examples/my-store');

describe('examples/my-store composed blocks', () => {
  it('load without errors, are wired into src/blocks/index.ts and pass the content-type checks', async () => {
    const config = await loadConfig(root);
    const { specs, errors } = await loadComposedBlocks(config);
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.spec.name).sort()).toEqual(['ActiveProducts', 'ContactModal', 'Faq', 'FeaturedProducts', 'HomeBanner', 'MobileMenu', 'ProductCard', 'ProductStrip', 'ProductTabs', 'Questions', 'SectionHead', 'StoreFooter', 'StoreFrame', 'StoreHeader', 'StoreHero', 'StoryBand']);
    expect(isComposedIndexWired(config)).toBe(true);

    const types = (await loadDefinitions(config)).map((d) => d.def);
    const active = types.find((t) => t.apiId === 'product')?.fields.find((f) => f.name === 'active');
    expect(active).toMatchObject({ kind: 'boolean', indexed: true });
    for (const { spec } of specs) expect(checkSpecAgainstTypes(spec, types), spec.name).toEqual([]);

    const list = specs.find((s) => s.spec.name === 'ActiveProducts')!.spec;
    expect(list.binding).toMatchObject({ apiId: 'product', mode: 'collection', filter: [{ field: 'active', value: true }], layout: { kind: 'grid', columns: 4 } });
    expect(specs.find((s) => s.spec.name === 'ProductCard')!.spec.binding).toMatchObject({ apiId: 'product', mode: 'single' });
    // The storefront's featured products: the three oldest products (shirt, tote, scarf), photo = first of `images`.
    expect(specs.find((s) => s.spec.name === 'FeaturedProducts')!.spec.binding).toEqual({
      apiId: 'product', mode: 'collection', sort: { field: 'createdAt', direction: 'asc' }, limit: 3, layout: { kind: 'grid', columns: 3 },
    });
    // Collection list spec 2026-11-27: product cards link through the product detail page (no urlPattern); the
    // Questions block holds a CollectionList of `question` entries sorted by `order` (its heading renders once).
    expect(types.find((t) => t.apiId === 'product')?.detailPage).toEqual({ path: '/products/{slug}', slugField: 'slug' });
    expect(types.find((t) => t.apiId === 'product')?.fields.find((f) => f.name === 'slug')?.options).toEqual({ pattern: '{name}' });
    expect(specs.find((s) => s.spec.name === 'ProductStrip')!.spec.binding?.urlPattern).toBeUndefined();
    const questions = specs.find((s) => s.spec.name === 'Questions')!.spec;
    const lists = (questions.tree.children ?? []).filter((n) => n.el === 'CollectionList');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.props).toMatchObject({ key: 'questions', apiId: 'question', sort: { field: 'order', direction: 'asc' } });
    expect(questions.tree.children!.map((n) => n.el)).toEqual(['Heading', 'Text', 'CollectionList', 'Button']);
  });
});
