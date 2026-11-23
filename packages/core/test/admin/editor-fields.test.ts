import { describe, expect, it } from 'vitest';
import { b, coreBlocks, defineBlock, defineBlocks, writePageContent, type PuckData } from '@opencloudcms/core/blocks';
import {
  contentTypeOptions,
  dataSignature,
  editorFilterFields,
  entriesFieldControls,
  fixedConditionText,
  indexResolved,
  entriesApiId,
  filterableFields,
  fromEditorData,
  previewProps,
  readPath,
  siblingName,
  slotOverflows,
  toEditorData,
  tokenOptions,
  unknownBlockTypes,
} from '../../admin/src/page-editor/field-logic';
import { buildEditorConfig } from '../../admin/src/page-editor/editor-config';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';

const field = (name: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`,
  name,
  kind: 'text',
  required: false,
  localizable: false,
  indexed: false,
  unique: false,
  options: {},
  ...extra,
});

const product: ContentTypeDefinition = {
  id: 'ct_product',
  apiId: 'product',
  displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' },
  fields: [
    field('name', { indexed: true }),
    field('sku', { unique: true }),
    field('description', { kind: 'longText' }),
    field('price', { kind: 'number', indexed: true }),
    field('notes', { kind: 'json' }),
  ],
};

describe('EntriesField filter builder', () => {
  it('offers only the indexed or unique fields of the target type', () => {
    expect(filterableFields(product).map((f) => f.name)).toEqual(['name', 'sku', 'price']);
  });
  it('skips multi-value relations, which the list API cannot filter', () => {
    const tags = field('tags', { kind: 'taxonomy', indexed: true, options: { taxonomy: 't', multiple: true } });
    expect(filterableFields({ ...product, fields: [tags, field('name', { indexed: true })] }).map((f) => f.name)).toEqual(['name']);
  });
  it('offers nothing for a type without indexed/unique fields', () => {
    expect(filterableFields({ ...product, fields: [field('a'), field('b', { kind: 'longText' })] })).toEqual([]);
  });
});

describe('TokenField', () => {
  it('offers exactly the design-system tokens', () => {
    expect(tokenOptions('color')).toEqual(['primary', 'secondary', 'muted', 'accent', 'background', 'foreground', 'destructive']);
    expect(tokenOptions('spacing')).toEqual(['0', '2', '4', '6', '8', '12', '16', '24']);
  });
});

describe('content type select', () => {
  it('lists content types by localized name, hiding the core page type', () => {
    const page: ContentTypeDefinition = { id: 'p', apiId: 'opencloudcmsPage', displayName: 'Page', fields: [] };
    const post: ContentTypeDefinition = { id: 'c', apiId: 'post', displayName: 'Post', fields: [] };
    expect(contentTypeOptions([product, page, post], 'vi-VN')).toEqual([
      { value: 'product', label: 'Sản phẩm' },
      { value: 'post', label: 'Post' },
    ]);
  });
});

describe('apiIdFrom', () => {
  it('derives the sibling field name, also inside list rows', () => {
    expect(siblingName('source', 'apiId')).toBe('apiId');
    expect(siblingName('items[2].source', 'apiId')).toBe('items[2].apiId');
    expect(readPath({ items: [{}, {}, { apiId: 'post' }] }, 'items[2].apiId')).toBe('post');
    expect(readPath({ a: 1 }, 'b[0].c')).toBeUndefined();
  });
  it('reads the api id from the sibling prop when apiIdFrom is set, else the static apiId', () => {
    const dyn = b.entries('', { apiIdFrom: 'apiId' });
    expect(entriesApiId(dyn, { apiId: 'product' }, 'source')).toBe('product');
    expect(entriesApiId(dyn, { rows: [{ apiId: 'post' }] }, 'rows[0].source')).toBe('post');
    expect(entriesApiId(dyn, {}, 'source')).toBe('');
    expect(entriesApiId(b.entries('product'), { apiId: 'x' }, 'source')).toBe('product');
  });
});

describe('previewProps', () => {
  const fields = {
    title: b.text(),
    link: b.link(),
    image: b.image(),
    entry: b.entry('product'),
    entries: b.entries('product'),
    rows: b.list({ label: b.text(), link: b.link() }),
  };

  it('converts stored data values to safe render values before resolution', () => {
    const out = previewProps(fields, {
      id: 'x',
      title: 'Hi',
      link: { kind: 'url', href: '/a' },
      image: { assetId: 'a1', src: '/i.png', alt: 'I' },
      entry: { documentId: 'd1' },
      entries: { mode: 'pick', ids: ['d1'] },
      rows: [{ label: 'r', link: { kind: 'page', documentId: 'p1' } }],
    });
    expect(out).toMatchObject({
      id: 'x',
      title: 'Hi',
      link: { href: '/a' },
      image: { src: '/i.png', alt: 'I' },
      entry: null,
      entries: [],
      rows: [{ label: 'r', link: { href: null } }],
    });
  });

  it('uses resolved values only while the stored value they came from is unchanged', () => {
    const stored = { id: 'x', title: 'Hi', link: { kind: 'page', documentId: 'p1' }, entries: { mode: 'pick', ids: ['d1'] }, rows: [] };
    const resolved = {
      source: stored,
      props: { ...stored, link: { href: '/about' }, entries: [{ documentId: 'd1', name: 'A' }] },
    };
    expect(previewProps(fields, stored, resolved)).toMatchObject({ link: { href: '/about' }, entries: [{ documentId: 'd1', name: 'A' }] });
    const changed = { ...stored, link: { kind: 'page', documentId: 'p2' } };
    expect(previewProps(fields, changed, resolved)).toMatchObject({ link: { href: null }, entries: [{ documentId: 'd1', name: 'A' }] });
  });

  it('keeps non-data props (e.g. slot components) from the live props', () => {
    const slot = () => null;
    const out = previewProps({ children: b.slot(), title: b.text() }, { id: 'x', children: slot, title: 'new' }, {
      source: { id: 'x', children: [], title: 'old' },
      props: { id: 'x', children: [], title: 'old' },
    });
    expect(out.children).toBe(slot);
    expect(out.title).toBe('new');
  });
});

const registry = defineBlocks([
  defineBlock({ name: 'Box', label: 'Box', category: 'layout', fields: { children: b.slot({ max: 2 }), pad: b.spacing({ default: '4' }) }, render: () => null }),
  defineBlock({ name: 'Head', label: 'Head', category: 'basic', fields: { text: b.text(), color: b.color({ default: 'primary' }) }, render: () => null }),
  defineBlock({
    name: 'List',
    label: 'List',
    category: 'data',
    fields: { apiId: b.text(), source: b.entries('', { apiIdFrom: 'apiId' }) },
    render: () => null,
  }),
]);

const item = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } });

describe('slotOverflows', () => {
  it('reports slots holding more blocks than b.slot({ max }) allows', () => {
    const data: PuckData = {
      root: { props: {} },
      content: [
        item('Box', 'b1', { children: [item('Head', 'h1'), item('Head', 'h2')] }),
        item('Box', 'b2', { children: [item('Head', 'h3'), item('Head', 'h4'), item('Box', 'b3', { children: [item('Head', 'h5'), item('Head', 'h6'), item('Head', 'h7')] })] }),
      ],
    } as PuckData;
    expect(slotOverflows(data, registry)).toEqual([
      { id: 'b2', block: 'Box', slot: 'children', max: 2 },
      { id: 'b3', block: 'Box', slot: 'children', max: 2 },
    ]);
  });
});

describe('unknownBlockTypes', () => {
  it('lists block types missing from the registry, also nested and in zones', () => {
    const data = {
      root: { props: {} },
      content: [item('Gone', 'g1'), item('Box', 'b1', { children: [item('Old', 'o1')] })],
      zones: { 'b1:x': [item('Gone', 'g2')] },
    } as unknown as PuckData;
    expect(unknownBlockTypes(data, registry)).toEqual(['Gone', 'Old']);
  });
});

describe('toEditorData / fromEditorData', () => {
  it('puts title, path and SEO in the root props and takes them out again on save', () => {
    const content = writePageContent({ root: { props: {} }, content: [item('Head', 'h1', { text: 'Hi', color: 'primary' })] } as PuckData, registry);
    const data = toEditorData({ title: 'About', path: '/about', seo: { title: 'T', description: 'D', noindex: true } }, content.data);
    expect(data.root.props).toEqual({ title: 'About', path: '/about', seoTitle: 'T', seoDescription: 'D', seoNoindex: true });
    const body = fromEditorData(data, registry);
    expect(body.title).toBe('About');
    expect(body.path).toBe('/about');
    expect(body.seo).toEqual({ title: 'T', description: 'D', noindex: true });
    expect(body.content).toMatchObject({ format: 'puck', data: { root: { props: {} }, content: [{ type: 'Head', props: { id: 'h1', text: 'Hi', _v: 1 } }] } });
  });
  it('keeps stored SEO keys the editor does not edit (e.g. image) and overlays only the edited ones', () => {
    const stored = { title: 'Old', description: 'D', image: { src: '/og.png', alt: 'OG' }, custom: 1 };
    const data = toEditorData({ title: 'A', path: '/a', seo: stored }, { root: { props: {} }, content: [] } as PuckData);
    (data.root.props as Record<string, unknown>).seoTitle = 'New';
    (data.root.props as Record<string, unknown>).seoDescription = '';
    const body = fromEditorData(data, registry, stored);
    expect(body.seo).toEqual({ title: 'New', image: { src: '/og.png', alt: 'OG' }, custom: 1 });
  });
  it('omits empty SEO values', () => {
    const body = fromEditorData(toEditorData({ title: 'A', path: '/' }, { root: { props: {} }, content: [] } as PuckData), registry);
    expect(body.seo).toEqual({});
  });
});

describe('buildEditorConfig', () => {
  const renderers = {
    customFields: { entry: () => null as never, entries: () => null as never, link: () => null as never, image: () => null as never },
    token: () => null as never,
    contentType: () => null as never,
    unknown: () => null as never,
    wrapRender: (_name: string, render: unknown) => render,
  };

  it('turns color/spacing into token custom fields and the apiIdFrom sibling into a content type select', () => {
    const config = buildEditorConfig(registry, { locale: 'en-US', ...renderers }, []);
    const head = config.components.Head!.fields!;
    expect(head.color).toMatchObject({ type: 'custom', metadata: { blockField: { kind: 'color' } } });
    expect(config.components.Box!.fields!.pad).toMatchObject({ type: 'custom', metadata: { blockField: { kind: 'spacing' } } });
    expect(config.components.List!.fields!.apiId).toMatchObject({ type: 'custom', metadata: { contentTypeFor: 'source' } });
    expect(head.text).toMatchObject({ type: 'text' });
  });

  it('adds unknown blocks as delete-only components hidden from the drawer', () => {
    const config = buildEditorConfig(registry, { locale: 'en-US', ...renderers }, ['Gone']);
    expect(config.components.Gone).toMatchObject({ fields: {}, permissions: { edit: false, duplicate: false, insert: false, delete: true } });
    expect(Object.values(config.categories ?? {}).flatMap((c) => c.components ?? [])).not.toContain('Gone');
    expect(config.categories?.other).toMatchObject({ visible: false });
  });

  it('works for the core block library (EntryList gets a content type select)', () => {
    const config = buildEditorConfig(defineBlocks(coreBlocks), { locale: 'en-US', ...renderers }, []);
    expect(config.components.EntryList!.fields!.apiId).toMatchObject({ type: 'custom' });
    expect(config.root?.fields).toBeDefined();
  });
});

describe('preview resolution helpers', () => {
  const data = {
    root: { props: {} },
    content: [
      item('List', 'l1', { apiId: 'product', source: { mode: 'pick', ids: ['a'] } }),
      item('Head', 'h1', { text: 'Hi', color: 'primary' }),
    ],
  } as unknown as PuckData;

  it('dataSignature changes only when a data field (or an apiIdFrom sibling) changes', () => {
    const sig = dataSignature(data, registry);
    const textEdit = structuredClone(data);
    (textEdit.content[1]!.props as Record<string, unknown>).text = 'Changed';
    expect(dataSignature(textEdit, registry)).toBe(sig);
    const pick = structuredClone(data);
    (pick.content[0]!.props as Record<string, unknown>).source = { mode: 'pick', ids: ['b'] };
    expect(dataSignature(pick, registry)).not.toBe(sig);
    const type = structuredClone(data);
    (type.content[0]!.props as Record<string, unknown>).apiId = 'post';
    expect(dataSignature(type, registry)).not.toBe(sig);
  });

  it('indexResolved pairs stored and resolved props by block id', () => {
    const resolved = structuredClone(data);
    (resolved.content[0]!.props as Record<string, unknown>).source = [{ documentId: 'a' }];
    const map = indexResolved(data, resolved, registry);
    expect(map.get('l1')).toEqual({ source: data.content[0]!.props, props: resolved.content[0]!.props });
    expect(map.size).toBe(2);
  });
});

describe('editor stylesheet', () => {
  it('imports Puck CSS without its external font @import (blocked by the admin CSP, breaks the chunk load)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../admin/src/pages/PageEditor.tsx', import.meta.url), 'utf8');
    expect(src).toContain("import '@puckeditor/core/no-external.css';");
    expect(src).not.toContain('@puckeditor/core/puck.css');
    const css = fs.readFileSync(new URL('../../node_modules/@puckeditor/core/dist/no-external.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/@import\s+["']?(url\()?["']?https?:/);
  });
});

describe('entriesFieldControls', () => {
  const ef = (o: Record<string, unknown> = {}) => b.entries('product', o as never) as never;
  it('shows filter/sort/limit only as the field allows', () => {
    expect(entriesFieldControls(ef({ sortable: true, filterable: true, limit: 12 }))).toEqual({
      modeSelect: true, addFilter: true, sort: true, limit: true, lockedLimit: null, fixed: [],
    });
    // unset → shown (resolvePage still applies stored filters/sort); explicit false → hidden
    expect(entriesFieldControls(ef({ limit: 12 }))).toMatchObject({ modeSelect: true, addFilter: true, sort: true, limit: true });
    expect(entriesFieldControls(ef({ filterable: false }))).toMatchObject({ modeSelect: false, addFilter: false });
    expect(entriesFieldControls(ef({ sortable: false }))).toMatchObject({ sort: false, addFilter: true });
  });
  it('locked limit and fixed filters (composed collections)', () => {
    const c = entriesFieldControls(ef({ limit: 8, lockLimit: true, filterable: false, sortable: false, baseFilter: { featured: 'true', stock: '3' } }));
    expect(c).toEqual({
      modeSelect: false, addFilter: false, sort: false, limit: false, lockedLimit: 8,
      fixed: [{ field: 'featured', value: 'true' }, { field: 'stock', value: '3' }],
    });
  });
  it('fixed-filter fields are not offered as editor filters', () => {
    const fields = [field('name', { indexed: true }), field('featured', { kind: 'boolean', indexed: true })];
    expect(editorFilterFields(fields as never, ef({ filterable: true, baseFilter: { featured: 'true' } })).map((f: { name: string }) => f.name)).toEqual(['name']);
  });
  it('labels a fixed condition with the field label and a readable value', () => {
    expect(fixedConditionText({ field: 'featured', value: 'true' }, field('featured', { kind: 'boolean', label: 'Featured' }), (k: string) => (k.endsWith('yes') ? 'Yes' : 'No'))).toBe('Featured = Yes');
    expect(fixedConditionText({ field: 'stock', value: '3' }, undefined, () => '')).toBe('stock = 3');
  });
});
