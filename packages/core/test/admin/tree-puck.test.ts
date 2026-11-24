import { describe, expect, it } from 'vitest';
import type { ComposedBlockSpec } from '@opencloudcms/schema';
import { CONTAINER_ELEMENTS, RESERVED_ITEM_KEYS, puckToTree, treeToPuck } from '../../admin/src/block-builder/tree-puck';

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

describe('tree ⇄ Puck', () => {
  it.each([
    ['single', productCard],
    ['collection', productGrid],
    ['unbound with slots', landing],
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
    expect(CONTAINER_ELEMENTS).toEqual(['Box', 'Stack', 'Columns', 'Grid', 'Card']);
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
