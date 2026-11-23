import { describe, expect, it } from 'vitest';
import { defineContentType, f, type ComposedBlockSpec } from '@opencloudcms/schema';
import { checkSpecAgainstTypes, composedBlockProblems } from '../../src/block-builder/blocks-checks';

const product = defineContentType({
  id: 'ct_product',
  apiId: 'product',
  displayName: 'Product',
  fields: {
    name: f.text({ id: 'fld_name' }),
    slug: f.slug({ id: 'fld_slug', unique: true }),
    body: f.richText({ id: 'fld_body' }),
    price: f.money({ id: 'fld_price' }),
    stock: f.number({ id: 'fld_stock', indexed: true }),
    active: f.boolean({ id: 'fld_active', indexed: true }),
    color: f.text({ id: 'fld_color' }),
    launched: f.date({ id: 'fld_launched' }),
    photo: f.asset({ id: 'fld_photo' }),
    gallery: f.asset({ id: 'fld_gallery', multiple: true }),
    site: f.url({ id: 'fld_site' }),
    brand: f.reference({ id: 'fld_brand', target: 'brand' }),
  },
});
const types = [product];

const spec = (over: Partial<ComposedBlockSpec> = {}, binding: Partial<NonNullable<ComposedBlockSpec['binding']>> = {}): ComposedBlockSpec => ({
  id: 'blk_abc123',
  name: 'ProductTile',
  label: { 'en-US': 'Product tile' },
  category: 'Shop',
  version: 1,
  binding: { apiId: 'product', mode: 'collection', urlPattern: '/products/{slug}', ...binding },
  fields: {},
  tree: {
    el: 'Card',
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Text', bind: { html: { from: 'entry', path: 'body' } } },
      { el: 'Image', bind: { src: { from: 'entry', path: 'photo' }, alt: { from: 'entry', path: 'name' } } },
      { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
      { el: 'Date', bind: { value: { from: 'entry', path: 'launched' } } },
      { el: 'Button', bind: { label: { from: 'const', value: 'Open' }, href: { from: 'entryUrl' } } },
      { el: 'Badge', showIf: { from: 'entry', path: 'stock', is: 'absent' }, bind: { text: { from: 'const', value: 'Sold out' } } },
    ],
  },
  ...over,
});

const msgs = (issues: { path: (string | number)[]; message: string }[]) => issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('checkSpecAgainstTypes', () => {
  it('accepts a spec whose bindings match the content type', () => {
    expect(checkSpecAgainstTypes(spec({}, { filter: [{ field: 'active', value: true }, { field: 'stock', value: 0 }], sort: { field: 'createdAt', direction: 'desc' } }), types)).toEqual([]);
    expect(checkSpecAgainstTypes(spec({}, { sort: { field: 'slug', direction: 'asc' } }), types)).toEqual([]);
  });

  it('ignores specs without a binding', () => {
    const s = spec({ binding: undefined, tree: { el: 'Heading', bind: { text: { from: 'const', value: 'Hi' } } } });
    expect(checkSpecAgainstTypes(s, [])).toEqual([]);
  });

  it('reports an unknown content type', () => {
    expect(msgs(checkSpecAgainstTypes(spec({}, { apiId: 'nope' }), types))).toEqual(['binding.apiId: unknown content type "nope"']);
  });

  it('reports entry paths, showIf paths and url placeholders that do not exist', () => {
    const s = spec({}, { urlPattern: '/p/{handle}' });
    s.tree.children![0].bind = { text: { from: 'entry', path: 'title' } };
    s.tree.children![6].showIf = { from: 'entry', path: 'qty', is: 'present' };
    expect(msgs(checkSpecAgainstTypes(s, types))).toEqual([
      'binding.urlPattern: field "handle" does not exist on "product"',
      'tree.children.0.bind.text.path: field "title" does not exist on "product"',
      'tree.children.6.showIf.path: field "qty" does not exist on "product"',
    ]);
  });

  it('checks the kind of the bound field against the element prop (§5.4)', () => {
    const s = spec();
    s.tree.children = [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'price' } } },
      { el: 'Text', bind: { html: { from: 'entry', path: 'name' } } },
      { el: 'Image', bind: { src: { from: 'entry', path: 'name' } } },
      { el: 'Price', bind: { value: { from: 'entry', path: 'launched' } } },
      { el: 'Date', bind: { value: { from: 'entry', path: 'stock' } } },
      { el: 'Button', bind: { href: { from: 'entry', path: 'slug' }, label: { from: 'entry', path: 'slug' } } },
      { el: 'Image', bind: { src: { from: 'entry', path: 'site' } } },
      { el: 'Text', bind: { text: { from: 'entry', path: 'body' } } },
    ];
    expect(msgs(checkSpecAgainstTypes(s, types))).toEqual([
      'tree.children.0.bind.text.path: Heading.text cannot show field "price" (money); allowed kinds: text, longText, slug, email',
      'tree.children.1.bind.html.path: Text.html cannot show field "name" (text); allowed kinds: richText',
      'tree.children.2.bind.src.path: Image.src cannot show field "name" (text); allowed kinds: asset, url',
      'tree.children.3.bind.value.path: Price.value cannot show field "launched" (date); allowed kinds: number, money',
      'tree.children.4.bind.value.path: Date.value cannot show field "stock" (number); allowed kinds: date, datetime',
      'tree.children.5.bind.href.path: Button.href cannot show field "slug" (slug); allowed kinds: url',
      'tree.children.7.bind.text.path: Text.text cannot show field "body" (richText); allowed kinds: text, longText, slug, email',
    ]);
  });

  it('rejects multiple and reference fields everywhere', () => {
    const s = spec({}, { urlPattern: '/p/{brand}' });
    s.tree.children = [
      { el: 'Image', bind: { src: { from: 'entry', path: 'gallery' } } },
      { el: 'Badge', showIf: { from: 'entry', path: 'brand', is: 'present' } },
    ];
    expect(msgs(checkSpecAgainstTypes(s, types))).toEqual([
      'binding.urlPattern: field "brand" is a reference or multiple field and cannot be used',
      'tree.children.0.bind.src.path: field "gallery" is a reference or multiple field and cannot be used',
      'tree.children.1.showIf.path: field "brand" is a reference or multiple field and cannot be used',
    ]);
  });

  it('allows filter and sort only on indexed or unique fields, and checks filter values', () => {
    const s = spec({}, {
      filter: [{ field: 'color', value: 'red' }, { field: 'missing', value: 1 }, { field: 'active', value: 'yes' }, { field: 'stock', value: '3' }],
      sort: { field: 'name', direction: 'asc' },
    });
    expect(msgs(checkSpecAgainstTypes(s, types))).toEqual([
      'binding.filter.0.field: field "color" is not indexed; filters need an indexed or unique field',
      'binding.filter.1.field: field "missing" does not exist on "product"',
      'binding.filter.2.value: field "active" needs a boolean value',
      'binding.filter.3.value: field "stock" needs a number value',
      'binding.sort.field: field "name" is not indexed; sort needs an indexed or unique field (or createdAt, updatedAt, publishedAt)',
    ]);
  });

  it('accepts meta fields where they make sense', () => {
    const s = spec({}, { urlPattern: '/p/{documentId}', sort: { field: 'publishedAt', direction: 'desc' } });
    s.tree.children = [{ el: 'Date', bind: { value: { from: 'entry', path: 'createdAt' } } }];
    expect(checkSpecAgainstTypes(s, types)).toEqual([]);
  });
});

describe('composedBlockProblems', () => {
  it('maps block names to readable problems (empty list when fine)', () => {
    const ok = spec();
    const bad = spec({ id: 'blk_bbb222', name: 'Broken' }, { filter: [{ field: 'color', value: 'red' }] });
    expect(composedBlockProblems([ok, bad], types)).toEqual({
      ProductTile: [],
      Broken: ['binding.filter.0.field: field "color" is not indexed; filters need an indexed or unique field'],
    });
  });
});
