// CollectionList in the block builder (collection list spec §1, plan Task 6): keys and type of new lists, bindings
// inside an item template, palette and slot rules, the "List with heading" template.
import { describe, expect, it } from 'vitest';
import { validateComposedSpec, type ComposedNode } from '@opencloudcms/schema';
import {
  bindScope,
  detailPathsOf,
  detailTypesOf,
  enclosingList,
  fillListDefaults,
  freeListKey,
  listSampleBinding,
  treeLists,
} from '../../admin/src/block-builder/collection-list';
import { buildBuilderConfig, paletteCategories, paletteInsertTarget, slotRules } from '../../admin/src/block-builder/element-config';
import { bindableTypes, emptySpec, sourceOptions } from '../../admin/src/block-builder/logic';
import { BUILDER_TEMPLATES, expandTemplates, templateName } from '../../admin/src/block-builder/templates';
import { puckToTree, treeToPuck, type BuilderPuckData, type PuckItem } from '../../admin/src/block-builder/tree-puck';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';

const fld = (name: string, kind: FieldDefinition['kind'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`, name, kind, required: false, localizable: false, indexed: false, unique: false, options: {}, ...extra,
});
const question: ContentTypeDefinition = {
  id: 'ct_question', apiId: 'question', displayName: 'Question',
  fields: [fld('title', 'text'), fld('answer', 'longText'), fld('slug', 'slug')],
  detailPage: { path: '/questions/{slug}', slugField: 'slug' },
};
const product: ContentTypeDefinition = { id: 'ct_product', apiId: 'product', displayName: 'Product', fields: [fld('name', 'text'), fld('price', 'number')] };
const secret: ContentTypeDefinition = { id: 'ct_secret', apiId: 'secret', displayName: 'Secret', private: true, fields: [fld('note', 'text')], detailPage: { path: '/s/{id}' } };
const TYPES = [question, product, secret];

const item = (type: string, props: Record<string, unknown>): PuckItem => ({ type, props: { ...props, id: String(props.id ?? `${type}-x`) } });
const data = (...content: PuckItem[]): BuilderPuckData => ({ root: { props: {} }, content });

describe('keys and type of new lists', () => {
  it('two dropped lists get list and list2 and the default type', () => {
    const before = data(item('Stack', { id: 'root', children: [] }));
    const after = data(
      item('Stack', {
        id: 'root',
        children: [item('CollectionList', { id: 'a', children: [] }), item('CollectionList', { id: 'b', children: [] })],
      }),
    );
    const fixed = fillListDefaults(before, after, {}, 'question')!;
    const kids = fixed.content[0]!.props.children as PuckItem[];
    expect(kids.map((k) => k.props.listKey)).toEqual(['list', 'list2']);
    expect(kids.map((k) => k.props.apiId)).toEqual(['question', 'question']);
    // Nothing new: nothing to fix (a key being typed never moves).
    expect(fillListDefaults(fixed, fixed, {}, 'question')).toBeNull();
  });

  it('skips manual field names and the keys of existing lists', () => {
    expect(freeListKey([], { list: {} })).toBe('list2');
    expect(freeListKey(['list', 'list2'], {})).toBe('list3');
    const prev = data(item('Stack', { id: 'root', children: [item('CollectionList', { id: 'a', listKey: 'list', apiId: 'product' })] }));
    const next = data(item('Stack', { id: 'root', children: [item('CollectionList', { id: 'a', listKey: 'list', apiId: 'product' }), item('CollectionList', { id: 'b', listKey: 'list', apiId: 'product' })] }));
    const kids = fillListDefaults(prev, next, {}, 'question')!.content[0]!.props.children as PuckItem[];
    expect(kids.map((k) => [k.props.listKey, k.props.apiId])).toEqual([['list', 'product'], ['list2', 'product']]);
  });

  it('the list key is `listKey` in Puck data and `key` in the spec', () => {
    const tree: ComposedNode = { el: 'Stack', children: [{ el: 'CollectionList', props: { key: 'faq', apiId: 'question' }, children: [{ el: 'Card' }] }] };
    const { data: d } = treeToPuck({ tree });
    const list = (d.content[0]!.props.children as PuckItem[])[0]!;
    expect(list.props.listKey).toBe('faq');
    expect(list.props.key).toBeUndefined();
    expect(puckToTree(d)).toEqual({ el: 'Stack', children: [{ el: 'CollectionList', props: { key: 'faq', apiId: 'question' }, children: [{ el: 'Card' }] }] });
    expect(treeLists(puckToTree(d)).map((l) => l.key)).toEqual(['faq']);
    expect(listSampleBinding({ key: 'faq', apiId: 'question' })).toEqual({ apiId: 'question', mode: 'collection', limit: 12 });
  });
});

describe('bindings inside and outside a list', () => {
  const d = data(
    item('Stack', {
      id: 'root',
      children: [
        item('Heading', { id: 'title' }),
        item('CollectionList', { id: 'list', listKey: 'list', apiId: 'question', children: [item('Card', { id: 'card', children: [item('Heading', { id: 'q' })] })] }),
      ],
    }),
  );

  it("an item template's bindings offer the list type's fields; entryUrl comes from its detail page", () => {
    expect(enclosingList(d, 'q')?.props.id).toBe('list');
    // The list itself is outside its own template.
    expect(enclosingList(d, 'list')).toBeNull();
    const scope = bindScope(d, 'q', TYPES, undefined, null);
    expect(scope).toMatchObject({ inList: true, apiId: 'question' });
    const heading = sourceOptions({ el: 'Heading', prop: 'text' }, { type: scope.type, fields: {}, urlPattern: scope.urlPattern });
    expect(heading.entry.map((o) => o.name)).toEqual(['title', 'answer', 'slug']);
    const href = sourceOptions({ el: 'Button', prop: 'href' }, { type: scope.type, fields: {}, urlPattern: scope.urlPattern });
    expect(href.entryUrl).toBe(true);
    // No detail page and no URL pattern: no entry link.
    expect(sourceOptions({ el: 'Button', prop: 'href' }, { type: product, fields: {} }).entryUrl).toBe(false);
  });

  it('outside the list, entry.* is not offered without a block binding', () => {
    const scope = bindScope(d, 'title', TYPES, undefined, null);
    expect(scope).toMatchObject({ inList: false, type: null });
    expect(sourceOptions({ el: 'Heading', prop: 'text' }, { type: scope.type, fields: {} }).entry).toEqual([]);
  });

  it('private types are not offered in the type picker; detail paths skip them', () => {
    expect(bindableTypes(TYPES).map((t) => t.apiId)).toEqual(['question', 'product']);
    expect(detailPathsOf(TYPES)).toEqual({ question: { path: '/questions/{slug}', slugField: 'slug' } });
    expect([...detailTypesOf(TYPES)]).toEqual(['question']);
  });
});

describe('palette and slot rules', () => {
  it('Collection list sits in the "Data" category, hidden in a collection-bound block', () => {
    expect(paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false }).data).toEqual({ title: 'Data', components: ['CollectionList'], visible: true });
    expect(paletteCategories({ collection: true, overlayRoot: false, emptyRoot: false }).data.visible).toBe(false);
    expect(paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false }).content.components).not.toContain('CollectionList');
  });

  it('an item template refuses Slot, Carousel, regions and nested lists', () => {
    const r = slotRules('CollectionList', false).disallow ?? [];
    for (const el of ['Slot', 'Carousel', 'Region', 'PageContent', 'Overlay', 'CollectionList']) expect(r).toContain(el);
    expect(r).toContain(templateName('list-with-heading'));
    expect(slotRules('Box', true).disallow).toContain('CollectionList');
    expect(slotRules('Box', false).disallow).not.toContain('CollectionList');
  });

  it('palette Enter never inserts a Carousel inside a list', () => {
    const d = data(
      item('Stack', { id: 'root', children: [item('CollectionList', { id: 'list', listKey: 'list', apiId: 'question', children: [item('Card', { id: 'card', children: [] })] })] }),
    );
    // Card in the list refuses it, the list refuses it, the root Stack takes it.
    expect(paletteInsertTarget(d, 'card', 'Carousel', false)).toEqual({ zone: 'root:children', index: 1 });
    expect(paletteInsertTarget(d, 'card', 'Heading', false)).toEqual({ zone: 'card:children', index: 0 });
  });
});

describe('"List with heading" template', () => {
  const stub = (() => null) as never;
  const config = buildBuilderConfig({
    collection: false, token: stub, sources: stub, showIf: stub, allow: stub, tracks: stub, style: stub, responsiveSelect: stub, length: stub,
    action: stub, pattern: stub, regionLabel: stub, options: stub, icon: stub, childItems: stub, render: () => stub, root: stub,
  });

  it.each(['en-US', 'vi-VN', 'fr-FR', 'id-ID'])('%s: inserted and filled, it validates with the title once and a Card per entry', (locale) => {
    const tpl = BUILDER_TEMPLATES.find((t) => t.id === 'list-with-heading')!;
    const tree = JSON.parse(JSON.stringify(tpl.tree(locale)).replace('"apiId":""', '"apiId":"question"'));
    const spec = { ...emptySpec(), name: 'Questions', label: { 'en-US': 'Questions' }, tree };
    expect(validateComposedSpec(spec, { detailTypes: new Set(['question']) })).toEqual([]);
  });

  it('a palette insert gets the key and the type', () => {
    const props = structuredClone((config.components[templateName('list-with-heading')] as { defaultProps: Record<string, unknown> }).defaultProps);
    let n = 0;
    const ids = (type: string, p: Record<string, unknown>): PuckItem => ({
      type,
      props: { ...p, ...(Array.isArray(p.children) ? { children: (p.children as { type: string; props: Record<string, unknown> }[]).map((c) => ids(c.type, c.props)) } : {}), id: `${type}-${++n}` },
    });
    const before = data(item('Box', { id: 'root', children: [] }));
    const after = data(item('Box', { id: 'root', children: [ids(templateName('list-with-heading'), props)] }));
    const expanded = expandTemplates(after)!;
    const filled = fillListDefaults(before, expanded, {}, 'question')!;
    const tree = puckToTree(filled);
    const list = tree.children![0]!.children!.find((c) => c.el === 'CollectionList')!;
    expect(list.props).toMatchObject({ key: 'list', apiId: 'question' });
    expect(tree.children![0]!.children!.map((c) => c.el)).toEqual(['Heading', 'Text', 'CollectionList', 'Button']);
  });
});
