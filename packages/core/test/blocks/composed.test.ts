import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual as isEqual } from 'node:util';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUCK_FORMAT_VERSION,
  b,
  coreBlocks,
  defineBlock,
  defineBlocks,
  adminFetcher,
  defineComposedBlock,
  publicFetcher,
  resolvePage,
  toPuckConfig,
  writePageContent,
  type ComposedBlockSpec,
  type ContentFetcher,
  type CustomFieldRenderers,
  type Entry,
} from '../../blocks/src';
import { composedKind, validateComposedSpec, validateTheme } from '@opencloudcms/schema';
import { loadComposedBlocks, loadConfig, loadTheme, printComposedBlockFile, printThemeFile } from '@opencloudcms/codegen';
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

  it('defineBlocks names the composed block on duplicate names; a bad manual default fails the spec check', () => {
    const a = defineComposedBlock(productCard('Hero'));
    expect(() => defineBlocks([...coreBlocks, a])).toThrow(/Block "Hero": duplicate name/);
    const spec = base({ name: 'BadDefault', fields: { n: { kind: 'number', default: 'x' } } });
    expect(() => defineComposedBlock(spec)).toThrow(/BadDefault[\s\S]*fields\.n\.default: default must be a number/);
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

  it('Price showCurrency: currency shown by default, plain number when false', () => {
    const spec = (showCurrency?: boolean) =>
      base({
        name: showCurrency === false ? 'PlainPrice' : 'CurPrice',
        binding: { apiId: 'product', mode: 'single' },
        tree: { el: 'Price', props: showCurrency === undefined ? {} : { showCurrency }, bind: { value: { from: 'entry', path: 'price' } } },
      });
    const e = { entry: product('a', { price: { amount: 1234.5, currency: 'USD' } }), _locale: 'en-US' };
    expect(render(defineComposedBlock(spec()), e)).toContain('$1,234.50');
    const plain = render(defineComposedBlock(spec(false)), e);
    expect(plain).toContain('1,234.5');
    expect(plain).not.toContain('$');
    expect(render(defineComposedBlock(spec()), { entry: product('a', { price: 7 }), _locale: 'en-US' })).toContain('>7<');
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

  it('Puck config passes _locale and _editor to usesLocale blocks, not to other hand-written blocks', () => {
    const seen: Record<string, unknown>[] = [];
    const mk = (name: string, usesLocale?: true) =>
      defineBlock({ name, label: name, category: 'x', ...(usesLocale ? { usesLocale } : {}), fields: {}, render: (p) => (seen.push(p as never), null) });
    const NONE = (() => null) as never;
    const fields = { link: NONE, image: NONE, entry: NONE, entries: NONE } as CustomFieldRenderers;
    const config = toPuckConfig(defineBlocks([mk('Own', true), mk('Plain')]), { locale: 'fr-FR', customFields: fields });
    html((config.components.Own.render as unknown as (p: object) => unknown)({ puck: { isEditing: true } }));
    html((config.components.Plain.render as unknown as (p: object) => unknown)({ puck: { isEditing: true } }));
    expect(seen[0]).toMatchObject({ _locale: 'fr-FR', _editor: true });
    expect(seen[1]).not.toHaveProperty('_locale');
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
    expect(readEntryImage([{ url: '/first.png', alt: 'F' }, '/second.png'])).toEqual({ src: '/first.png', alt: 'F' });
    expect(readEntryImage(['/only.png'])).toEqual({ src: '/only.png', alt: '' });
    expect(readEntryImage([])).toBeNull();
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

  it('a stored _editor never reaches the website: resolvePage stamps _editor: false on composed/usesLocale items', async () => {
    const reg = defineBlocks([...coreBlocks, defineComposedBlock(productGrid())]);
    const { f } = fake();
    const out = await resolvePage(
      page([item('ProductList', { entries: { mode: 'query' }, _editor: true }), item('Heading', { text: 'Hi', _editor: true })]),
      reg,
      f,
      O,
    );
    const [c, h] = out.content as { props: Record<string, unknown> }[];
    expect(c.props._editor).toBe(false);
    expect(h.props._editor).not.toBe(false);
    // The website render does not see the editor flag (no editor placeholders).
    const cfg = toPuckConfig(reg, { locale: 'vi-VN', customFields: {} as CustomFieldRenderers });
    const site = cfg.components.ProductList.render as unknown as (p: unknown) => unknown;
    expect(html(site(c.props))).toBe(html(site({ ...c.props, _editor: false })));
    expect(writePageContent(out, reg).data.content[0]).not.toHaveProperty('props._editor');
  });

  it('usesLocale (hand-written, e.g. ejected) blocks get _locale too; defineBlocks validates the flag', async () => {
    const own = defineBlock({ name: 'OwnBlock', label: 'Own', category: 'x', usesLocale: true, fields: { t: b.text() }, render: () => null });
    const plain = defineBlock({ name: 'PlainBlock', label: 'Plain', category: 'x', fields: { t: b.text() }, render: () => null });
    const reg = defineBlocks([own, plain]);
    const { f } = fake();
    const out = await resolvePage(page([item('OwnBlock', { t: 'a' }), item('PlainBlock', { t: 'b' })]), reg, f, O);
    const [o, p] = out.content as { props: Record<string, unknown> }[];
    expect(o.props._locale).toBe('vi-VN');
    expect(p.props._locale).toBeUndefined();
    expect((writePageContent(out, reg).data.content[0] as { props: Record<string, unknown> }).props).not.toHaveProperty('_locale');
    expect(() => defineBlocks([{ ...own, usesLocale: 1 as never }])).toThrow(/usesLocale must be true when set/);
  });
});

describe('asset fields of entries', () => {
  const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const U3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  const item = (type: string, props: Record<string, unknown>, id = type) => ({ type, props: { id, _v: 1, ...props } });
  const page = (content: unknown[]) => ({ format: 'puck' as const, formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content } as never });
  const O = { locale: 'en-US', defaultLocale: 'en-US' } as never;
  const card = () =>
    defineComposedBlock(
      base({
        name: 'AssetCard',
        binding: { apiId: 'product', mode: 'single' },
        tree: { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'image' } } },
      }),
    );
  const grid = () =>
    defineComposedBlock(
      base({
        name: 'AssetGrid',
        binding: { apiId: 'product', mode: 'collection' },
        tree: { el: 'Image', bind: { src: { from: 'entry', path: 'image' } } },
      }),
    );
  const entries: Record<string, Entry> = {
    e1: { documentId: 'e1', image: U1 },
    e2: { documentId: 'e2', image: U2 },
    e3: { documentId: 'e3', image: U3 },
  };

  it('defineComposedBlock records the entry paths bound to Image src/alt', () => {
    expect(card().entryAssetPaths).toEqual(['image']);
    expect(defineComposedBlock(productCard('NoAssetPaths')).entryAssetPaths).toEqual(['image', 'name']);
    expect(defineComposedBlock(productGrid({}, 'NoImages')).entryAssetPaths).toBeUndefined();
  });

  it('two blocks, three entries: one assets() call; uuids become { url, alt } and render', async () => {
    const reg = defineBlocks([card(), grid()]);
    const assetCalls: string[][] = [];
    const f: ContentFetcher = {
      byIds: async (_a, ids) => ids.map((i) => entries[i]),
      query: async () => [entries.e2, entries.e3],
      pagePaths: async () => ({}),
      assets: async (ids) => {
        assetCalls.push([...ids].sort());
        return ids.filter((i) => i !== U3).map((id) => ({ id, url: `https://cdn.example/${id.slice(-1)}.png`, alt: `alt ${id.slice(-1)}` }));
      },
    };
    const out = await resolvePage(page([item('AssetCard', { entry: { documentId: 'e1' } }), item('AssetGrid', { entries: { mode: 'query' } })]), reg, f, O);
    expect(assetCalls).toEqual([[U1, U2, U3]]);
    const [c, g] = out.content as { type: string; props: Record<string, unknown> }[];
    const cardHtml = render(reg.get('AssetCard')!, c.props);
    expect(cardHtml).toContain('src="https://cdn.example/1.png"');
    expect(cardHtml).toContain('alt="alt 1"');
    const gridHtml = render(reg.get('AssetGrid')!, g.props);
    expect(gridHtml).toContain('src="https://cdn.example/2.png"');
    expect(gridHtml.match(/<img/g)).toHaveLength(1); // U3 missing → renders nothing
    expect(entries.e1.image).toBe(U1); // fetched entries are not mutated
  });

  it('a multiple asset field (array of ids) shows its first asset; only first ids are fetched', async () => {
    const reg = defineBlocks([card(), grid()]);
    const assetCalls: string[][] = [];
    const multi: Record<string, Entry> = { m1: { documentId: 'm1', image: [U2, U3] }, m2: { documentId: 'm2', image: [U3] }, m3: { documentId: 'm3', image: [] } };
    const f: ContentFetcher = {
      byIds: async (_a, ids) => ids.map((i) => multi[i]),
      query: async () => [multi.m2, multi.m3],
      pagePaths: async () => ({}),
      assets: async (ids) => {
        assetCalls.push([...ids].sort());
        return ids.map((id) => ({ id, url: `https://cdn.example/${id.slice(-1)}.png`, alt: `alt ${id.slice(-1)}` }));
      },
    };
    const out = await resolvePage(page([item('AssetCard', { entry: { documentId: 'm1' } }), item('AssetGrid', { entries: { mode: 'query' } })]), reg, f, O);
    expect(assetCalls).toEqual([[U2, U3]]);
    const [c, g] = out.content as { type: string; props: Record<string, unknown> }[];
    const cardHtml = render(reg.get('AssetCard')!, c.props);
    expect(cardHtml).toContain('src="https://cdn.example/2.png"');
    expect(cardHtml).toContain('alt="alt 2"');
    const gridHtml = render(reg.get('AssetGrid')!, g.props);
    expect(gridHtml).toContain('src="https://cdn.example/3.png"');
    expect(gridHtml.match(/<img/g)).toHaveLength(1); // empty list → renders nothing
    expect(multi.m1.image).toEqual([U2, U3]); // fetched entries are not mutated
  });

  it('no asset paths or no uuids → no assets() call; failure → one warn, images render nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = defineBlocks([card()]);
    const assets = vi.fn(async () => {
      throw new Error('boom');
    });
    const f: ContentFetcher = { byIds: async (_a, ids) => ids.map((i) => entries[i]), query: async () => [], pagePaths: async () => ({}), assets };
    const out = await resolvePage(page([item('AssetCard', { entry: { documentId: 'e1' } }, 'a'), item('AssetCard', { entry: { documentId: 'e2' } }, 'b')]), reg, f, O);
    expect(assets).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(render(reg.get('AssetCard')!, (out.content[0] as { props: Record<string, unknown> }).props)).toBe('');
    const plain = { ...f, byIds: async (_a: string, ids: string[]) => ids.map((i) => ({ documentId: i, image: 'https://x/a.png' })) };
    await resolvePage(page([item('AssetCard', { entry: { documentId: 'e1' } })]), reg, plain, O);
    expect(assets).toHaveBeenCalledTimes(1);
  });

  it('fetchers: assets() batches ≤100 ids per request on the public and admin endpoints', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const ids = new URL(url).searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify({ data: ids.map((id) => ({ id, url: `/u/${id}`, alt: null, width: 10, height: null, extra: 1 })) }), { status: 200 });
    }));
    try {
      const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      const got = await publicFetcher('http://h/').assets!(ids);
      expect(calls).toHaveLength(2);
      expect(new URL(calls[0]).pathname).toBe('/api/content/assets');
      expect(new URL(calls[0]).searchParams.get('ids')!.split(',')).toHaveLength(100);
      expect(got).toHaveLength(150);
      expect(got[0]).toEqual({ id: ids[0], url: `/u/${ids[0]}`, width: 10 });
      await adminFetcher('http://h').assets!([ids[0]]);
      expect(new URL(calls[2]).pathname).toBe('/api/admin/assets');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('validateComposedSpec / defineBlocks parity', () => {
  const valid = productCard('Parity');
  const at = (f: (s: any) => void) => {
    const s = structuredClone(valid) as any;
    f(s);
    return s as ComposedBlockSpec;
  };
  const fieldNamed = (n: string, f: Record<string, unknown> = { kind: 'text' }) =>
    at((s) => (s.fields = JSON.parse(`{${JSON.stringify(n)}:${JSON.stringify(f)}}`)));
  const hostile: [string, ComposedBlockSpec][] = [
    ...['entry', 'entries', 'layout', 'slot', 'slot2', 'id', '_v', 'puck', 'editMode', '_locale', '_editor', '__proto__', 'constructor', 'toString', '9lives', 'a-b'].map(
      (n): [string, ComposedBlockSpec] => [`field ${n}`, fieldNamed(n)],
    ),
    ['number default', fieldNamed('n', { kind: 'number', default: 'abc' })],
    ['boolean default', fieldNamed('n', { kind: 'boolean', default: 'yes' })],
    ['text default', fieldNamed('n', { kind: 'text', default: 3 })],
    ['richText default', fieldNamed('n', { kind: 'richText', default: false })],
    ['link default', fieldNamed('n', { kind: 'link', default: 'javascript:x' })],
    ['image default', fieldNamed('n', { kind: 'image', default: 'x.png' })],
    ['field label', fieldNamed('n', { kind: 'text', label: { 'en-US': 'A', xx: 'B' } })],
    ['field label type', fieldNamed('n', { kind: 'text', label: 7 })],
    ['block label locale', at((s) => (s.label = { 'en-US': 'A', 'xx-YY': 'B' }))],
    ['slot allow', base({ name: 'SlotAllow', tree: { el: 'Box', children: [{ el: 'Slot', props: { allow: [1] } }] } })],
    ['slot max', base({ name: 'SlotMax', tree: { el: 'Box', children: [{ el: 'Slot', props: { max: 0 } }] } })],
    ['sort field colon', productGrid({ sort: { field: 'a:b', direction: 'asc' } }, 'SortColon')],
    ['single with limit', at((s) => (s.binding.limit = 3))],
  ];
  const fine: [string, ComposedBlockSpec][] = [
    ['product card', valid],
    ['product grid', productGrid({ options: { editorLayout: true, editorSort: true, editorLimit: true, editorFilter: true } }, 'Grid2')],
    ['every kind with defaults', base({
      name: 'Kinds',
      fields: {
        t: { kind: 'text', default: 'a', label: 'T' },
        l: { kind: 'longText', default: '' },
        r: { kind: 'richText', default: '<p>x</p>' },
        n: { kind: 'number', default: 2 },
        bo: { kind: 'boolean', default: true },
        s: { kind: 'select', options: ['a', 1], default: 1 },
        i: { kind: 'image', default: null },
        k: { kind: 'link', default: { kind: 'url', href: '/a' } },
        slotTitle: { kind: 'text' },
      },
      tree: { el: 'Stack', children: [{ el: 'Slot', props: { allow: ['Heading'], max: 2 } }, { el: 'Slot' }] },
    })],
  ];

  it.each(hostile)('hostile spec fails validation: %s', (_n, spec) => {
    expect(validateComposedSpec(spec).length).toBeGreaterThan(0);
  });
  it.each([...hostile, ...fine])('passes validateComposedSpec ⇒ passes defineBlocks: %s', (_n, spec) => {
    if (validateComposedSpec(spec).length) return;
    expect(() => defineBlocks([defineComposedBlock(spec)])).not.toThrow();
  });
  it('the valid specs do pass both', () => {
    for (const [, spec] of fine) {
      expect(validateComposedSpec(spec)).toEqual([]);
      expect(() => defineBlocks([...coreBlocks, defineComposedBlock(spec)])).not.toThrow();
    }
  });
});

describe('defineComposedBlock: style', () => {
  it('renders node style and Columns tracks through the ui primitives', () => {
    const def = defineComposedBlock(
      base({
        name: 'Styled',
        tree: {
          el: 'Box',
          props: { padding: '8' },
          style: { padding: { base: { t: '37px' }, md: { t: '8' } }, background: 'brand:surface', hidden: { lg: true } },
          children: [
            {
              el: 'Columns',
              props: { count: 2, tracks: { base: ['1fr'], md: ['auto', '1fr', 'auto'] }, alignY: 'center' },
              children: [
                { el: 'Heading', props: { level: 2, text: 'Hi' }, style: { span: { base: 'full', md: 1 }, color: '#123456' } },
                { el: 'Image', props: { fit: 'contain', src: '/a.png' }, style: { height: '100%' } },
              ],
            },
            { el: 'Stack', props: { direction: { base: 'vertical', md: 'horizontal' }, justify: 'between' } },
          ],
        },
      }),
    );
    const out = render(def, {});
    expect(out).toContain('class="pt-(--ocms-pt) md:pt-(--ocms-pt-md) bg-(--ocms-bg) block md:block lg:hidden"');
    expect(out).toContain('--ocms-pt:37px;--ocms-pt-md:calc(var(--spacing) * 8);--ocms-bg:var(--ocms-color-surface)');
    expect(out).toContain('grid grid-cols-(--ocms-cols) md:grid-cols-(--ocms-cols-md) lg:grid-cols-(--ocms-cols-lg) gap-6 items-center');
    expect(out).toContain('--ocms-cols:minmax(0,1fr);--ocms-cols-md:auto minmax(0,1fr) auto;--ocms-cols-lg:auto minmax(0,1fr) auto');
    expect(out).toContain('text-(--ocms-fg) col-span-full md:col-span-(--ocms-span-md)');
    expect(out).toContain('--ocms-fg:#123456;--ocms-span-md:1');
    expect(out).toContain('object-contain');
    expect(out).toContain('h-(--ocms-h)');
    expect(out).toContain('flex flex-col md:flex-row md:flex-wrap gap-4 items-stretch justify-between');
  });
  it('a spec without style renders the same classes as before', () => {
    const def = defineComposedBlock(base({ name: 'Plain', tree: { el: 'Box', props: { padding: '8', background: 'muted' }, children: [{ el: 'Columns', props: { count: 3 } }] } }));
    expect(render(def, {})).toBe('<div class="py-8 bg-muted text-foreground"><div class="grid grid-cols-1 md:grid-cols-3 gap-6"></div></div>');
  });
});

// Task 8: the my-store storefront (docs/superpowers/specs/assets/2026-11-24-store-preview.html) rebuilt with
// Block Builder files and a theme. Every file must validate, render, and survive a builder/Theme save unchanged.
describe('examples/my-store storefront', () => {
  const root = path.resolve(__dirname, '../../../../examples/my-store');
  const STORE = ['StoreHeader', 'StoreHero', 'SectionHead', 'StoryBand', 'StoreFooter', 'StoreFrame', 'ContactModal', 'MobileMenu'];
  const ALL = [...STORE, 'FeaturedProducts'];
  const load = async () => {
    const config = await loadConfig(root);
    return { config, ...(await loadComposedBlocks(config)) };
  };
  /** Props of a block with every field at its default (what a freshly dropped block renders). */
  const defaults = (spec: ComposedBlockSpec) =>
    Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, (f as { default?: unknown }).default]));
  const renderStore = async (name: string) => {
    const { specs } = await load();
    const spec = specs.find((s) => s.spec.name === name)!.spec;
    return render(defineComposedBlock(spec), defaults(spec));
  };

  it('every composed spec validates, prints byte-identically (a builder save without changes) and renders', async () => {
    const { specs, errors } = await load();
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.spec.name)).toEqual(expect.arrayContaining(ALL));
    for (const { spec, file } of specs) {
      expect(validateComposedSpec(spec), spec.name).toEqual([]);
      expect(printComposedBlockFile(spec), spec.name).toBe(fs.readFileSync(file, 'utf8'));
    }
    expect(() => defineBlocks([...coreBlocks, ...specs.map((s) => defineComposedBlock(s.spec))])).not.toThrow();
    for (const name of STORE) expect((await renderStore(name)).length, name).toBeGreaterThan(0);
  });

  it('StoreFooter: 2 columns on mobile with the intro spanning both, 2fr 1fr 1fr from md', async () => {
    const out = await renderStore('StoreFooter');
    expect(out).toContain('--ocms-cols:minmax(0,1fr) minmax(0,1fr)');
    expect(out).toContain('--ocms-cols-md:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)');
    expect(out).toContain('col-span-full md:col-span-(--ocms-span-md)');
    expect(out).toContain('--ocms-bg:var(--ocms-color-accent)');
    expect(out).toContain('--ocms-fg:var(--ocms-color-accent-ink)');
    expect(out).toContain('href="mailto:hello@example.com"');
  });

  it('StoreHeader and StoreHero: base (mobile) and md layouts', async () => {
    const header = await renderStore('StoreHeader');
    // One row at every width; the nav links are hidden on mobile (the ☰ drawer holds them).
    expect(header).toContain('flex-row');
    expect(header).not.toContain('flex-col');
    expect(header).toContain('hidden md:flex');
    expect(header).toContain('justify-between');
    expect(header).toContain('--ocms-minh:76px');
    expect(header).toContain('--ocms-pl:5%');
    expect(header).toContain('--ocms-bc:var(--ocms-color-line)');
    expect(header).toContain('>my-store<');
    expect(header).toContain('href="/shop"');

    const hero = await renderStore('StoreHero');
    expect(hero).toContain('--ocms-cols:minmax(0,1fr);--ocms-cols-md:minmax(0,2fr) minmax(0,3fr)');
    expect(hero).toContain('<h1');
    expect(hero).toContain('Wear well every day');
    expect(hero).toContain('src="/files/store-editorial.webp"');
    expect(hero).toContain('object-cover');
    expect(hero).toContain('--ocms-minh:calc(var(--spacing) * 0);--ocms-minh-md:450px');
  });

  it('SectionHead + FeaturedProducts: 5% side padding like the other sections, 4:3 photos, no card border', async () => {
    const head = await renderStore('SectionHead');
    expect(head).toContain('--ocms-pl:5%');
    expect(head).toContain('--ocms-pr:5%');
    expect(head).not.toContain('max-width');
    const { specs } = await load();
    const spec = specs.find((s) => s.spec.name === 'FeaturedProducts')!.spec;
    const product = (n: number, name: string) => ({
      documentId: `p${n}`, name, price: { amount: 390000, currency: 'VND' }, images: { id: `a${n}`, url: `/media/p${n}.webp`, alt: '' },
    });
    const out = render(defineComposedBlock(spec), { entries: [product(1, 'Linen shirt'), product(2, 'Canvas tote')] });
    expect(out).toContain('lg:grid-cols-3');
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).toContain('src="/media/p1.webp"');
    expect(out).toContain('aspect-[4/3]');
    expect(out).toContain('object-cover');
    expect(out).toContain('--ocms-mb:6px');
    expect(out).toContain('<h3');
    expect(out).toContain('Linen shirt');
    expect(out).not.toContain('data-slot="card"');
  });

  // Base pages and overlays (spec 2026-11-25): the StoreFrame layout of the "Store" base page, the contact modal
  // and the mobile menu drawer, and the header/footer buttons that open them.
  const spec = async (name: string) => (await load()).specs.find((s) => s.spec.name === name)!.spec;
  /** Specs nodes in tree order. */
  const nodes = (n: ComposedBlockSpec['tree']): ComposedBlockSpec['tree'][] => [n, ...(n.children ?? []).flatMap(nodes)];
  const buttons = async (name: string) => nodes((await spec(name)).tree).filter((n) => n.el === 'Button');

  it('StoreFrame: a layout block with Region header, PageContent and Region footer, in that order', async () => {
    const s = await spec('StoreFrame');
    expect(composedKind(s)).toBe('layout');
    const def = defineComposedBlock(s);
    expect(def.kind).toBe('layout');
    expect(Object.keys(def.fields).filter((k) => k.startsWith('region__') || k === 'pageContent')).toEqual(['region__header', 'pageContent', 'region__footer']);
    const out = render(def, { region__header: '[HEADER]', pageContent: '[PAGE]', region__footer: '[FOOTER]' });
    expect(out.indexOf('[HEADER]')).toBeGreaterThan(-1);
    expect(out.indexOf('[HEADER]')).toBeLessThan(out.indexOf('[PAGE]'));
    expect(out.indexOf('[PAGE]')).toBeLessThan(out.indexOf('[FOOTER]'));
  });

  it('ContactModal: a md modal with a heading, text, email and phone links and a close button', async () => {
    const s = await spec('ContactModal');
    expect(composedKind(s)).toBe('overlay');
    expect(s.tree.props).toMatchObject({ variant: 'modal', size: 'md' });
    const def = defineComposedBlock(s);
    const out = render(def, { ...defaults(s), name: 'lien-he' });
    expect(out).toMatch(/^<dialog [^>]*data-ocms-overlay="lien-he"/);
    expect(out).toContain('aria-labelledby="lien-he-title"');
    expect(out).toMatch(/<h2 id="lien-he-title"/);
    expect(out).toContain('href="mailto:hello@example.com"');
    expect(out).toMatch(/href="tel:\+?[0-9]+"/);
    expect((await buttons('ContactModal')).some((b) => isEqual(b.props?.action, { type: 'overlay', op: 'close' }))).toBe(true);
  });

  it('MobileMenu: a small left drawer with the store nav links', async () => {
    const s = await spec('MobileMenu');
    expect(composedKind(s)).toBe('overlay');
    expect(s.tree.props).toMatchObject({ variant: 'drawer', side: 'left', size: 'sm' });
    const out = render(defineComposedBlock(s), { ...defaults(s), name: 'menu-mobile' });
    expect(out).toMatch(/^<dialog [^>]*data-ocms-overlay="menu-mobile"/);
    for (const href of ['/', '/shop', '/about']) expect(out).toContain(`href="${href}"`);
  });

  it('StoreHeader: a menu toggle hidden on desktop, a Contact button; StoreFooter: a Contact link', async () => {
    const header = await buttons('StoreHeader');
    const toggle = header.find((b) => isEqual(b.props?.action, { type: 'overlay', op: 'toggle', target: 'menu-mobile' }));
    expect(toggle?.style?.hidden).toEqual({ md: true, lg: true });
    expect(header.some((b) => isEqual(b.props?.action, { type: 'overlay', op: 'open', target: 'lien-he' }))).toBe(true);
    const out = await renderStore('StoreHeader');
    expect(out).toContain('md:hidden');
    expect(out).toContain('lg:hidden');
    expect(out).toContain('☰');
    const footer = await buttons('StoreFooter');
    expect(footer.some((b) => isEqual(b.props?.action, { type: 'overlay', op: 'open', target: 'lien-he' }))).toBe(true);
  });

  it('src/theme.ts: the three palettes of the mockup, valid, printed exactly as the Theme screen writes it', async () => {
    const { config } = await load();
    const theme = (await loadTheme(config))!;
    expect(validateTheme(theme)).toEqual([]);
    expect(Object.keys(theme.colors)).toEqual(['surface', 'feature', 'ink', 'accent', 'accent-ink', 'line']);
    expect(Object.keys(theme.palettes)).toEqual(['olive', 'clay', 'night']);
    expect(theme.activePalette).toBe('olive');
    expect(theme.palettes.olive.values).toEqual({ surface: '#fbf8ef', feature: '#ece9d7', ink: '#28291e', accent: '#3d462c', 'accent-ink': '#fffdf4', line: '#cfcab9' });
    expect(theme.palettes.clay.values.accent).toBe('#8b432f');
    expect(theme.palettes.night.values.accent).toBe('#20483c');
    expect(printThemeFile(theme)).toBe(fs.readFileSync(path.join(root, 'src/theme.ts'), 'utf8'));
  });
});

describe('layout and overlay blocks, button actions', () => {
  const overlaySpec = (props: Record<string, unknown> = {}) =>
    base({
      name: 'LienHe',
      fields: { title: { kind: 'text', default: 'Contact us' } },
      tree: {
        el: 'Overlay',
        props,
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'title' } } },
          { el: 'Text', props: { text: 'Body' } },
          { el: 'Button', props: { label: 'Done', action: { type: 'overlay', op: 'close' } } },
        ],
      },
    });
  const layoutSpec = () =>
    base({
      name: 'SiteFrame',
      tree: {
        el: 'Stack',
        children: [
          { el: 'Region', props: { name: 'header', label: { 'en-US': 'Header', 'vi-VN': 'Đầu trang' } } },
          { el: 'Box', children: [{ el: 'PageContent' }] },
          { el: 'Region', props: { name: 'footer-bar', allow: ['Footer'] } },
          { el: 'Slot' },
        ],
      },
    });

  it('overlay: renders a dialog named after the block (kebab case) with its children and a close button', () => {
    const def = defineComposedBlock(overlaySpec());
    expect(def.kind).toBe('overlay');
    expect(Object.keys(def.fields)).toEqual(['name', 'title']);
    expect(def.fields.name).toMatchObject({ kind: 'text', default: 'lien-he' });
    const out = render(def, { name: 'lien-he', title: 'Contact us' });
    expect(out).toMatch(/^<dialog [^>]*data-ocms-overlay="lien-he"/);
    expect(out).toContain('data-close-on-backdrop="true"');
    expect(out).toContain('aria-labelledby="lien-he-title"');
    expect(out).toMatch(/<h2 id="lien-he-title"[^>]*>Contact us<\/h2>/);
    expect(out).toContain('Body');
    // × close button plus the Done action button.
    expect(out.match(/<button type="button"/g)).toHaveLength(2);
    expect(out).toContain('aria-label="Close"');
    expect(out).toMatch(/<\/dialog>$/);
  });

  it('overlay: the page-builder name wins; invalid names fall back to the default', () => {
    const def = defineComposedBlock(overlaySpec());
    expect(render(def, { name: 'menu-mobile' })).toContain('data-ocms-overlay="menu-mobile"');
    expect(render(def, { name: 'Bad Name' })).toContain('data-ocms-overlay="lien-he"');
    expect(render(def, {})).toContain('data-ocms-overlay="lien-he"');
  });

  it('overlay: variant, side, size, closeOnBackdrop and showClose come from the literal tables', async () => {
    const { OVERLAY_SIDE, OVERLAY_SIZE, OVERLAY_VARIANT } = await import('../../blocks/src/ui/overlay');
    const drawer = render(defineComposedBlock(overlaySpec({ variant: 'drawer', side: 'left', size: 'lg', closeOnBackdrop: false, showClose: false })), { name: 'x' });
    const cls = /class="([^"]*)"/.exec(drawer)![1].split(' ');
    for (const c of OVERLAY_SIDE.left.split(' ')) expect(cls).toContain(c);
    for (const c of OVERLAY_SIZE.x.lg.split(' ')) expect(cls).toContain(c);
    for (const c of OVERLAY_VARIANT.drawer.split(' ')) expect(cls).toContain(c);
    expect(drawer).toContain('data-close-on-backdrop="false"');
    expect(drawer).not.toContain('aria-label="Close"');
    const modal = render(defineComposedBlock(overlaySpec()), {});
    const mcls = /class="([^"]*)"/.exec(modal)![1].split(' ');
    for (const c of OVERLAY_SIZE.modal.md.split(' ')) expect(mcls).toContain(c);
    const top = render(defineComposedBlock(overlaySpec({ variant: 'drawer', side: 'top', size: 'sm' })), {});
    for (const c of OVERLAY_SIZE.y.sm.split(' ')) expect(/class="([^"]*)"/.exec(top)![1].split(' ')).toContain(c);
  });

  it('overlay: labelled by the first heading that is shown', () => {
    const def = defineComposedBlock(
      base({
        name: 'LienHe',
        fields: { intro: { kind: 'boolean', default: true } },
        tree: {
          el: 'Overlay',
          children: [
            { el: 'Box', showIf: { from: 'field', name: 'intro', is: 'present' }, children: [{ el: 'Heading', props: { text: 'Intro' } }] },
            { el: 'Heading', props: { text: 'Main', anchorId: 'main-title' } },
          ],
        },
      }),
    );
    const shown = render(def, { intro: true });
    expect(shown).toContain('aria-labelledby="lien-he-title"');
    expect(shown).toMatch(/<h2 id="lien-he-title"[^>]*>Intro/);
    const hidden = render(def, { intro: false });
    expect(hidden).toContain('aria-labelledby="main-title"');
    expect(hidden).not.toContain('lien-he-title');
  });

  it('overlay: full size lifts the dialog max height', async () => {
    const { OVERLAY_SIZE } = await import('../../blocks/src/ui/overlay');
    expect(OVERLAY_SIZE.modal.full.split(' ')).toContain('max-h-none');
    expect(OVERLAY_SIZE.x.full.split(' ')).toContain('max-h-none');
  });

  it('overlay: the close label follows the locale', () => {
    expect(render(defineComposedBlock(overlaySpec()), { _locale: 'vi-VN' })).toContain('aria-label="Đóng"');
  });

  it('layout: one slot field per Region and pageContent, rendered in tree order', () => {
    const def = defineComposedBlock(layoutSpec());
    expect(def.kind).toBe('layout');
    expect(Object.keys(def.fields)).toEqual(['slot', 'region__header', 'pageContent', 'region__footer-bar']);
    expect(def.fields['region__footer-bar']).toMatchObject({ kind: 'slot', allow: ['Footer'] });
    expect(def.fields.region__header).toMatchObject({ kind: 'slot', label: { 'en-US': 'Header', 'vi-VN': 'Đầu trang' } });
    const out = render(def, { region__header: '[HEADER]', pageContent: '[PAGE]', 'region__footer-bar': '[FOOTER]', slot: '[SLOT]' });
    expect(out.indexOf('[HEADER]')).toBeGreaterThan(-1);
    expect(out.indexOf('[HEADER]')).toBeLessThan(out.indexOf('[PAGE]'));
    expect(out.indexOf('[PAGE]')).toBeLessThan(out.indexOf('[FOOTER]'));
    expect(out.indexOf('[FOOTER]')).toBeLessThan(out.indexOf('[SLOT]'));
    expect(() => defineBlocks([def])).not.toThrow();
  });

  it('manifest lists the kind of layout and overlay blocks', async () => {
    const { blockManifest } = await import('../../blocks/src');
    const r = defineBlocks([defineComposedBlock(layoutSpec()), defineComposedBlock(overlaySpec()), defineComposedBlock(productCard())]);
    expect(blockManifest(r).map((m) => [m.name, m.kind])).toEqual([['SiteFrame', 'layout'], ['LienHe', 'overlay'], ['ProductCard', undefined]]);
    expect(defineComposedBlock(productCard()).kind).toBe('block');
  });

  it('Button with an action renders a <button type="button"> with the link classes and no href', () => {
    const btn = (props: Record<string, unknown>, style?: Record<string, unknown>) =>
      render(defineComposedBlock(base({ tree: { el: 'Button', props: { label: 'Open', href: '/x', variant: 'outline', size: 'lg', ...props }, ...(style ? { style } : {}) } })), {});
    const link = btn({}, { background: 'brand:accent' });
    const action = btn({ action: { type: 'overlay', op: 'open', target: 'lien-he' } }, { background: 'brand:accent' });
    expect(action).toMatch(/^<button type="button"/);
    expect(action).not.toContain('href');
    const attrs = (s: string) => [/class="([^"]*)"/.exec(s)![1], /style="([^"]*)"/.exec(s)![1]];
    expect(attrs(action)).toEqual(attrs(link));
    expect(action).toContain('>Open</button>');
    expect(link).toMatch(/^<a data-slot="button" href="\/x"/);
    // An invalid action never reaches the renderer: the spec is rejected.
    expect(() => btn({ action: { type: 'overlay', op: 'open' } })).toThrow(/action\.target/);
  });

  it('anchorId becomes the element id', () => {
    const out = render(defineComposedBlock(base({ tree: { el: 'Box', props: { anchorId: 'gioi-thieu' }, children: [{ el: 'Heading', props: { text: 'Hi', anchorId: 'h1' } }] } })), {});
    expect(out).toMatch(/^<div id="gioi-thieu"/);
    expect(out).toContain('<h2 id="h1"');
  });
});
