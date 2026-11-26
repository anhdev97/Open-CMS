import * as fs from 'node:fs';
import * as path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defineComposedBlock, ui, type ComposedBlockSpec } from '../../blocks/src';
import { loadComposedBlocks, loadConfig } from '@opencloudcms/codegen';
import { ICON_NAMES } from '@opencloudcms/schema';
import preStoreHeader from './fixtures/pre-sprint/store-header.block';
import preMobileMenu from './fixtures/pre-sprint/mobile-menu.block';
import preContactModal from './fixtures/pre-sprint/contact-modal.block';

const html = (node: unknown) => renderToString(node as never);

// ---- Byte-identical rendering of everything that existed before the builder components (Task 2).
// The fixture was captured from the renderer at 0f99466, before any render change. `UPDATE_RENDER_BASELINE=1` rewrites
// it; never do that to make a failing check pass.

const FIXTURE = path.join(__dirname, 'fixtures', 'render-baseline.json');
const STORE_ROOT = path.resolve(__dirname, '../../../../examples/my-store');
const BASELINE_STORE = [
  'ActiveProducts', 'ContactModal', 'FeaturedProducts', 'MobileMenu', 'ProductCard', 'SectionHead',
  'StoreFooter', 'StoreFrame', 'StoreHeader', 'StoreHero', 'StoryBand',
];

const PRE_SPRINT = [preStoreHeader, preMobileMenu, preContactModal];

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
  // The my-store blocks that existed before the builder components. Blocks added later (HomeBanner, Faq, ProductTabs,
  // ProductStrip) are built from the new elements and tested in composed.test.ts. StoreHeader, MobileMenu and
  // ContactModal were rebuilt with the new elements on purpose (Task 7), so their entries were re-captured then.
  for (const { spec } of specs) if (BASELINE_STORE.includes(spec.name)) out[`my-store/${spec.name}`] = html(defineComposedBlock(spec).render(props(spec) as never));
  // The same three blocks as they were before Task 7 rebuilt them (37be4d7): pre-sprint specs must still render as then.
  for (const def of PRE_SPRINT) out[`my-store@37be4d7/${def.spec.name}`] = html(def.render(props(def.spec) as never));
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
    expect(Object.keys(before).filter((k) => k.startsWith('my-store@37be4d7/'))).toHaveLength(3);
  });
});

// ---- Builder components rendered without client JS (Task 2).

const markup = (node: unknown) => renderToStaticMarkup(node as never);
const c = (value: unknown) => ({ from: 'const' as const, value });
const block = (tree: ComposedBlockSpec['tree'], over: Partial<ComposedBlockSpec> = {}) =>
  markup(defineComposedBlock(base({ tree, ...over })).render({ _locale: 'en-US' } as never));
const attr = (out: string, tag: string, name: string): string | undefined => {
  const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(out);
  return m?.[1];
};

describe('Icon', () => {
  it('renders an aria-hidden svg without a label', () => {
    const out = markup(h(ui.Icon, { name: 'menu' }));
    expect(out).toMatch(/^<svg\b/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('role=');
    expect(out).not.toContain('aria-label');
  });
  it('renders role="img" with the label as aria-label', () => {
    const out = markup(h(ui.Icon, { name: 'menu', label: 'Menu' }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Menu"');
    expect(out).not.toContain('aria-hidden');
  });
  it('sizes come from the literal table; an unknown name renders nothing', () => {
    expect(markup(h(ui.Icon, { name: 'menu', size: 'xl' }))).toContain('size-8');
    expect(markup(h(ui.Icon, { name: 'menu' }))).toContain('size-5');
    expect(markup(h(ui.Icon, { name: 'nope' }))).toBe('');
  });
  it('every ICON_NAMES entry renders an svg, brand icons included', () => {
    for (const name of ICON_NAMES) {
      expect(ui.ICON_COMPONENTS[name], name).toBeDefined();
      const out = markup(h(ui.Icon, { name }));
      expect(out, name).toMatch(/^<svg\b[^>]*viewBox="0 0 24 24"[^>]*>.*<\/svg>$/);
      expect(out, name).toContain('stroke="currentColor"');
    }
    expect(Object.keys(ui.ICON_COMPONENTS).sort()).toEqual([...ICON_NAMES].sort());
  });
  it('the Icon element renders through the composed renderer', () => {
    const out = block({ el: 'Box', children: [{ el: 'Icon', props: { name: 'phone', size: 'lg' }, bind: { label: c('Call us') } }] });
    expect(out).toContain('aria-label="Call us"');
    expect(out).toContain('size-6');
  });
});

describe('Tooltip', () => {
  it('renders nothing (no empty focusable wrapper) when its child is hidden by showIf', () => {
    const spec = (show: boolean) =>
      markup(
        defineComposedBlock(
          base({
            fields: { badge: { kind: 'text', default: show ? 'x' : '' } },
            tree: {
              el: 'Box',
              children: [
                { el: 'Tooltip', bind: { text: c('Tip') }, children: [{ el: 'Badge', props: { text: 'Free' }, showIf: { from: 'field', name: 'badge', is: 'present' } }] },
              ],
            },
          }),
        ).render({ _locale: 'en-US', badge: show ? 'x' : '' } as never),
      );
    expect(spec(true)).toContain('role="tooltip"');
    expect(spec(true)).toContain('tabindex="0"');
    expect(spec(false)).not.toContain('tooltip');
    expect(spec(false)).not.toContain('tabindex');
  });
  it('renders role="tooltip" and the target button gets aria-describedby = bubble id', () => {
    const out = block({
      el: 'Tooltip', props: { side: 'bottom' }, bind: { text: c('Free shipping') },
      children: [{ el: 'Button', props: { label: 'Ship', href: '/ship' } }],
    });
    const id = attr(out, 'span', 'id') ?? attr(out, 'div', 'id');
    const bubble = /<(?:span|div)\b[^>]*role="tooltip"[^>]*>/.exec(out)![0];
    const bubbleId = /id="([^"]+)"/.exec(bubble)![1];
    expect(id).toBeDefined();
    expect(attr(out, 'a', 'aria-describedby')).toBe(bubbleId);
    expect(out).toContain('>Free shipping<');
    expect(out).toMatch(/^<(span|div) class="[^"]*\brelative inline-flex group\/tooltip\b/);
    expect(out).not.toContain('tabindex');
  });
  it('a target without a focusable element makes the wrapper focusable and described', () => {
    const out = block({ el: 'Tooltip', bind: { text: c('Hi') }, children: [{ el: 'Icon', props: { name: 'info' } }] });
    expect(out).toMatch(/^<(span|div) [^>]*tabindex="0"/);
    const bubbleId = /role="tooltip"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*role="tooltip"/.exec(out)!;
    expect(out).toContain(`aria-describedby="${bubbleId[1] ?? bubbleId[2]}"`);
  });
  const bubbleCls = (out: string) => /<span role="tooltip"[^>]*class="([^"]*)"/.exec(out)![1].split(' ');
  it('the closed bubble is display:none (no layout, no scroll overflow), shown on hover/focus, wrapping and width-capped', () => {
    const out = markup(h(ui.Tooltip, { text: 'x', children: h('span', null, 't') }));
    const cls = bubbleCls(out);
    expect(cls).toEqual(expect.arrayContaining(['hidden', 'group-hover/tooltip:block', 'group-focus-within/tooltip:block', 'max-w-[min(20rem,calc(100vw-2rem))]', 'whitespace-normal']));
    expect(cls).not.toContain('invisible');
    expect(cls).not.toContain('opacity-0');
    expect(out).toMatch(/^<div class="relative inline-flex group\/tooltip\b/);
  });
  it('editor.open forces the bubble visible', () => {
    const cls = bubbleCls(markup(h(ui.Tooltip, { text: 'x', editor: { open: true }, children: h('span', null, 't') })));
    expect(cls).toContain('block');
    expect(cls).not.toContain('hidden');
  });
  it('ids are unique per rendered item', () => {
    const out = markup(h('div', null, h(ui.Tooltip, { text: 'a', children: h('span', null, '1') }), h(ui.Tooltip, { text: 'b', children: h('span', null, '2') })));
    const ids = [...out.matchAll(/role="tooltip"[^>]*?id="([^"]+)"|id="([^"]+)"[^>]*?role="tooltip"/g)].map((m) => m[1] ?? m[2]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('Accordion', () => {
  it('named groups: a Tooltip inside an AccordionItem and a nested accordion chevron react only to their own element', () => {
    const out = block({
      el: 'Accordion',
      children: [
        {
          el: 'AccordionItem',
          bind: { title: c('Outer') },
          children: [
            { el: 'Tooltip', bind: { text: c('Tip') }, children: [{ el: 'Button', bind: { label: c('Go'), href: c('/go') } }] },
            { el: 'Accordion', children: [{ el: 'AccordionItem', bind: { title: c('Inner') }, children: [{ el: 'Text', props: { text: 'x' } }] }] },
          ],
        },
      ],
    });
    const classes = [...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(' '));
    // No unnamed group or group-* variant anywhere: the item is group/acc, the tooltip group/tooltip.
    expect(classes.filter((k) => k === 'group' || /^group-(hover|focus-within|open):/.test(k))).toEqual([]);
    expect(out.match(/<details class="group\/acc /g)).toHaveLength(2);
    expect(out.match(/group-open\/acc:rotate-180/g)).toHaveLength(2);
    const bubble = /<span role="tooltip"[^>]*class="([^"]*)"/.exec(out)![1].split(' ');
    expect(bubble).toEqual(expect.arrayContaining(['group-hover/tooltip:block', 'group-focus-within/tooltip:block']));
    expect(out).toContain('relative inline-flex group/tooltip');
  });
  const acc = (props: Record<string, unknown>) =>
    block({
      el: 'Accordion', props,
      children: [
        { el: 'AccordionItem', bind: { title: c('One') }, children: [{ el: 'Text', props: { text: 'Body 1' } }] },
        { el: 'AccordionItem', bind: { title: c('Two') }, children: [{ el: 'Text', props: { text: 'Body 2' } }] },
        { el: 'AccordionItem', bind: { title: c('Three') }, children: [{ el: 'Text', props: { text: 'Body 3' } }] },
      ],
    });
  it('renders one <details> per item with the title in <summary> and the content in the HTML', () => {
    const out = acc({});
    expect(out.match(/<details\b/g)).toHaveLength(3);
    expect(out.match(/<summary\b/g)).toHaveLength(3);
    expect(out).toMatch(/<summary\b[^>]*>One/);
    for (const t of ['Body 1', 'Body 2', 'Body 3']) expect(out).toContain(t);
    expect(out).not.toContain(' open=""');
    expect(out).not.toMatch(/<details\b[^>]*\sname=/);
  });
  it('single gives every item the same name', () => {
    const names = [...acc({ single: true }).matchAll(/<details\b[^>]*\sname="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(1);
  });
  it("defaultOpen 'first' opens the first item only", () => {
    const tags = [...acc({ defaultOpen: 'first' }).matchAll(/<details\b[^>]*>/g)].map((m) => m[0]);
    expect(tags[0]).toContain('open=""');
    expect(tags[1]).not.toContain('open');
    expect(tags[2]).not.toContain('open');
  });
  it('two accordions get different names; editor.open opens every item', () => {
    const one = (k: string) => h(ui.Accordion, { single: true, key: k }, h(ui.AccordionItem, { title: 'A' }, 'a'));
    const names = [...markup(h('div', null, one('1'), one('2'))).matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(2);
    const forced = markup(h(ui.Accordion, { editor: { open: true } }, h(ui.AccordionItem, { title: 'A' }, 'a'), h(ui.AccordionItem, { title: 'B' }, 'b')));
    expect(forced.match(/open=""/g)).toHaveLength(2);
  });
});

describe('form controls', () => {
  it('Input: <label for=X>, <input id=X required aria-describedby=Y> and the help text with id Y', () => {
    const out = block({
      el: 'Input', props: { name: 'email', type: 'email', required: true, autocomplete: 'email' },
      bind: { label: c('Email'), placeholder: c('you@example.com'), help: c('We never share it') },
    });
    const forId = attr(out, 'label', 'for')!;
    expect(forId).toBeTruthy();
    expect(attr(out, 'input', 'id')).toBe(forId);
    const helpId = attr(out, 'input', 'aria-describedby')!;
    expect(out).toMatch(new RegExp(`<p\\b[^>]*id="${helpId.replace(/[^\w-]/g, '\\$&')}"[^>]*>We never share it</p>`));
    expect(out).toMatch(/<input\b[^>]*\srequired=""/);
    expect(attr(out, 'input', 'type')).toBe('email');
    expect(attr(out, 'input', 'name')).toBe('email');
    expect(attr(out, 'input', 'autoComplete') ?? attr(out, 'input', 'autocomplete')).toBe('email');
    expect(attr(out, 'input', 'placeholder')).toBe('you@example.com');
    expect(out).toContain('>Email');
  });
  it('Input without help has no aria-describedby; disabled is passed through', () => {
    const out = block({ el: 'Input', props: { name: 'q', disabled: true }, bind: { label: c('Search') } });
    expect(out).not.toContain('aria-describedby');
    expect(out).toMatch(/<input\b[^>]*\sdisabled=""/);
    expect(attr(out, 'input', 'type')).toBe('text');
  });
  it('Textarea: rows, label and help', () => {
    const out = block({ el: 'Textarea', props: { name: 'msg', rows: 6 }, bind: { label: c('Message'), help: c('Max 500') } });
    expect(attr(out, 'textarea', 'rows')).toBe('6');
    expect(attr(out, 'label', 'for')).toBe(attr(out, 'textarea', 'id'));
    expect(attr(out, 'textarea', 'aria-describedby')).toBeTruthy();
  });
  it('Select: one <option> per option, defaultValue selected, a disabled placeholder option', () => {
    const out = block({
      el: 'Select',
      props: { name: 'size', defaultValue: 'm', options: [{ value: 's', label: 'Small' }, { value: 'm', label: { 'en-US': 'Medium', 'vi-VN': 'Vừa' } }, { value: 'l', label: 'Large' }] },
      bind: { label: c('Size'), placeholder: c('Pick a size') },
    });
    const opts = [...out.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
    expect(opts.map((m) => m[2])).toEqual(['Pick a size', 'Small', 'Medium', 'Large']);
    expect(opts[0][1]).toContain('disabled=""');
    expect(opts[0][1]).toContain('value=""');
    expect(opts[2][1]).toContain('selected=""');
    expect(opts.filter((m) => m[1].includes('selected')).length).toBe(1);
    expect(attr(out, 'label', 'for')).toBe(attr(out, 'select', 'id'));
  });
  it('Select without defaultValue selects the placeholder', () => {
    const out = block({ el: 'Select', props: { name: 'size', options: [{ value: 's', label: 'Small' }] }, bind: { placeholder: c('Pick') } });
    expect(out).toMatch(/<option\b[^>]*selected=""[^>]*>Pick<\/option>|<option\b[^>]*value=""[^>]*selected=""/);
  });
  it('Radio: <fieldset><legend> and one radio per option sharing the name', () => {
    const out = block({
      el: 'Radio',
      props: { name: 'ship', orientation: 'horizontal', defaultValue: 'b', required: true, options: [{ value: 'a', label: 'Standard' }, { value: 'b', label: 'Express' }] },
      bind: { label: c('Shipping'), help: c('Pick one') },
    });
    expect(out).toMatch(/^<fieldset\b[^>]*><legend\b[^>]*>Shipping/);
    const radios = [...out.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).toContain('name="ship"');
    expect(radios[1]).toContain('checked=""');
    expect(radios[0]).not.toContain('checked');
    expect(out).toContain('>Express<');
    expect(attr(out, 'fieldset', 'aria-describedby')).toBeTruthy();
  });
  it('Checkbox: native checkbox with value, label for and help', () => {
    const out = block({ el: 'Checkbox', props: { name: 'terms', value: 'yes', defaultChecked: true, required: true }, bind: { label: c('I agree'), help: c('Required') } });
    expect(attr(out, 'input', 'type')).toBe('checkbox');
    expect(attr(out, 'input', 'value')).toBe('yes');
    expect(out).toMatch(/<input\b[^>]*checked=""/);
    expect(out).not.toContain('role="switch"');
    expect(attr(out, 'label', 'for')).toBe(attr(out, 'input', 'id'));
    expect(attr(out, 'input', 'aria-describedby')).toBeTruthy();
  });
  it('Switch: a checkbox with role="switch" and a styled track', () => {
    const out = block({ el: 'Switch', props: { name: 'news' }, bind: { label: c('Newsletter') } });
    expect(out).toMatch(/<input\b[^>]*type="checkbox"[^>]*role="switch"|<input\b[^>]*role="switch"[^>]*type="checkbox"/);
    expect(out).toContain('peer-checked:');
    expect(out).toContain('peer-focus-visible:ring-2');
    expect(out).toContain('>Newsletter<');
  });
  it('a control without a label is named by aria-label: placeholder, else name (Checkbox, Switch, Radio: name)', () => {
    expect(attr(block({ el: 'Input', props: { name: 'q' }, bind: { placeholder: c('Search…') } }), 'input', 'aria-label')).toBe('Search…');
    expect(attr(block({ el: 'Input', props: { name: 'q' } }), 'input', 'aria-label')).toBe('q');
    expect(attr(block({ el: 'Textarea', props: { name: 'msg' }, bind: { placeholder: c('Your message') } }), 'textarea', 'aria-label')).toBe('Your message');
    expect(attr(block({ el: 'Select', props: { name: 'size', options: [{ value: 's', label: 'S' }] } }), 'select', 'aria-label')).toBe('size');
    expect(attr(block({ el: 'Checkbox', props: { name: 'terms' } }), 'input', 'aria-label')).toBe('terms');
    expect(attr(block({ el: 'Switch', props: { name: 'news' } }), 'input', 'aria-label')).toBe('news');
    expect(attr(block({ el: 'Radio', props: { name: 'ship', options: [{ value: 'a', label: 'A' }] } }), 'fieldset', 'aria-label')).toBe('ship');
    // With a label: no aria-label (the <label>/<legend> names it).
    for (const el of ['Input', 'Textarea', 'Checkbox', 'Switch'] as const) {
      const ph = el === 'Input' || el === 'Textarea' ? { placeholder: c('P') } : {};
      expect(block({ el, props: { name: 'n' }, bind: { label: c('L'), ...ph } }), el).not.toContain('aria-label');
    }
    expect(block({ el: 'Radio', props: { name: 'n', options: [{ value: 'a', label: 'A' }] }, bind: { label: c('L') } })).not.toContain('aria-label');
  });
  it('ids are unique across two controls with the same name', () => {
    const one = (k: string) => h(ui.Input, { key: k, name: 'q', label: 'Q' });
    const ids = [...markup(h('div', null, one('1'), one('2'))).matchAll(/<input\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('Button icons', () => {
  it("icon + iconOnly: aria-label is the label and the label text is not rendered", () => {
    const out = block({ el: 'Button', props: { label: 'Cart', href: '/cart', icon: 'shopping-cart', iconOnly: true } });
    expect(out).toMatch(/^<a\b[^>]*aria-label="Cart"/);
    expect(out).toContain('lucide-shopping-cart');
    expect(out).not.toMatch(/>Cart</);
  });
  it('icon at start by default, at end with iconPosition end; the label stays visible', () => {
    const start = block({ el: 'Button', props: { label: 'Cart', href: '/cart', icon: 'shopping-cart' } });
    expect(start).toMatch(/<svg\b.*<\/svg>Cart<\/a>$/);
    expect(start).not.toContain('aria-label');
    const end = block({ el: 'Button', props: { label: 'Next', href: '/n', icon: 'arrow-right', iconPosition: 'end' } });
    expect(end).toMatch(/>Next<svg\b.*<\/svg><\/a>$/);
  });
  it('an action button with iconOnly gets aria-label too', () => {
    const out = block({ el: 'Button', props: { label: 'Menu', icon: 'menu', iconOnly: true, action: { type: 'overlay', op: 'open', target: 'menu' } } });
    expect(out).toMatch(/^<button type="button"[^>]*aria-label="Menu"/);
    expect(out).not.toMatch(/>Menu</);
  });
});

describe('clickable Image, Box and Card', () => {
  it('Image with a bound href renders <a href> around the <img> with its alt', () => {
    const out = block({ el: 'Image', props: { src: '/logo.svg' }, bind: { href: c('/'), alt: c('Trang chủ') } });
    expect(out).toMatch(/^<a\b[^>]*href="\/"[^>]*><img\b[^>]*alt="Trang chủ"/);
    expect(out).toContain('focus-visible:ring-2');
    expect(out).toMatch(/<\/a>$/);
  });
  it('a clickable Image puts its layout style (span, height, width) on the link and fills it', () => {
    const tree = (img: Record<string, unknown>) => ({
      el: 'Columns' as const, props: { count: 2 },
      children: [{ el: 'Image' as const, props: { src: '/a.png', alt: 'A', ...img }, style: { span: { base: 'full', md: 2 }, height: '100%', width: '50%', margin: { base: { t: '4' } } } }],
    });
    const link = tree({});
    const cases = [
      ['a', block({ ...link, children: [{ ...link.children[0], bind: { href: c('/') } }] })],
      ['button', block(tree({ action: { type: 'scroll', target: 'top' } }))],
    ] as const;
    for (const [tag, linked] of cases) {
      const wrapCls = attr(linked, tag, 'class')!.split(' ');
      expect(wrapCls, tag).toEqual(expect.arrayContaining(['col-span-full', 'md:col-span-(--ocms-span-md)', 'h-(--ocms-h)', 'w-(--ocms-w)', 'mt-(--ocms-mt)']));
      const wrapStyle = attr(linked, tag, 'style')!;
      expect(wrapStyle, tag).toContain('--ocms-h:100%');
      expect(wrapStyle, tag).toContain('--ocms-w:50%');
      const imgTag = /<img\b[^>]*>/.exec(linked)![0];
      expect(imgTag, tag).not.toContain('style=');
      const imgCls = /class="([^"]*)"/.exec(imgTag)![1].split(' ');
      expect(imgCls, tag).toEqual(expect.arrayContaining(['w-full', 'h-full', 'object-cover']));
      expect(imgCls.some((k) => k.includes('--ocms')), tag).toBe(false);
    }
  });
  it('a clickable Image keeps object-fit and aspect on the img and h-auto without a style height', () => {
    const out = block({ el: 'Image', props: { src: '/a.png', alt: 'A', fit: 'contain', aspect: { base: 'square' } }, bind: { href: c('/') } });
    const imgCls = attr(out, 'img', 'class')!.split(' ');
    expect(imgCls).toEqual(expect.arrayContaining(['object-contain', 'aspect-square', 'w-full']));
    expect(imgCls).not.toContain('h-full');
  });
  it('a clickable Image without alt falls back to the block label', () => {
    const out = block({ el: 'Image', props: { src: '/logo.svg' }, bind: { href: c('/') } }, { label: { 'en-US': 'Logo', 'vi-VN': 'Biểu trưng' } });
    expect(attr(out, 'img', 'alt')).toBe('Logo');
  });
  it('Image with an action renders a <button type="button">', () => {
    const out = block({ el: 'Image', props: { src: '/a.png', alt: 'Open', action: { type: 'overlay', op: 'open', target: 'menu' } } });
    expect(out).toMatch(/^<button type="button"[^>]*><img\b/);
  });
  it('Box with a bound href renders an <a> with the Box classes, block display and focus ring', () => {
    const plain = block({ el: 'Box', props: { padding: '4' }, children: [{ el: 'Text', props: { text: 'x' } }] });
    const link = block({ el: 'Box', props: { padding: '4', ariaLabel: 'Go home' }, bind: { href: c('/home') }, children: [{ el: 'Text', props: { text: 'x' } }] });
    expect(link).toMatch(/^<a\b/);
    expect(attr(link, 'a', 'href')).toBe('/home');
    expect(attr(link, 'a', 'aria-label')).toBe('Go home');
    const cls = attr(link, 'a', 'class')!.split(' ');
    for (const k of attr(plain, 'div', 'class')!.split(' ')) expect(cls).toContain(k);
    expect(cls).toContain('block');
    expect(cls).toContain('focus-visible:ring-2');
  });
  it('Card with an action renders a <button type="button"> carrying the Card classes', () => {
    const plain = block({ el: 'Card', props: { padding: '4' }, children: [{ el: 'Text', props: { text: 'x' } }] });
    const btn = block({ el: 'Card', props: { padding: '4', action: { type: 'scroll', target: 'top' } }, children: [{ el: 'Text', props: { text: 'x' } }] });
    expect(btn).toMatch(/^<button type="button"/);
    const cls = attr(btn, 'button', 'class')!.split(' ');
    for (const k of attr(plain, 'div', 'class')!.split(' ')) expect(cls).toContain(k);
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('text-left');
  });
  it('an unsafe bound href leaves the Box unchanged', () => {
    const plain = block({ el: 'Box', children: [] });
    expect(block({ el: 'Box', bind: { href: c('javascript:alert(1)') }, children: [] })).toBe(plain);
  });
});

describe('hover style', () => {
  it('style.hover on Box adds the hover classes and variables', () => {
    const out = block({ el: 'Box', style: { hover: { background: 'brand:accent', color: '#ffffff', borderColor: 'muted' } } });
    const cls = attr(out, 'div', 'class')!.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['hover:bg-(--ocms-hover-bg)', 'hover:text-(--ocms-hover-fg)', 'hover:border-(--ocms-hover-border)']));
    const st = attr(out, 'div', 'style')!;
    expect(st).toContain('--ocms-hover-bg:var(--ocms-color-accent)');
    expect(st).toContain('--ocms-hover-fg:#ffffff');
    expect(st).toContain('--ocms-hover-border:var(--color-muted)');
  });
  it('only the set hover colors are emitted; no hover → no classes', () => {
    const out = block({ el: 'Card', style: { hover: { background: 'brand:accent' } } });
    expect(out).toContain('hover:bg-(--ocms-hover-bg)');
    expect(out).not.toContain('--ocms-hover-fg');
    expect(out).not.toContain('hover:text-(--ocms-hover-fg)');
    expect(block({ el: 'Box', style: { background: 'brand:accent' } })).not.toContain('hover');
  });
  it('a Button hover background replaces the variant hover background', () => {
    const out = block({ el: 'Button', props: { label: 'Go', href: '/x' }, style: { hover: { background: 'brand:accent' } } });
    const cls = attr(out, 'a', 'class')!.split(' ');
    expect(cls).toContain('hover:bg-(--ocms-hover-bg)');
    expect(cls).not.toContain('hover:bg-primary/90');
  });
});
