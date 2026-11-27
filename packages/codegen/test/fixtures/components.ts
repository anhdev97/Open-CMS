import type { ComposedBlockSpec, ComposedNode } from '@opencloudcms/schema';

const L = (en: string, vi?: string) => ({ 'en-US': en, ...(vi ? { 'vi-VN': vi } : {}) });
const opts = [
  { value: 'a', label: L('Apple', 'Táo') },
  { value: 'b', label: L('Banana') },
];

/** Unbound block with every new element, hover styles, Button icon props and a clickable Image. */
const componentsSpec0: ComposedBlockSpec = {
  id: 'blk_comps001',
  name: 'SiteKit',
  label: L('Site kit', 'Bộ trang'),
  category: 'Marketing',
  version: 1,
  fields: { menu: { kind: 'text', default: 'Products' }, tip: { kind: 'text', default: 'Hint' }, showTab: { kind: 'text' } },
  tree: {
    el: 'Box',
    style: { hover: { background: 'muted' } },
    children: [
      {
        el: 'Dropdown',
        props: { openOn: 'click', placement: 'bottom-end', display: { base: 'inline', md: 'popover' }, triggerVariant: 'outline', chevron: false },
        bind: { label: { from: 'field', name: 'menu' } },
        children: [
          { el: 'Button', props: { label: 'All', href: '/all', variant: 'ghost', icon: 'arrow-right', iconPosition: 'end' } },
          { el: 'Button', props: { label: 'Open', icon: 'menu', iconOnly: true, action: { type: 'overlay', op: 'open', target: 'menu' } }, style: { hover: { color: 'primary', borderColor: '#cfcab9' } } },
        ],
      },
      {
        el: 'Tooltip',
        props: { side: 'bottom', anchorId: 'tt' },
        bind: { text: { from: 'field', name: 'tip' } },
        children: [{ el: 'Button', props: { label: 'Hover me', href: '/x' } }],
      },
      { el: 'Tooltip', props: { text: 'Plain', side: 'left' }, children: [{ el: 'Icon', props: { name: 'info', size: 'lg' }, bind: { label: { from: 'const', value: 'Info' } } }] },
      {
        el: 'Accordion',
        props: { single: true, defaultOpen: 'first' },
        children: [
          { el: 'AccordionItem', props: { title: 'One', anchorId: 'one' }, children: [{ el: 'Text', props: { text: 'First body' } }] },
          { el: 'AccordionItem', bind: { title: { from: 'field', name: 'menu' } }, children: [{ el: 'Text', props: { text: 'Second body' } }] },
        ],
      },
      {
        el: 'Tabs',
        props: { variant: 'pills', align: 'center' },
        children: [
          { el: 'TabPanel', props: { label: 'Alpha', anchorId: 'alpha' }, children: [{ el: 'Text', props: { text: 'Alpha body' } }, { el: 'Spacer', props: { size: '4' } }] },
          { el: 'TabPanel', props: { label: 'Beta' }, showIf: { from: 'field', name: 'showTab', is: 'present' }, children: [{ el: 'Text', props: { text: 'Beta body' } }] },
          { el: 'TabPanel', bind: { label: { from: 'field', name: 'menu' } }, children: [] },
        ],
      },
      {
        el: 'Carousel',
        props: { perView: { base: 1, md: 2, lg: 3 }, gap: '4', arrows: false, dots: true, loop: true, autoplay: 5 },
        children: [
          { el: 'Image', props: { src: '/a.png', alt: 'A' } },
          { el: 'Image', props: { src: '/b.png', alt: '', action: { type: 'scroll', target: 'main' } } },
          { el: 'Box', props: { ariaLabel: 'Go there' }, bind: { href: { from: 'const', value: '/go' } }, style: { hover: { background: 'brand:surface' } }, children: [{ el: 'Text', props: { text: 'Slide' } }] },
        ],
      },
      { el: 'Input', props: { name: 'email', type: 'email', required: true, autocomplete: 'email', anchorId: 'em' }, bind: { label: { from: 'const', value: 'Email' } }, style: { width: 'auto' } },
      { el: 'Input', props: { name: 'plain', label: 'Plain', placeholder: 'Type', help: 'Help', disabled: false } },
      { el: 'Textarea', props: { name: 'msg', rows: 4, label: 'Message', required: true } },
      { el: 'Select', props: { name: 'fruit', options: opts, defaultValue: 'b', label: 'Fruit', placeholder: 'Pick' } },
      { el: 'Combobox', props: { name: 'fruit2', options: opts, defaultValue: 'a', label: 'Search', placeholder: 'Find', help: 'Pick one', disabled: true } },
      { el: 'Radio', props: { name: 'r', options: opts, orientation: 'horizontal', defaultValue: 'a', label: 'Choose', required: true } },
      { el: 'Radio', props: { name: 'r2', options: opts } },
      { el: 'Checkbox', props: { name: 'agree', value: 'yes', defaultChecked: true, label: 'Agree', help: 'Terms', required: true } },
      { el: 'Switch', props: { name: 'news', defaultChecked: true, label: 'News', help: 'Weekly', disabled: true } },
      { el: 'Switch', props: { name: 'sw' } },
    ] as ComposedNode[],
  },
};

/** Collection block with the carousel layout, clickable Card, clickable Image (no alt) and a tooltip on bound links. */
export const clickableSpec: ComposedBlockSpec = {
  id: 'blk_click001',
  name: 'ProductStrip',
  label: L('Product strip', 'Dải sản phẩm'),
  category: 'Shop',
  version: 1,
  binding: {
    apiId: 'product',
    mode: 'collection',
    limit: 6,
    layout: { kind: 'carousel', columns: 3 },
    urlPattern: '/products/{slug}',
    options: { editorLayout: true, emptyText: L('Nothing yet') },
  },
  fields: {},
  tree: {
    el: 'Card',
    bind: { href: { from: 'entryUrl' } },
    props: { ariaLabel: 'Open product' },
    style: { hover: { background: 'muted', borderColor: 'primary' } },
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Text', bind: { text: { from: 'entry', path: 'subtitle' } }, showIf: { from: 'entry', path: 'subtitle', is: 'present' } },
    ],
  },
};

/** Bound single block: clickable Image with a bound alt, tooltip target chosen at run time, Image fallback alt. */
const tooltipSpec0: ComposedBlockSpec = {
  id: 'blk_tip00001',
  name: 'ProductTip',
  label: L('Product tip', 'Gợi ý'),
  category: 'Shop',
  version: 1,
  binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' },
  fields: {},
  tree: {
    el: 'Stack',
    children: [
      { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'missingAlt' }, href: { from: 'entryUrl' } } },
      {
        el: 'Tooltip',
        props: { text: 'Open it' },
        children: [
          {
            el: 'Box',
            children: [
              { el: 'Text', props: { text: 'Not a link' } },
              { el: 'Button', props: { label: 'Hidden unless subtitle' }, showIf: { from: 'entry', path: 'subtitle', is: 'present' }, bind: { href: { from: 'entryUrl' } } },
              { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, href: { from: 'entry', path: 'link' } } },
            ],
          },
        ],
      },
      { el: 'Tooltip', props: { text: 'No target' }, children: [{ el: 'Text', props: { text: 'Plain text' } }] },
    ],
  },
};

const TEXT_KEYS = ['text', 'label', 'title', 'placeholder', 'help'];
/** Text props are bound (`bind: { from: 'const' }`): move the plain ones of the fixture into `bind`. */
function lift(n: ComposedNode): ComposedNode {
  const props: Record<string, unknown> = { ...n.props };
  const bind = { ...n.bind } as NonNullable<ComposedNode['bind']>;
  if (n.el !== 'Button' && n.el !== 'Icon' && n.el !== 'Image') {
    for (const k of TEXT_KEYS) {
      if (typeof props[k] === 'string' && !bind[k]) {
        bind[k] = { from: 'const', value: props[k] };
        delete props[k];
      }
    }
  }
  const out: ComposedNode = { ...n, ...(n.props ? { props } : {}), ...(Object.keys(bind).length ? { bind } : {}) };
  if (!Object.keys(props).length) delete out.props;
  if (n.children) out.children = n.children.map(lift);
  return out;
}
export const componentsSpec: ComposedBlockSpec = { ...componentsSpec0, tree: lift(componentsSpec0.tree) };
export const tooltipSpec: ComposedBlockSpec = { ...tooltipSpec0, tree: lift(tooltipSpec0.tree) };

/** Unbound block with three CollectionLists: grid (detail links, editor options), carousel (own urlPattern), list. */
export const listsSpec: ComposedBlockSpec = {
  id: 'blk_lists001',
  name: 'HomeLists',
  label: L('Home lists', 'Danh sách trang chủ'),
  category: 'Marketing',
  version: 1,
  fields: { title: { kind: 'text', default: 'Latest' } },
  tree: {
    el: 'Box',
    children: [
      { el: 'Heading', bind: { text: { from: 'field', name: 'title' } } },
      {
        el: 'CollectionList',
        props: {
          editor: { sort: true, layout: true },
          key: 'products',
          apiId: 'product',
          filter: [{ field: 'active', value: true }],
          sort: { field: 'createdAt', direction: 'desc' },
          limit: 6,
          layout: { kind: 'grid', columns: 4 },
          emptyText: L('No products yet', 'Chưa có sản phẩm'),
          anchorId: 'products',
        },
        style: { margin: { t: '8' }, background: 'muted' },
        children: [
          {
            el: 'Card',
            props: { ariaLabel: 'Open product' },
            bind: { href: { from: 'entryUrl' } },
            children: [
              { el: 'Image', bind: { src: { from: 'entry', path: 'image' } } },
              { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
              { el: 'Text', bind: { text: { from: 'entry', path: 'subtitle' } }, showIf: { from: 'entry', path: 'subtitle', is: 'present' } },
            ],
          },
          { el: 'Tooltip', bind: { text: { from: 'const', value: 'Details' } }, children: [{ el: 'Button', props: { label: 'View' }, bind: { href: { from: 'entryUrl' } } }] },
        ],
      },
      {
        el: 'CollectionList',
        props: { key: 'posts', apiId: 'post', layout: { kind: 'carousel', columns: 2 }, urlPattern: '/blog/{slug}' },
        children: [{ el: 'Button', bind: { label: { from: 'entry', path: 'name' }, href: { from: 'entryUrl' } } }],
      },
      {
        el: 'CollectionList',
        props: { key: 'faq', apiId: 'faq', layout: { kind: 'list' }, editor: { limit: true, filter: true } },
        children: [{ el: 'Text', bind: { text: { from: 'entry', path: 'name' } } }],
      },
    ],
  },
};

/** Single-bound block (no urlPattern: detail link) with a related-products list. */
export const singleListSpec: ComposedBlockSpec = {
  id: 'blk_lists002',
  name: 'ProductDetail',
  label: L('Product detail'),
  category: 'Shop',
  version: 1,
  binding: { apiId: 'product', mode: 'single' },
  fields: {},
  tree: {
    el: 'Stack',
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Button', props: { label: 'Permalink' }, bind: { href: { from: 'entryUrl' } } },
      {
        el: 'CollectionList',
        props: { key: 'related', apiId: 'product', limit: 3 },
        children: [
          { el: 'Text', bind: { text: { from: 'entry', path: 'name' } } },
          { el: 'Button', props: { label: 'Open' }, bind: { href: { from: 'entryUrl' } } },
        ],
      },
    ],
  },
};
