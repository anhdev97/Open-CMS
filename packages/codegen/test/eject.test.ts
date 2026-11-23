import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig, type ComposedBlockSpec } from '@opencloudcms/schema';
// The real blocks package (source) and React, both from @opencloudcms/core.
import * as blocks from '../../core/blocks/src/index';
import { composedBlockFile, ejectComposedBlock, EjectTargetExistsError, loadComposedBlocks, printComposedBlockFile, printEjectedBlockTsx, writeComposedBlocks } from '../src';

const coreRequire = createRequire(path.resolve(__dirname, '../../core/package.json'));
const { renderToString } = coreRequire('react-dom/server') as typeof import('react-dom/server');
const jsxRuntime = coreRequire('react/jsx-runtime');

afterEach(() => vi.restoreAllMocks());

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-eject-'));

/** Transpile the ejected TSX (as a project would) and load it with jiti against the real blocks package. */
function loadEjected(source: string): blocks.BlockDefinition {
  const out = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  });
  expect(out.diagnostics ?? []).toEqual([]);
  const dir = tmp();
  const file = path.join(dir, 'ejected.block.js');
  fs.writeFileSync(file, out.outputText);
  const jiti = createJiti(file, {
    moduleCache: false,
    fsCache: false,
    interopDefault: false,
    // ESM output: jiti transforms it and resolves imports itself (virtualModules), never natively.
    tryNative: false,
    virtualModules: { '@opencloudcms/core/blocks': blocks, 'react/jsx-runtime': jsxRuntime },
  });
  return (jiti(file) as { default: blocks.BlockDefinition }).default;
}

const html = (def: blocks.BlockDefinition, props: Record<string, unknown>) => renderToString(def.render(props as never) as never);

const L = (en: string, vi?: string) => ({ 'en-US': en, ...(vi ? { 'vi-VN': vi } : {}) });

const singleSpec: ComposedBlockSpec = {
  id: 'blk_single01',
  name: 'ProductCard',
  label: L('Product card', 'Thẻ sản phẩm'),
  category: 'Shop',
  icon: 'box',
  version: 3,
  binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' },
  fields: {
    ctaLabel: { kind: 'text', label: L('Button label'), default: 'Buy now' },
    showBadge: { kind: 'boolean', default: true },
  },
  tree: {
    el: 'Card',
    props: { padding: '4', background: 'muted', bordered: false },
    children: [
      { el: 'Image', props: { ratio: 'square', rounded: true }, bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'name' } } },
      { el: 'Heading', props: { level: 3, align: 'center' }, bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Badge', props: { variant: 'secondary' }, bind: { text: { from: 'const', value: 'New "drop" & <hot>' } }, showIf: { from: 'field', name: 'showBadge', is: 'present' } },
      {
        el: 'Stack',
        props: { direction: 'horizontal', gap: '2', align: 'center' },
        showIf: { from: 'entry', path: 'price', is: 'present' },
        children: [
          { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
          { el: 'Price', props: { showCurrency: false }, bind: { value: { from: 'entry', path: 'price' } } },
        ],
      },
      { el: 'Date', props: { format: 'long', timeZone: 'Asia/Ho_Chi_Minh' }, bind: { value: { from: 'entry', path: 'publishedAt' } } },
      { el: 'Text', props: { size: 'sm', color: 'muted' }, bind: { html: { from: 'entry', path: 'body' } } },
      { el: 'Text', showIf: { from: 'entry', path: 'subtitle', is: 'absent' }, props: { text: 'No subtitle' } },
      { el: 'Button', props: { variant: 'default', size: 'lg' }, bind: { label: { from: 'field', name: 'ctaLabel' }, href: { from: 'entryUrl' } } },
    ],
  },
};

const collectionSpec: ComposedBlockSpec = {
  id: 'blk_coll0001',
  name: 'ProductList',
  label: L('Product list'),
  category: 'Shop',
  version: 2,
  binding: {
    apiId: 'product',
    mode: 'collection',
    filter: [{ field: 'active', value: true }, { field: 'stock', value: 3 }],
    sort: { field: 'createdAt', direction: 'desc' },
    limit: 8,
    layout: { kind: 'grid', columns: 4 },
    options: { editorSort: true, editorLayout: true, emptyText: L('No products yet', 'Chưa có sản phẩm') },
  },
  fields: { badge: { kind: 'select', label: L('Badge'), default: 'new', options: ['new', 'sale'] } },
  tree: {
    el: 'Card',
    children: [
      { el: 'Image', bind: { src: { from: 'entry', path: 'image' } } },
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Badge', bind: { text: { from: 'field', name: 'badge' } } },
      { el: 'Text', bind: { text: { from: 'entry', path: 'gone' } } },
    ],
  },
};

const unboundSpec: ComposedBlockSpec = {
  id: 'blk_unbound1',
  name: 'PromoBanner',
  label: L('Promo banner'),
  category: 'Marketing',
  version: 1,
  fields: {
    title: { kind: 'text', default: 'Big sale' },
    body: { kind: 'richText' },
    cta: { kind: 'link' },
    photo: { kind: 'image' },
    count: { kind: 'number', default: 3 },
    note: { kind: 'longText' },
  },
  tree: {
    el: 'Box',
    props: { padding: '12', background: 'primary' },
    children: [
      {
        el: 'Columns',
        props: { count: 2, gap: '8' },
        children: [
          {
            el: 'Stack',
            children: [
              { el: 'Heading', props: { level: 1 }, bind: { text: { from: 'field', name: 'title' } } },
              { el: 'Text', bind: { html: { from: 'field', name: 'body' } } },
              { el: 'Text', bind: { text: { from: 'field', name: 'count' } }, showIf: { from: 'field', name: 'note', is: 'absent' } },
              { el: 'Button', props: { label: 'Shop now' }, bind: { href: { from: 'field', name: 'cta' } } },
              { el: 'Button', props: { label: 'Evil', href: 'javascript:alert(1)' } },
            ],
          },
          { el: 'Image', props: { alt: 'Fixed alt' }, bind: { src: { from: 'field', name: 'photo' } } },
        ],
      },
      { el: 'Divider' },
      { el: 'Spacer', props: { size: '4' } },
      { el: 'Grid', props: { columns: 3 }, children: [{ el: 'Slot', props: { allow: ['Hero'], max: 2 } }, { el: 'Slot' }] },
    ],
  },
};

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  documentId: id,
  name: `Name ${id}`,
  slug: `slug ${id}`,
  price: { amount: 1234.5, currency: 'EUR' },
  image: { id: 'u1', url: 'https://cdn.example/p.png', alt: 'Asset alt' },
  publishedAt: '2026-11-22T19:00:00.000Z',
  body: '<p>Hello <b>rich</b><script>x()</script></p>',
  subtitle: null,
  ...extra,
});

function same(spec: ComposedBlockSpec, propsList: Record<string, unknown>[]) {
  const source = printEjectedBlockTsx(spec);
  const composed = blocks.defineComposedBlock(spec);
  const ejected = loadEjected(source);
  for (const props of propsList) {
    const a = html(composed, props);
    expect(a.length).toBeGreaterThan(0);
    expect(html(ejected, props)).toBe(a);
  }
  return { source, composed, ejected };
}

describe('printEjectedBlockTsx', () => {
  it('keeps name, label, category, icon, version, fields and asset paths; sets usesLocale', () => {
    for (const spec of [singleSpec, collectionSpec, unboundSpec]) {
      const composed = blocks.defineComposedBlock(spec);
      const ejected = loadEjected(printEjectedBlockTsx(spec));
      expect(ejected.composed).toBeUndefined();
      expect(ejected.usesLocale).toBe(true);
      for (const k of ['name', 'label', 'category', 'icon', 'version', 'entryAssetPaths'] as const) expect(ejected[k]).toEqual(composed[k]);
      expect(Object.keys(ejected.fields)).toEqual(Object.keys(composed.fields));
      expect(ejected.fields).toEqual(composed.fields);
      // A valid hand-written block for defineBlocks (no composed spec attached).
      expect(() => blocks.defineBlocks([ejected])).not.toThrow();
    }
    const coll = loadEjected(printEjectedBlockTsx(collectionSpec)).fields.entries as blocks.EntriesBlockField;
    expect(coll).toMatchObject({ baseFilter: { active: 'true', stock: '3' }, defaultSort: 'createdAt:desc', lockLimit: true, limit: 8, sortable: true });
  });

  it('single: renders identically (entry, missing entry, editor placeholder, locales)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source } = same(singleSpec, [
      { ctaLabel: 'Buy', showBadge: true, entry: entry('a'), _locale: 'en-US' },
      { ctaLabel: 'Mua', showBadge: false, entry: entry('b', { subtitle: 'Sub', price: null, image: 'https://cdn.example/x.png' }), _locale: 'vi-VN' },
      { ctaLabel: 'Acheter', showBadge: true, entry: entry('c', { price: { amount: 5, currency: 'USD' } }), _locale: 'fr-FR' },
      { ctaLabel: 'Buy', showBadge: true, entry: { documentId: 'd', name: 'Only name' } },
      { ctaLabel: 'Buy', showBadge: true, entry: null, _editor: true, _locale: 'vi-VN' },
      { ctaLabel: 'Buy', showBadge: true, entry: entry('e'), _locale: 'id-ID', _editor: true },
    ]);
    expect(html(loadEjected(source), { ctaLabel: 'Buy', entry: null })).toBe('');
    expect(source).toContain("<ui.Heading level={3} text={h.text(get(entry, 'name'))} align=\"center\" />");
    expect(source).toContain("h.single(props, { name, label }, (entry) =>");
  });

  it('collection: renders identically (grid, editor layout, empty text, placeholder, missing field)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source } = same(collectionSpec, [
      { badge: 'new', entries: [entry('a'), entry('b'), entry('c')], _locale: 'en-US' },
      { badge: 'sale', entries: [entry('a'), entry('b')], layout: 'list', _locale: 'fr-FR' },
      { badge: 'sale', entries: [entry('a')], layout: 'grid-2' },
      { badge: 'new', entries: [], _locale: 'vi-VN' },
      { badge: 'new', entries: [], _locale: 'id-ID', _editor: true },
    ]);
    // Missing entry field warns once per definition, with the same message.
    const msgs = warn.mock.calls.map((c) => c[0]);
    expect(new Set(msgs).size).toBe(1);
    expect(msgs.filter((m) => m === msgs[0]).length).toBe(2);
    expect(source).toContain("layout: 'grid-4'");
    expect(source).toContain('editorLayout: true');
  });

  it('unbound: renders identically (fields, slots, link safety, fixed alt)', () => {
    const { source } = same(unboundSpec, [
      {
        title: 'Hello',
        body: '<p>Rich <em>text</em></p>',
        cta: { href: '/sale' },
        photo: { src: 'https://cdn.example/a.png', alt: 'Photo alt' },
        count: 0,
        note: '',
        slot: '[slot one]',
        slot2: '[slot two]',
        _locale: 'fr-FR',
      },
      { title: '', body: '', cta: { href: 'javascript:alert(1)' }, photo: null, count: 7, note: 'x', slot: null, slot2: null },
    ]);
    expect(source).not.toContain('const get');
    expect(source).toContain('props.slot2 ?? null');
  });

  it('is stable and readable (one JSX element per node, literal props)', () => {
    const a = printEjectedBlockTsx(singleSpec);
    expect(printEjectedBlockTsx(singleSpec)).toBe(a);
    expect(a).toContain("import { b, composedHelpers as h, defineBlock, ui } from '@opencloudcms/core/blocks';");
    expect(a).toContain("const name = 'ProductCard';");
    expect(a).toContain('usesLocale: true,');
    expect(a).toContain('<ui.Card padding="4" background="muted" bordered={false}>');
    expect(a).toContain('text={\'New "drop" & <hot>\'}');
    expect(a).not.toContain('defineComposedBlock');
  });
});

describe('ejectComposedBlock', () => {
  const cfg = (root: string) => resolveConfig({ database: { url: 'x' } } as any, root);

  it('writes .block.tsx, removes .block.ts, regenerates composed.ts and returns the import line', async () => {
    const root = tmp();
    const config = cfg(root);
    await writeComposedBlocks(config, { upsert: singleSpec });
    await writeComposedBlocks(config, { upsert: unboundSpec });
    const file = composedBlockFile(config, 'ProductCard');
    const r = await ejectComposedBlock(config, singleSpec, file);
    const tsx = path.join(root, 'src/blocks/product-card/product-card.block.tsx');
    expect(r.file).toBe(tsx);
    expect(r.importLine).toBe("import ProductCard from './product-card/product-card.block';");
    expect(r.touched).toEqual([tsx, file, path.join(root, 'src/blocks/composed.ts')]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(tsx, 'utf8')).toBe(printEjectedBlockTsx(singleSpec));
    const index = fs.readFileSync(path.join(root, 'src/blocks/composed.ts'), 'utf8');
    expect(index).not.toContain('ProductCard');
    expect(index).toContain('PromoBanner');
    expect((await loadComposedBlocks(config)).specs.map((s) => s.spec.name)).toEqual(['PromoBanner']);
  });

  it('refuses to overwrite an existing .block.tsx', async () => {
    const root = tmp();
    const config = cfg(root);
    await writeComposedBlocks(config, { upsert: singleSpec });
    const file = composedBlockFile(config, 'ProductCard');
    fs.writeFileSync(file.replace(/\.ts$/, '.tsx'), '// mine');
    await expect(ejectComposedBlock(config, singleSpec, file)).rejects.toBeInstanceOf(EjectTargetExistsError);
    expect(fs.readFileSync(file, 'utf8')).toBe(printComposedBlockFile(singleSpec));
    expect(fs.readFileSync(file.replace(/\.ts$/, '.tsx'), 'utf8')).toBe('// mine');
  });
});
