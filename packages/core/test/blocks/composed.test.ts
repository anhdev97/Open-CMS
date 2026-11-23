import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUCK_FORMAT_VERSION,
  coreBlocks,
  defineBlocks,
  defineComposedBlock,
  resolvePage,
  toPuckConfig,
  writePageContent,
  type ComposedBlockSpec,
  type ContentFetcher,
  type CustomFieldRenderers,
  type Entry,
} from '../../blocks/src';
import { readEntryImage, readEntryMoney } from '../../blocks/src/composed/values';
import { GRID_N } from '../../blocks/src/ui/tokens';

afterEach(() => vi.restoreAllMocks());

const html = (node: unknown) => renderToString(node as never);
const render = (def: { render: (p: never) => unknown }, props: Record<string, unknown>) => html(def.render(props as never));

const base = (over: Partial<ComposedBlockSpec>): ComposedBlockSpec => ({
  id: 'blk_test01',
  name: 'TestBlock',
  label: { 'en-US': 'Test block' },
  category: 'commerce',
  version: 1,
  fields: {},
  tree: { el: 'Box' },
  ...over,
});

const productCard = (name = 'ProductCard') =>
  base({
    name,
    binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' },
    fields: { ctaLabel: { kind: 'text', label: { 'en-US': 'Button label' }, default: 'Buy now' } },
    tree: {
      el: 'Card',
      props: { padding: '4' },
      children: [
        { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'name' } } },
        { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
        { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
        { el: 'Button', props: { variant: 'default' }, bind: { label: { from: 'field', name: 'ctaLabel' }, href: { from: 'entryUrl' } } },
      ],
    },
  });

const productGrid = (over: Partial<NonNullable<ComposedBlockSpec['binding']>> = {}, name = 'ProductList') =>
  base({
    name,
    binding: {
      apiId: 'product',
      mode: 'collection',
      filter: [{ field: 'active', value: true }],
      sort: { field: 'createdAt', direction: 'desc' },
      limit: 8,
      layout: { kind: 'grid', columns: 4 },
      options: { emptyText: { 'en-US': 'No products yet', 'vi-VN': 'Chưa có sản phẩm' } },
      ...over,
    },
    tree: { el: 'Card', children: [{ el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } }] },
  });

const product = (documentId: string, extra: Record<string, unknown> = {}): Entry => ({
  documentId,
  name: `Name ${documentId}`,
  slug: documentId,
  price: { amount: 19.5, currency: 'USD' },
  image: 'https://cdn.example/p.png',
  ...extra,
});

describe('defineComposedBlock: fields', () => {
  it('single: manual fields by name + entry', () => {
    const def = defineComposedBlock(productCard());
    expect(Object.keys(def.fields)).toEqual(['ctaLabel', 'entry']);
    expect(def.fields.ctaLabel).toMatchObject({ kind: 'text', default: 'Buy now' });
    expect(def.fields.entry).toMatchObject({ kind: 'entry', apiId: 'product' });
    expect(def.composed).toBe(true);
    expect(def.name).toBe('ProductCard');
    expect(def.version).toBe(1);
  });

  it('collection: entries with baseFilter/defaultSort/lockLimit and query default; layout when editorLayout', () => {
    const def = defineComposedBlock(productGrid({ options: { editorSort: true, editorLayout: true } }));
    expect(def.fields.entries).toMatchObject({
      kind: 'entries',
      apiId: 'product',
      limit: 8,
      sortable: true,
      filterable: false,
      baseFilter: { active: 'true' },
      defaultSort: 'createdAt:desc',
      lockLimit: true,
      default: { mode: 'query', limit: 8, sort: 'createdAt:desc' },
    });
    expect(def.fields.layout).toMatchObject({ kind: 'select', default: 'grid-4' });
    expect(Object.keys(defineComposedBlock(productGrid({}, 'NoLayout')).fields)).toEqual(['entries']);
  });

  it('manual select keeps options; slots are named slot, slot2 in tree order', () => {
    const def = defineComposedBlock(
      base({
        fields: { tone: { kind: 'select', options: ['a', 'b'], default: 'b' } },
        tree: { el: 'Stack', children: [{ el: 'Slot', props: { allow: ['Hero'] } }, { el: 'Box', children: [{ el: 'Slot' }] }] },
      }),
    );
    expect(def.fields.tone).toMatchObject({ kind: 'select', options: ['a', 'b'], default: 'b' });
    expect(def.fields.slot).toMatchObject({ kind: 'slot', allow: ['Hero'] });
    expect(def.fields.slot2).toMatchObject({ kind: 'slot' });
  });

  it('invalid (hand-edited) spec throws with the issue list naming the block', () => {
    const bad = { ...productCard('Broken'), tree: { el: 'Marquee' } } as unknown as ComposedBlockSpec;
    expect(() => defineComposedBlock(bad)).toThrow(/Composed block "Broken"[\s\S]*tree\.el: unknown element "Marquee"/);
    try {
      defineComposedBlock(bad);
    } catch (e) {
      expect((e as { issues?: unknown[] }).issues).toEqual([{ path: ['tree', 'el'], message: 'unknown element "Marquee"' }]);
    }
  });

  it('a manual field that collides with a generated field name is an issue', () => {
    const spec = productCard('Clash');
    spec.fields = { ...spec.fields, entry: { kind: 'text' } };
    expect(() => defineComposedBlock(spec)).toThrow(/fields\.entry/);
  });

  it('defineBlocks names the composed block on duplicate names and on a bad manual default', () => {
    const a = defineComposedBlock(productCard('Hero'));
    expect(() => defineBlocks([...coreBlocks, a])).toThrow(/Block "Hero": duplicate name/);
    const spec = base({ name: 'BadDefault', fields: { n: { kind: 'number', default: 'x' } } });
    expect(() => defineBlocks([defineComposedBlock(spec)])).toThrow(/BadDefault[\s\S]*default "x" is not a number/);
  });
});

describe('defineComposedBlock: render', () => {
  it('single: renders name, price, image and entry URL', () => {
    const def = defineComposedBlock(productCard());
    const out = render(def, { ctaLabel: 'Buy now', entry: product('abc'), _locale: 'en-US' });
    expect(out).toContain('<h3');
    expect(out).toContain('Name abc');
    expect(out).toContain('$19.50');
    expect(out).toContain('src="https://cdn.example/p.png"');
    expect(out).toContain('alt="Name abc"');
    expect(out).toContain('href="/products/abc"');
    expect(out).toContain('Buy now');
  });

  it('single: price is formatted for _locale', () => {
    const def = defineComposedBlock(productCard());
    const out = render(def, { ctaLabel: 'x', entry: product('abc', { price: { amount: 1234.5, currency: 'EUR' } }), _locale: 'fr-FR' });
    expect(out).toMatch(/1\s?234,50\s?€/);
  });

  it('entryUrl: missing slug renders the button as a span', () => {
    const def = defineComposedBlock(productCard());
    const out = render(def, { ctaLabel: 'Buy', entry: product('abc', { slug: '' }), _locale: 'en-US' });
    expect(out).not.toContain('<a');
    expect(out).toMatch(/<span[^>]*data-slot="button"[^>]*>Buy<\/span>/);
  });

  it('entryUrl: placeholder values are URL-encoded', () => {
    const def = defineComposedBlock(productCard());
    expect(render(def, { ctaLabel: 'Buy', entry: product('abc', { slug: 'a b/c' }) })).toContain('href="/products/a%20b%2Fc"');
  });

  it('single without entry: placeholder only in the editor', () => {
    const def = defineComposedBlock(productCard());
    expect(render(def, { ctaLabel: 'x', entry: null, _locale: 'en-US' })).toBe('');
    const editor = render(def, { ctaLabel: 'x', entry: null, _locale: 'vi-VN', _editor: true });
    expect(editor).toContain('data-composed-placeholder');
  });

  it('collection: one item template per entry inside the layout grid', () => {
    const def = defineComposedBlock(productGrid());
    const out = render(def, { entries: [product('a'), product('b'), product('c')], _locale: 'en-US' });
    expect(out).toContain(GRID_N[4]);
    expect(out.match(/data-slot="card"/g)).toHaveLength(3);
    expect(out).toContain('Name a');
    expect(out).toContain('Name c');
  });

  it('collection: empty → emptyText in _locale', () => {
    const def = defineComposedBlock(productGrid());
    expect(render(def, { entries: [], _locale: 'vi-VN' })).toContain('Chưa có sản phẩm');
    expect(render(def, { entries: [], _locale: 'fr-FR' })).toContain('No products yet');
    const none = defineComposedBlock(productGrid({ options: {} }, 'NoEmpty'));
    expect(render(none, { entries: [] })).toBe('');
    expect(render(none, { entries: [], _editor: true })).toContain('data-composed-placeholder');
  });

  it('collection: editor layout overrides the spec layout', () => {
    const def = defineComposedBlock(productGrid({ options: { editorLayout: true } }));
    const list = render(def, { entries: [product('a')], layout: 'list' });
    expect(list).not.toContain(GRID_N[4]);
    expect(list).toContain('flex-col');
    expect(render(def, { entries: [product('a')], layout: 'grid-2' })).toContain(GRID_N[2]);
  });

  it('unbound: manual field values and const, showIf present/absent', () => {
    const def = defineComposedBlock(
      base({
        name: 'Promo',
        fields: { title: { kind: 'text' }, note: { kind: 'text' }, cta: { kind: 'link' } },
        tree: {
          el: 'Stack',
          props: { direction: 'vertical' },
          children: [
            { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'title' } } },
            { el: 'Badge', bind: { text: { from: 'const', value: 'NEW' } } },
            { el: 'Text', showIf: { from: 'field', name: 'note', is: 'present' }, bind: { text: { from: 'field', name: 'note' } } },
            { el: 'Text', showIf: { from: 'field', name: 'note', is: 'absent' }, bind: { text: { from: 'const', value: 'no note' } } },
            { el: 'Button', bind: { label: { from: 'const', value: 'Go' }, href: { from: 'field', name: 'cta' } } },
          ],
        },
      }),
    );
    const withNote = render(def, { title: 'Hello', note: 'A note', cta: { href: '/go' } });
    expect(withNote).toContain('<h2');
    expect(withNote).toContain('Hello');
    expect(withNote).toContain('NEW');
    expect(withNote).toContain('A note');
    expect(withNote).not.toContain('no note');
    expect(withNote).toContain('href="/go"');
    const noNote = render(def, { title: 'Hello', note: '', cta: { href: 'javascript:alert(1)' } });
    expect(noNote).toContain('no note');
    expect(noNote).not.toContain('javascript');
  });

  it('showIf on an entry path', () => {
    const def = defineComposedBlock(
      base({
        name: 'SaleCard',
        binding: { apiId: 'product', mode: 'single' },
        tree: { el: 'Box', children: [{ el: 'Badge', showIf: { from: 'entry', path: 'salePrice', is: 'present' }, bind: { text: { from: 'const', value: 'Sale' } } }] },
      }),
    );
    expect(render(def, { entry: product('a', { salePrice: { amount: 5, currency: 'USD' } }) })).toContain('Sale');
    expect(render(def, { entry: product('a', { salePrice: null }) })).not.toContain('Sale');
  });

  it('Date element formats in _locale with an optional timeZone', () => {
    const def = defineComposedBlock(
      base({
        name: 'Dated',
        binding: { apiId: 'post', mode: 'single' },
        tree: {
          el: 'Box',
          children: [
            { el: 'Date', props: { format: 'long', timeZone: 'Asia/Ho_Chi_Minh' }, bind: { value: { from: 'entry', path: 'at' } } },
            { el: 'Date', props: { format: 'long' }, bind: { value: { from: 'entry', path: 'day' } } },
          ],
        },
      }),
    );
    const out = render(def, { entry: { documentId: 'x', at: '2026-11-22T19:00:00.000Z', day: '2026-11-23' }, _locale: 'en-US' });
    expect(out.match(/November 23, 2026/g)).toHaveLength(2);
  });

  it('missing entry path → empty value and one console.warn per (block, path)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const def = defineComposedBlock(productGrid({}, 'WarnOnce'));
    const out = render(def, { entries: [{ documentId: 'a' }, { documentId: 'b' }] });
    render(def, { entries: [{ documentId: 'c' }] });
    expect(out.match(/<h3[^>]*><\/h3>/g)).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/WarnOnce.*"name"/);
  });

  it('richText manual field: stored HTML is sanitized; a transformed element renders in place', () => {
    const def = defineComposedBlock(
      base({ name: 'Rich', fields: { body: { kind: 'richText' } }, tree: { el: 'Text', bind: { html: { from: 'field', name: 'body' } } } }),
    );
    const out = render(def, { body: '<p>ok</p><img src=x onerror=alert(1)>' });
    expect(out).toContain('ok');
    expect(out).not.toContain('onerror');
  });

  it('Puck config passes _locale and _editor (puck.isEditing) to composed renders only', () => {
    const def = defineComposedBlock(productCard('Wired'));
    const NONE = (() => null) as never;
    const fields = { link: NONE, image: NONE, entry: NONE, entries: NONE } as CustomFieldRenderers;
    const config = toPuckConfig(defineBlocks([def]), { locale: 'en-US', customFields: fields });
    const r = config.components.Wired.render as unknown as (p: Record<string, unknown>) => unknown;
    expect(html(r({ ctaLabel: 'x', entry: null, puck: { isEditing: true } }))).toContain('data-composed-placeholder');
    expect(html(r({ ctaLabel: 'x', entry: null, puck: { isEditing: false } }))).toBe('');
    expect(html(r({ ctaLabel: 'x', entry: product('a', { price: { amount: 2, currency: 'EUR' } }), _locale: 'fr-FR' }))).toMatch(/2,00\s?€/);
  });
});

describe('entry value readers', () => {
  it('asset: URL string or {url|src, alt} object; a bare asset id has no URL', () => {
    expect(readEntryImage('https://cdn.example/a.png')).toEqual({ src: 'https://cdn.example/a.png', alt: '' });
    expect(readEntryImage('/a.png')).toEqual({ src: '/a.png', alt: '' });
    expect(readEntryImage({ url: 'https://x/a.png', alt: 'A' })).toEqual({ src: 'https://x/a.png', alt: 'A' });
    expect(readEntryImage({ src: '/b.png', alt: null })).toEqual({ src: '/b.png', alt: '' });
    expect(readEntryImage('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(readEntryImage('javascript:alert(1)')).toBeNull();
    expect(readEntryImage(null)).toBeNull();
  });
  it('money: {amount, currency} | number | numeric string', () => {
    expect(readEntryMoney({ amount: 19.5, currency: 'USD' })).toEqual({ value: 19.5, currency: 'USD' });
    expect(readEntryMoney({ amount: '7.25', currency: 'EUR' })).toEqual({ value: 7.25, currency: 'EUR' });
    expect(readEntryMoney(3)).toEqual({ value: 3 });
    expect(readEntryMoney('4.5')).toEqual({ value: 4.5 });
    expect(readEntryMoney(null)).toBeNull();
    expect(readEntryMoney({ amount: null, currency: 'USD' })).toBeNull();
  });
});

describe('resolvePage with composed blocks', () => {
  const item = (type: string, props: Record<string, unknown>, id = type) => ({ type, props: { id, _v: 1, ...props } });
  const page = (content: unknown[]) => ({
    format: 'puck' as const,
    formatVersion: PUCK_FORMAT_VERSION,
    data: { root: { props: {} }, content } as never,
  });
  const O = { locale: 'vi-VN', defaultLocale: 'en-US' } as never;
  const fake = () => {
    const calls = { query: [] as unknown[][], byIds: [] as unknown[][] };
    const f: ContentFetcher = {
      byIds: async (apiId, ids, locale) => {
        calls.byIds.push([apiId, ids, locale]);
        return ids.map((id) => product(id, { active: id !== 'off' }));
      },
      query: async (apiId, q, locale) => {
        calls.query.push([apiId, q, locale]);
        return [product('q1')];
      },
      pagePaths: async () => ({}),
    };
    return { f, calls };
  };

  it('baseFilter wins over a stored filter on the same field; other stored filters are kept (AND)', async () => {
    const reg = defineBlocks([defineComposedBlock(productGrid({ options: { editorFilter: true } }))]);
    const { f, calls } = fake();
    await resolvePage(page([item('ProductList', { entries: { mode: 'query', filter: { active: 'false', brand: 'x' }, limit: 8 } })]), reg, f, O);
    expect(calls.query).toHaveLength(1);
    expect((calls.query[0][1] as { filter: unknown }).filter).toEqual({ active: 'true', brand: 'x' });
  });

  it('lockLimit ignores the stored limit; defaultSort applies when the editor may not sort', async () => {
    const reg = defineBlocks([defineComposedBlock(productGrid())]);
    const { f, calls } = fake();
    await resolvePage(page([item('ProductList', { entries: { mode: 'query', limit: 50, sort: 'name:asc' } })]), reg, f, O);
    expect(calls.query[0][1]).toEqual({ filter: { active: 'true' }, sort: 'createdAt:desc', limit: 8 });
  });

  it('editorLimit/editorSort: the stored limit and sort are used', async () => {
    const reg = defineBlocks([defineComposedBlock(productGrid({ options: { editorLimit: true, editorSort: true } }))]);
    const { f, calls } = fake();
    await resolvePage(page([item('ProductList', { entries: { mode: 'query', limit: 50, sort: 'name:asc' } })]), reg, f, O);
    expect(calls.query[0][1]).toEqual({ filter: { active: 'true' }, sort: 'name:asc', limit: 50 });
    await resolvePage(page([item('ProductList', { entries: { mode: 'query' } })]), reg, f, O);
    expect(calls.query[1][1]).toMatchObject({ sort: 'createdAt:desc' });
  });

  it('picked entries that do not match baseFilter are dropped; picks are capped by a locked limit', async () => {
    const reg = defineBlocks([defineComposedBlock(productGrid({ limit: 2 }))]);
    const { f } = fake();
    const out = await resolvePage(page([item('ProductList', { entries: { mode: 'pick', ids: ['a', 'off', 'b', 'c'] } })]), reg, f, O);
    const props = (out.content[0] as { props: { entries: Entry[] } }).props;
    expect(props.entries.map((e) => e.documentId)).toEqual(['a', 'b']);
  });

  it('_locale is stamped on composed items only and stripped by writePageContent', async () => {
    const card = defineComposedBlock(productCard());
    const reg = defineBlocks([...coreBlocks, card]);
    const { f } = fake();
    const out = await resolvePage(
      page([item('ProductCard', { ctaLabel: 'Buy', entry: { documentId: 'a' } }), item('Heading', { text: 'Hi' })]),
      reg,
      f,
      O,
    );
    const [c, h] = out.content as { props: Record<string, unknown> }[];
    expect(c.props._locale).toBe('vi-VN');
    expect(h.props._locale).toBeUndefined();
    const stored = writePageContent(out, reg);
    expect((stored.data.content[0] as { props: Record<string, unknown> }).props).not.toHaveProperty('_locale');
  });
});
