import { describe, expect, it } from 'vitest';
import type { ComposedBlockSpec } from '@opencloudcms/schema';
import { CONTAINER_ELEMENTS, RESERVED_ITEM_KEYS, hoistOverlay, isEmptyTree, keepOverlayRoot, puckToTree, treeToPuck, uniqueRegionName } from '../../admin/src/block-builder/tree-puck';

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

const productCard = base({
  name: 'ProductCard',
  binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' },
  fields: { ctaLabel: { kind: 'text', label: { 'en-US': 'Button label' }, default: 'Buy now' } },
  tree: {
    el: 'Card',
    props: { padding: '4' },
    children: [
      { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'name' } } },
      { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Price', props: { showCurrency: false }, bind: { value: { from: 'entry', path: 'price' } } },
      { el: 'Badge', bind: { text: { from: 'const', value: 'Sale' } }, showIf: { from: 'entry', path: 'salePrice', is: 'present' } },
      { el: 'Button', props: { variant: 'default' }, bind: { label: { from: 'field', name: 'ctaLabel' }, href: { from: 'entryUrl' } } },
    ],
  },
});

const productGrid = base({
  name: 'ProductList',
  binding: {
    apiId: 'product',
    mode: 'collection',
    filter: [{ field: 'active', value: true }],
    sort: { field: 'createdAt', direction: 'desc' },
    limit: 8,
    layout: { kind: 'grid', columns: 4 },
    options: { editorSort: true, emptyText: { 'en-US': 'No products yet' } },
  },
  tree: {
    el: 'Card',
    children: [
      { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Date', props: { format: 'long', timeZone: 'Asia/Ho_Chi_Minh' }, bind: { value: { from: 'entry', path: 'createdAt' } } },
    ],
  },
});

const landing = base({
  name: 'Landing',
  fields: {
    title: { kind: 'text', default: 'Hello' },
    tone: { kind: 'select', options: ['a', 'b'], default: 'a' },
    body: { kind: 'richText' },
  },
  tree: {
    el: 'Box',
    props: { padding: '12', background: 'muted' },
    children: [
      {
        el: 'Stack',
        props: { direction: 'horizontal', gap: '6', align: 'center' },
        children: [
          { el: 'Heading', props: { level: 1, align: 'center' }, bind: { text: { from: 'field', name: 'title' } } },
          { el: 'Text', props: { size: 'lg' }, bind: { html: { from: 'field', name: 'body' } }, showIf: { from: 'field', name: 'body', is: 'present' } },
        ],
      },
      { el: 'Columns', props: { count: 2 }, children: [{ el: 'Slot', props: { allow: ['Hero'], max: 2 } }, { el: 'Box' }] },
      { el: 'Grid', props: { columns: 5 } },
      { el: 'Divider' },
      { el: 'Spacer', props: { size: '8' } },
      { el: 'Text', props: { text: 'Fixed text' } },
    ],
  },
});

const siteLayout = base({
  name: 'SiteLayout',
  tree: {
    el: 'Stack',
    props: { direction: 'vertical' },
    children: [
      { el: 'Region', props: { name: 'header', label: 'Header', allow: ['Nav'] } },
      { el: 'Box', props: { anchorId: 'main' }, children: [{ el: 'PageContent' }] },
      { el: 'Region', props: { name: 'footer' } },
    ],
  },
});

const contactOverlay = base({
  name: 'ContactOverlay',
  tree: {
    el: 'Overlay',
    props: { variant: 'drawer', side: 'left', size: 'lg', closeOnBackdrop: false, showClose: true },
    style: { padding: { t: '4' } },
    children: [
      { el: 'Heading', props: { level: 2, anchorId: 'contact-title' }, bind: { text: { from: 'const', value: 'Contact' } } },
      { el: 'Button', props: { action: { type: 'overlay', op: 'close' } }, bind: { label: { from: 'const', value: 'Close' } } },
      { el: 'Button', props: { action: { type: 'scroll', target: 'Features' } }, bind: { label: { from: 'const', value: 'Go' } } },
    ],
  },
});

// Every builder component element, with props, bindings, hover and clickable containers.
const components = base({
  name: 'Components',
  tree: {
    el: 'Stack',
    props: { direction: 'vertical' },
    children: [
      {
        el: 'Dropdown',
        props: { openOn: 'click', placement: 'bottom-end', display: { base: 'inline', md: 'popover' }, triggerVariant: 'ghost', chevron: true },
        bind: { label: { from: 'const', value: 'Shop' }, href: { from: 'const', value: '/shop' } },
        children: [{ el: 'Button', props: { variant: 'link', icon: 'star', iconPosition: 'end' }, bind: { label: { from: 'const', value: 'All' } } }],
      },
      { el: 'Tooltip', props: { side: 'bottom' }, bind: { text: { from: 'const', value: 'Hi' } }, children: [{ el: 'Icon', props: { name: 'info', size: 'lg' } }] },
      {
        el: 'Accordion',
        props: { single: true, defaultOpen: 'first' },
        children: [{ el: 'AccordionItem', bind: { title: { from: 'const', value: 'Q1' } }, children: [{ el: 'Text', bind: { text: { from: 'const', value: 'A1' } } }] }],
      },
      {
        el: 'Tabs',
        props: { variant: 'pills', align: 'stretch' },
        children: [
          { el: 'TabPanel', props: { anchorId: 'spec' }, bind: { label: { from: 'const', value: 'Tab 1' } }, children: [{ el: 'Text' }] },
          { el: 'TabPanel', bind: { label: { from: 'const', value: 'Tab 2' } } },
        ],
      },
      { el: 'Carousel', props: { perView: { base: 1, md: 3 }, gap: '4', arrows: true, dots: false, loop: true, autoplay: 5 }, children: [{ el: 'Image' }, { el: 'Image' }] },
      { el: 'Input', props: { name: 'email', type: 'email', required: true, autocomplete: 'email' }, bind: { label: { from: 'const', value: 'Email' }, help: { from: 'const', value: 'We reply' } } },
      { el: 'Textarea', props: { name: 'message', rows: 6 } },
      { el: 'Select', props: { name: 'topic', options: [{ value: 'a', label: 'A' }, { value: 'b', label: { 'en-US': 'B', 'vi-VN': 'B vi' } }], defaultValue: 'b' } },
      { el: 'Combobox', props: { name: 'city', options: [{ value: 'hn', label: 'Hà Nội' }] } },
      { el: 'Radio', props: { name: 'size', options: [{ value: 's', label: 'S' }], orientation: 'horizontal' } },
      { el: 'Checkbox', props: { name: 'news', value: 'yes', defaultChecked: true } },
      { el: 'Switch', props: { name: 'dark', disabled: true } },
      {
        el: 'Card',
        props: { action: { type: 'overlay', op: 'open', target: 'cart' }, ariaLabel: 'Open cart' },
        style: { hover: { background: 'muted', color: 'brand:ink', borderColor: '#ff0000' } },
        children: [{ el: 'Image', props: { action: { type: 'scroll', target: 'top' } } }],
      },
      { el: 'Box', bind: { href: { from: 'entryUrl' } }, children: [{ el: 'Heading' }] },
    ],
  },
});

describe('tree ⇄ Puck', () => {
  it.each([
    ['every builder component element', components],
    ['single', productCard],
    ['collection', productGrid],
    ['unbound with slots', landing],
    ['layout (Region, PageContent)', siteLayout],
    ['overlay with button actions', contactOverlay],
  ])('round-trips the %s fixture', (_n, spec) => {
    expect(puckToTree(treeToPuck(spec).data)).toEqual(spec.tree);
  });

  it('gives every item a unique id and puts container children in a `children` slot', () => {
    const { data } = treeToPuck(landing);
    expect(data.content).toHaveLength(1);
    const root = data.content[0]!;
    expect(root.type).toBe('Box');
    expect(Array.isArray(root.props.children)).toBe(true);
    const ids: string[] = [];
    const walk = (items: { props: Record<string, unknown> }[]) => {
      for (const it of items) {
        ids.push(String(it.props.id));
        if (Array.isArray(it.props.children)) walk(it.props.children as never);
      }
    };
    walk(data.content as never);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONTAINER_ELEMENTS).toEqual(['Box', 'Stack', 'Columns', 'Grid', 'Card', 'Overlay', 'Dropdown', 'Tooltip', 'Accordion', 'AccordionItem', 'Tabs', 'TabPanel', 'Carousel']);
  });

  it('drops undefined props and empty children; several top-level items become a vertical Stack; none → empty Box', () => {
    const tree = puckToTree({
      root: { props: {} },
      content: [
        { type: 'Heading', props: { id: 'a', level: 2, align: undefined, bind: { text: { from: 'const', value: 'Hi' } } } },
        { type: 'Card', props: { id: 'b', children: [] } },
      ],
    } as never);
    expect(tree).toEqual({
      el: 'Stack',
      props: { direction: 'vertical' },
      children: [{ el: 'Heading', props: { level: 2 }, bind: { text: { from: 'const', value: 'Hi' } } }, { el: 'Card' }],
    });
    expect(puckToTree({ root: { props: {} }, content: [] } as never)).toEqual({ el: 'Box' });
  });

  it('drops an empty bind object and a missing showIf', () => {
    expect(puckToTree({ root: {}, content: [{ type: 'Text', props: { id: 'x', bind: {}, showIf: null } }] } as never)).toEqual({ el: 'Text' });
  });

  it('keeps `style` as a reserved item key, copied both ways and dropped when empty', () => {
    expect(RESERVED_ITEM_KEYS).toContain('style');
    const tree = {
      el: 'Columns' as const,
      props: { tracks: { base: ['1fr'], md: ['2fr', '1fr'] }, alignY: 'center' as const, gapX: '24px' },
      style: { padding: { base: { t: '4', b: '4' }, md: { t: '37px' } }, background: 'brand:sky', hidden: { lg: true } },
      children: [{ el: 'Heading' as const, props: { level: 2 }, style: { margin: { b: '-8px' }, span: { md: 2 } } }],
    };
    const { data } = treeToPuck({ tree });
    expect(data.content[0]!.props.style).toEqual(tree.style);
    expect(data.content[0]!.props).not.toHaveProperty('props');
    expect(puckToTree(data)).toEqual(tree);
    expect(puckToTree({ root: {}, content: [{ type: 'Box', props: { id: 'x', style: {} } }] } as never)).toEqual({ el: 'Box' });
  });
});

describe('layout and overlay elements in the canvas data', () => {
  it('Region and PageContent are leaves; Overlay holds its children in a slot', () => {
    const layout = treeToPuck(siteLayout).data.content[0]!;
    const kids = layout.props.children as { type: string; props: Record<string, unknown> }[];
    expect(kids[0]!.props).not.toHaveProperty('children');
    expect(kids[0]!.props).toMatchObject({ name: 'header', label: 'Header', allow: ['Nav'] });
    const overlay = treeToPuck(contactOverlay).data.content[0]!;
    expect(overlay.type).toBe('Overlay');
    expect((overlay.props.children as unknown[]).length).toBe(3);
    expect((overlay.props.children as { props: Record<string, unknown> }[])[1]!.props.action).toEqual({ type: 'overlay', op: 'close' });
  });

  it('a new region gets a free name: region, region-2, …', () => {
    expect(uniqueRegionName('region', [])).toBe('region');
    expect(uniqueRegionName('region', ['region'])).toBe('region-2');
    expect(uniqueRegionName('region', ['region', 'region-2', 'region-3'])).toBe('region-4');
    expect(uniqueRegionName('header', ['region'])).toBe('header');
  });

  it('an empty tree is an empty container root (or nothing); a root with children is not', () => {
    expect(isEmptyTree({ el: 'Box' })).toBe(true);
    expect(isEmptyTree({ el: 'Card', children: [] })).toBe(true);
    expect(isEmptyTree({ el: 'Card', children: [{ el: 'Heading' }] })).toBe(false);
    expect(isEmptyTree({ el: 'Heading' })).toBe(false);
    expect(isEmptyTree({ el: 'Overlay' })).toBe(false);
    // An interactive container without children is not an empty design (only layout containers are).
    expect(isEmptyTree({ el: 'Tabs', children: [] })).toBe(false);
    expect(isEmptyTree({ el: 'Dropdown' })).toBe(false);
  });

  it('an Overlay dropped next to an empty root becomes the root', () => {
    const ov = { type: 'Overlay', props: { id: 'Overlay-9', variant: 'modal', children: [] } };
    const data = { root: { props: {} }, content: [{ type: 'Card', props: { id: 'Card-1', children: [] } }, ov] };
    expect(hoistOverlay(data as never)).toEqual({ root: { props: {} }, content: [ov] });
    // Not when the other root has content, nor when the Overlay already is the only item.
    const full = { root: { props: {} }, content: [{ type: 'Card', props: { id: 'Card-1', children: [{ type: 'Heading', props: { id: 'h' } }] } }, ov] };
    expect(hoistOverlay(full as never)).toBeNull();
    expect(hoistOverlay({ root: { props: {} }, content: [ov] } as never)).toBeNull();
  });
});

describe('an Overlay root stays the root', () => {
  const ov = (children: unknown[]) => ({ type: 'Overlay', props: { id: 'Overlay-1', variant: 'modal', children } });
  const h = { type: 'Heading', props: { id: 'Heading-2' } };
  const txt = { type: 'Text', props: { id: 'Text-3' } };
  const btn = { type: 'Button', props: { id: 'Button-4' } };

  it('elements dropped next to it at root level move inside it (before → first, after → last)', () => {
    const prev = { root: { props: {} }, content: [ov([h])] };
    const next = { root: { props: {} }, content: [txt, ov([h]), btn] };
    expect(keepOverlayRoot(prev as never, next as never)).toEqual({ root: { props: {} }, content: [ov([txt, h, btn])] });
  });

  it('nothing to do when the Overlay is alone, or was not the root before', () => {
    const alone = { root: { props: {} }, content: [ov([h])] };
    expect(keepOverlayRoot(alone as never, alone as never)).toBeNull();
    const card = { root: { props: {} }, content: [{ type: 'Card', props: { id: 'Card-1', children: [h] } }] };
    expect(keepOverlayRoot(card as never, { root: { props: {} }, content: [card.content[0], txt] } as never)).toBeNull();
  });
});
