import * as fs from 'node:fs';
import * as path from 'node:path';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defineComposedBlock, ui, type ComposedBlockSpec } from '../../blocks/src';
import { loadComposedBlocks, loadConfig } from '@opencloudcms/codegen';

const html = (node: unknown) => renderToString(node as never);

// ---- Byte-identical rendering of everything that existed before the builder components (Task 2).
// The fixture was captured from the renderer at 0f99466, before any render change. `UPDATE_RENDER_BASELINE=1` rewrites
// it; never do that to make a failing check pass.

const FIXTURE = path.join(__dirname, 'fixtures', 'render-baseline.json');
const STORE_ROOT = path.resolve(__dirname, '../../../../examples/my-store');

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

const product = (n: number, name: string) => ({
  documentId: `p${n}`,
  name,
  slug: `p-${n}`,
  price: { amount: 390000 + n, currency: 'VND' },
  image: `https://cdn.example/p${n}.png`,
  images: { id: `a${n}`, url: `/media/p${n}.webp`, alt: '' },
  active: true,
});
const entries = [product(1, 'Linen shirt'), product(2, 'Canvas tote')];

/** Composed specs of the existing core tests (composed.test.ts) and the styles the renderer supported before. */
const fixtureSpecs = (): ComposedBlockSpec[] => [
  base({
    name: 'ProductCard',
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
  }),
  base({
    name: 'ProductList',
    binding: {
      apiId: 'product',
      mode: 'collection',
      filter: [{ field: 'active', value: true }],
      sort: { field: 'createdAt', direction: 'desc' },
      limit: 8,
      layout: { kind: 'grid', columns: 4 },
      options: { emptyText: { 'en-US': 'No products yet', 'vi-VN': 'Chưa có sản phẩm' } },
    },
    tree: { el: 'Card', children: [{ el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } }] },
  }),
  base({
    name: 'LienHe',
    fields: { title: { kind: 'text', default: 'Contact us' } },
    tree: {
      el: 'Overlay',
      props: { variant: 'drawer', side: 'left', size: 'lg' },
      children: [
        { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'title' } } },
        { el: 'Text', props: { text: 'Body' } },
        { el: 'Button', props: { label: 'Done', action: { type: 'overlay', op: 'close' } } },
      ],
    },
  }),
  base({
    name: 'SiteFrame',
    tree: {
      el: 'Stack',
      children: [
        { el: 'Region', props: { name: 'header' } },
        { el: 'Box', children: [{ el: 'PageContent' }] },
        { el: 'Slot' },
      ],
    },
  }),
  base({
    name: 'Styled',
    tree: {
      el: 'Box',
      props: { anchorId: 'top', padding: '12', background: 'muted' },
      style: { padding: { base: { t: '4' }, md: { t: '8' } }, background: 'brand:accent', color: '#112233', borderWidth: '1', borderColor: 'muted', radius: 'lg', hidden: { lg: true } },
      children: [
        {
          el: 'Card',
          props: { bordered: false, background: 'secondary' },
          style: { width: '50%', maxWidth: '640px' },
          children: [
            { el: 'Image', props: { src: '/a.png', alt: 'A', rounded: true, fit: 'contain', aspect: { base: 'square', md: 'video' } }, style: { height: '100%' } },
            { el: 'Button', props: { label: 'Go', href: '/go', variant: 'outline', size: 'lg' }, style: { background: 'brand:accent', color: 'brand:ink' } },
            { el: 'Button', props: { label: 'Open', href: '/x', action: { type: 'overlay', op: 'open', target: 'menu' } } },
            { el: 'Button', props: { label: 'Bad', href: 'javascript:alert(1)', variant: 'ghost' } },
            { el: 'Badge', props: { text: 'New', variant: 'secondary' } },
            { el: 'Divider' },
            { el: 'Spacer', props: { size: '4' } },
            { el: 'Date', props: { value: '2026-11-26', format: 'long' } },
          ],
        },
        { el: 'Columns', props: { count: 3, tracks: { base: ['1fr'], md: ['2fr', '1fr'] }, gapX: '4', alignY: 'center' }, children: [{ el: 'Text', props: { text: 'a', size: 'lg', color: 'primary' } }] },
        { el: 'Grid', props: { columns: 6, gap: '2' }, children: [{ el: 'Heading', props: { text: 'G', level: 4, align: 'center' } }] },
        { el: 'Stack', props: { direction: { base: 'vertical', md: 'horizontal' }, align: 'center', justify: 'between', wrap: false }, children: [] },
      ],
    },
  }),
];

/** Every case: a name and its HTML at the current renderer. */
async function renderCases(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const props = (spec: ComposedBlockSpec): Record<string, unknown> => ({
    ...Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, (f as { default?: unknown }).default])),
    _locale: 'en-US',
    entry: entries[0],
    entries,
    name: 'baseline',
    region__header: '[HEADER]',
    pageContent: '[PAGE]',
    slot: '[SLOT]',
  });
  const config = await loadConfig(STORE_ROOT);
  const { specs } = await loadComposedBlocks(config);
  for (const { spec } of specs) out[`my-store/${spec.name}`] = html(defineComposedBlock(spec).render(props(spec) as never));
  for (const spec of fixtureSpecs()) out[`fixture/${spec.name}`] = html(defineComposedBlock(spec).render(props(spec) as never));
  out['ui/Button-link'] = html(h(ui.Button, { label: 'Go', href: '/x' }));
  out['ui/Button-span'] = html(h(ui.Button, { label: 'Go', href: null, variant: 'link', size: 'sm' }));
  out['ui/Image'] = html(h(ui.Image, { src: '/a.png', alt: 'A', ratio: 'video' }));
  out['ui/Box'] = html(h(ui.Box, { padding: '4', background: 'primary', id: 'b' }, 'x'));
  out['ui/Card'] = html(h(ui.Card, { padding: '2', bordered: true }, 'x'));
  return out;
}

describe('render baseline: existing blocks render byte-identically', () => {
  it('matches the fixture captured before the builder components', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = await renderCases();
    if (process.env.UPDATE_RENDER_BASELINE === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`);
    }
    const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    for (const k of Object.keys(before)) expect(now[k], k).toBe(before[k]);
    expect(Object.keys(before).filter((k) => k.startsWith('my-store/')).length).toBeGreaterThanOrEqual(9);
  });
});
