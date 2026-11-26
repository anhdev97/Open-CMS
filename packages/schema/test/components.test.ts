import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELEMENT_BINDABLE, INTERACTIVE_ELEMENTS, isClickable, validateComposedSpec, type ComposedBlockSpec, type ComposedNode,
} from '../src/composed-block';
import { ICON_NAMES, isIconName } from '../src/icons';
import { AUTOCOMPLETE_TOKENS, FORM_CONTROL_NAME_RE, INPUT_TYPES, validateOptions } from '../src/form-controls';

const c = (value: unknown) => ({ from: 'const' as const, value });
const spec = (tree: unknown, extra: Partial<ComposedBlockSpec> = {}): ComposedBlockSpec => ({
  id: 'blk_comp0001', name: 'Comp', label: { 'en-US': 'Comp' }, category: 'Content', version: 1,
  fields: {}, tree: tree as ComposedNode, ...extra,
});
const issuesOf = (tree: unknown, extra?: Partial<ComposedBlockSpec>) => validateComposedSpec(spec(tree, extra));
const paths = (tree: unknown, extra?: Partial<ComposedBlockSpec>) => issuesOf(tree, extra).map((i) => i.path.join('.'));
const btn = (label = 'Go'): ComposedNode => ({ el: 'Button', bind: { label: c(label), href: c('/x') } });
const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: { 'en-US': 'B', 'vi-VN': 'Bê' } }];
const coll = { binding: { apiId: 'product', mode: 'collection' as const, urlPattern: '/p/{slug}' } };

describe('element lists', () => {
  it('adds the bindable props of the new elements and clickable Image/Box/Card', () => {
    expect(ELEMENT_BINDABLE.Dropdown).toEqual(['label', 'href']);
    expect(ELEMENT_BINDABLE.Tooltip).toEqual(['text']);
    expect(ELEMENT_BINDABLE.AccordionItem).toEqual(['title']);
    expect(ELEMENT_BINDABLE.TabPanel).toEqual(['label']);
    expect(ELEMENT_BINDABLE.Icon).toEqual(['label']);
    for (const el of ['Input', 'Textarea', 'Select', 'Combobox'] as const) expect(ELEMENT_BINDABLE[el]).toEqual(['label', 'placeholder', 'help']);
    for (const el of ['Radio', 'Checkbox', 'Switch'] as const) expect(ELEMENT_BINDABLE[el]).toEqual(['label', 'help']);
    expect(ELEMENT_BINDABLE.Image).toEqual(['src', 'alt', 'href']);
    expect(ELEMENT_BINDABLE.Box).toEqual(['href']);
    expect(ELEMENT_BINDABLE.Card).toEqual(['href']);
    for (const el of ['Accordion', 'Tabs', 'Carousel'] as const) expect(ELEMENT_BINDABLE[el]).toEqual([]);
  });
  it('lists the interactive elements', () => {
    expect([...INTERACTIVE_ELEMENTS].sort()).toEqual(
      ['Button', 'Dropdown', 'Tooltip', 'Tabs', 'Accordion', 'Carousel', 'Slot', 'Input', 'Textarea', 'Select', 'Combobox', 'Radio', 'Checkbox', 'Switch'].sort(),
    );
  });
  it('icons: curated kebab-case list of at most 80', () => {
    expect(ICON_NAMES.length).toBeLessThanOrEqual(80);
    for (const n of ICON_NAMES) expect(n).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const n of ['menu', 'x', 'chevron-down', 'shopping-cart', 'share-2', 'log-out', 'moon', 'help-circle']) expect(isIconName(n), n).toBe(true);
    expect(isIconName('not-an-icon')).toBe(false);
    expect(isIconName(3)).toBe(false);
  });
  it('form control constants', () => {
    expect(FORM_CONTROL_NAME_RE.test('email')).toBe(true);
    expect(FORM_CONTROL_NAME_RE.test('1x')).toBe(false);
    expect(INPUT_TYPES).toEqual(['text', 'email', 'tel', 'number', 'url', 'password', 'date']);
    expect(AUTOCOMPLETE_TOKENS).toContain('email');
    expect(AUTOCOMPLETE_TOKENS).toContain('off');
  });
  it('validateOptions', () => {
    expect(validateOptions(opts, ['o'])).toEqual([]);
    expect(validateOptions([], ['o']).map((i) => i.path.join('.'))).toEqual(['o']);
    expect(validateOptions('x', ['o']).map((i) => i.path.join('.'))).toEqual(['o']);
    expect(validateOptions(Array.from({ length: 101 }, (_, i) => ({ value: `v${i}`, label: 'L' })), ['o'])).not.toEqual([]);
    expect(validateOptions([{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }], ['o']).map((i) => i.path.join('.'))).toEqual(['o.1.value']);
    expect(validateOptions([{ value: '', label: 'A' }], ['o']).map((i) => i.path.join('.'))).toEqual(['o.0.value']);
    expect(validateOptions([{ value: 'x'.repeat(101), label: 'A' }], ['o']).map((i) => i.path.join('.'))).toEqual(['o.0.value']);
    expect(validateOptions([{ value: 'a', label: '' }], ['o']).map((i) => i.path.join('.'))).toEqual(['o.0.label']);
    expect(validateOptions([{ value: 'a', label: { 'vi-VN': 'x' } }], ['o']).map((i) => i.path.join('.'))).toEqual(['o.0.label']);
  });
});

describe('Dropdown', () => {
  const nav = () => ({ el: 'Stack', children: [
    btn('Home'),
    { el: 'Dropdown', bind: { label: c('Shop') }, children: [{ el: 'Stack', children: [btn('A'), btn('B'), btn('C')] }] },
  ] });
  it('accepts a nav spec', () => expect(issuesOf(nav())).toEqual([]));
  it('accepts its props', () => {
    expect(issuesOf({ el: 'Dropdown', props: { openOn: 'click', placement: 'bottom-end', display: { base: 'inline', md: 'popover' }, triggerVariant: 'outline', chevron: true }, bind: { label: c('x'), href: c('/shop') }, children: [btn()] })).toEqual([]);
  });
  it('rejects bad props and unknown props', () => {
    expect(paths({ el: 'Dropdown', props: { openOn: 'focus', placement: 'top', display: { md: 'x' }, triggerVariant: 'huge', chevron: 'no', foo: 1 } }))
      .toEqual(expect.arrayContaining(['tree.props.openOn', 'tree.props.placement', 'tree.props.display.md', 'tree.props.triggerVariant', 'tree.props.chevron', 'tree.props.foo']));
  });
  it('rejects a Dropdown inside a Dropdown panel at any depth', () => {
    const t = nav();
    (t.children[1].children![0] as any).children.push({ el: 'Box', children: [{ el: 'Dropdown', bind: { label: c('In') } }] });
    expect(paths(t)).toEqual(['tree.children.1.children.0.children.3.children.0.el']);
  });
  it('requires chevron when href is bound', () => {
    expect(paths({ el: 'Dropdown', props: { chevron: false }, bind: { label: c('x'), href: c('/s') } })).toEqual(['tree.props.chevron']);
    expect(paths({ el: 'Dropdown', props: { chevron: false }, bind: { label: c('x') } })).toEqual([]);
  });
  it('rejects regions in a panel', () => {
    expect(paths({ el: 'Box', children: [{ el: 'Dropdown', children: [{ el: 'Region', props: { name: 'r' } }] }, { el: 'PageContent' }] })).toEqual(['tree.children.0.children.0.el']);
  });
});

describe('Accordion and Tabs', () => {
  const item = (t = 'Q'): ComposedNode => ({ el: 'AccordionItem', bind: { title: c(t) }, children: [{ el: 'Text', bind: { text: c('A') } }] });
  const panel = (t = 'T'): ComposedNode => ({ el: 'TabPanel', bind: { label: c(t) }, children: [{ el: 'Text' }] });
  it('accepts valid ones', () => {
    expect(issuesOf({ el: 'Accordion', props: { single: true, defaultOpen: 'first' }, children: [item(), item()] })).toEqual([]);
    expect(issuesOf({ el: 'Tabs', props: { variant: 'pills', align: 'stretch' }, children: [panel(), panel()] })).toEqual([]);
  });
  it('accepts only items / panels as children', () => {
    expect(paths({ el: 'Accordion', children: [item(), { el: 'Text' }] })).toEqual(['tree.children.1.el']);
    expect(paths({ el: 'Tabs', children: [panel(), item()] })).toEqual(expect.arrayContaining(['tree.children.1.el']));
  });
  it('accepts items / panels only directly inside their parent', () => {
    expect(paths({ el: 'Box', children: [item()] })).toEqual(['tree.children.0.el']);
    expect(paths({ el: 'Box', children: [panel()] })).toEqual(['tree.children.0.el']);
  });
  it('checks counts', () => {
    expect(paths({ el: 'Accordion', children: Array.from({ length: 31 }, () => item()) })).toEqual(['tree.children']);
    expect(paths({ el: 'Accordion', children: [] })).toEqual(['tree.children']);
    expect(paths({ el: 'Tabs', children: [] })).toEqual(['tree.children']);
    expect(paths({ el: 'Tabs' })).toEqual(['tree.children']);
    expect(paths({ el: 'Tabs', children: Array.from({ length: 13 }, () => panel()) })).toEqual(['tree.children']);
    expect(issuesOf({ el: 'Tabs', children: Array.from({ length: 12 }, () => panel()) })).toEqual([]);
  });
  it('rejects bad and unknown props', () => {
    expect(paths({ el: 'Tabs', props: { foo: 1 }, children: [panel()] })).toEqual(['tree.props.foo']);
    expect(paths({ el: 'Tabs', props: { variant: 'boxed', align: 'end' }, children: [panel()] })).toEqual(['tree.props.variant', 'tree.props.align']);
    expect(paths({ el: 'Accordion', props: { single: 'y', defaultOpen: 'all' }, children: [item()] })).toEqual(['tree.props.single', 'tree.props.defaultOpen']);
    expect(paths({ el: 'Accordion', children: [{ ...item(), props: { x: 1 } }] })).toEqual(['tree.children.0.props.x']);
  });
  it('keeps unknown props unchecked on existing elements', () => {
    expect(issuesOf({ el: 'Heading', props: { foo: 1 } })).toEqual([]);
  });
});

describe('Tooltip', () => {
  it('requires exactly one non-interactive-container child', () => {
    expect(issuesOf({ el: 'Tooltip', props: { side: 'left' }, bind: { text: c('Hint') }, children: [btn()] })).toEqual([]);
    expect(paths({ el: 'Tooltip', children: [btn(), btn()] })).toEqual(['tree.children']);
    expect(paths({ el: 'Tooltip' })).toEqual(['tree.children']);
    expect(paths({ el: 'Tooltip', children: [{ el: 'Input', props: { name: 'q' } }] })).toEqual(['tree.children.0.el']);
    expect(paths({ el: 'Tooltip', children: [{ el: 'Tooltip', children: [btn()] }] })).toEqual(['tree.children.0.el']);
    expect(paths({ el: 'Tooltip', children: [{ el: 'Dropdown' }] })).toEqual(['tree.children.0.el']);
  });
  it('checks side and text length', () => {
    expect(paths({ el: 'Tooltip', props: { side: 'middle' }, children: [btn()] })).toEqual(['tree.props.side']);
    expect(paths({ el: 'Tooltip', bind: { text: c('x'.repeat(201)) }, children: [btn()] })).toEqual(['tree.bind.text']);
  });
});

describe('Carousel', () => {
  const car = (props: Record<string, unknown> = {}, n = 2) => ({ el: 'Carousel', props, children: Array.from({ length: n }, () => ({ el: 'Image' })) });
  it('accepts valid props', () => {
    expect(issuesOf(car({ perView: { base: 1, md: 3, lg: 6 }, gap: '4', arrows: false, dots: true, loop: true, autoplay: 'off' }))).toEqual([]);
    expect(issuesOf(car({ autoplay: 3 }))).toEqual([]);
    expect(issuesOf(car({ perView: 2, autoplay: 10 }))).toEqual([]);
  });
  it('rejects bad props', () => {
    expect(paths(car({ perView: { base: 7 } }))).toEqual(['tree.props.perView.base']);
    expect(paths(car({ autoplay: 2 }))).toEqual(['tree.props.autoplay']);
    expect(paths(car({ autoplay: 4.5 }))).toEqual(['tree.props.autoplay']);
    expect(paths(car({ gap: '13px', loop: 1, foo: 2 }))).toEqual(['tree.props.gap', 'tree.props.loop', 'tree.props.foo']);
  });
  it('checks slide counts', () => {
    expect(paths(car({}, 0))).toEqual(['tree.children']);
    expect(paths(car({}, 21))).toEqual(['tree.children']);
  });
  it('is not allowed in a collection item template', () => {
    expect(paths({ el: 'Card', children: [car()] }, coll)).toEqual(['tree.children.0.el']);
  });
  it('interactive containers may not be the root of an overlay frame', () => {
    const ov = (child: unknown) => ({ el: 'Overlay', props: { variant: 'modal' }, children: [child] });
    expect(paths(ov(car()))).toEqual(['tree.children.0.el']);
    expect(paths(ov({ el: 'Tabs', children: [{ el: 'TabPanel' }] }))).toEqual(['tree.children.0.el']);
    expect(issuesOf(ov({ el: 'Box', children: [car()] }))).toEqual([]);
  });
  it('other interactive containers are allowed in collection item templates', () => {
    expect(issuesOf({ el: 'Card', children: [{ el: 'Tooltip', children: [{ el: 'Badge' }] }] }, coll)).toEqual([]);
  });
});

describe('Icon', () => {
  it('validates name and size', () => {
    expect(issuesOf({ el: 'Icon', props: { name: 'menu', size: 'lg' }, bind: { label: c('Menu') } })).toEqual([]);
    expect(paths({ el: 'Icon', props: { name: 'not-an-icon' } })).toEqual(['tree.props.name']);
    expect(paths({ el: 'Icon' })).toEqual(['tree.props.name']);
    expect(paths({ el: 'Icon', props: { name: 'menu', size: 'xxl' } })).toEqual(['tree.props.size']);
    expect(paths({ el: 'Icon', props: { name: 'menu' }, children: [{ el: 'Text' }] })).toEqual(['tree.children']);
  });
});

describe('form controls', () => {
  it('Input', () => {
    expect(issuesOf({ el: 'Input', props: { name: 'email', type: 'email', required: true, disabled: false, autocomplete: 'email' }, bind: { label: c('Email'), placeholder: c('you@x'), help: c('h') } })).toEqual([]);
    expect(paths({ el: 'Input', props: { name: '1x' } })).toEqual(['tree.props.name']);
    expect(paths({ el: 'Input', props: {} })).toEqual(['tree.props.name']);
    expect(paths({ el: 'Input', props: { name: 'c', type: 'color' } })).toEqual(['tree.props.type']);
    expect(paths({ el: 'Input', props: { name: 'c', autocomplete: 'cc-number', required: 'y' } })).toEqual(['tree.props.autocomplete', 'tree.props.required']);
  });
  it('Textarea rows', () => {
    expect(issuesOf({ el: 'Textarea', props: { name: 'msg', rows: 6 } })).toEqual([]);
    expect(paths({ el: 'Textarea', props: { name: 'msg', rows: 1 } })).toEqual(['tree.props.rows']);
    expect(paths({ el: 'Textarea', props: { name: 'msg', rows: 13 } })).toEqual(['tree.props.rows']);
  });
  it('Select / Combobox / Radio options and defaultValue', () => {
    expect(issuesOf({ el: 'Select', props: { name: 's', options: opts, defaultValue: 'b' } })).toEqual([]);
    expect(issuesOf({ el: 'Combobox', props: { name: 's', options: opts } })).toEqual([]);
    expect(issuesOf({ el: 'Radio', props: { name: 's', options: opts, orientation: 'horizontal' } })).toEqual([]);
    expect(paths({ el: 'Select', props: { name: 's', options: [...opts, { value: 'a', label: 'Again' }] } })).toEqual(['tree.props.options.2.value']);
    expect(paths({ el: 'Select', props: { name: 's', options: opts, defaultValue: 'zz' } })).toEqual(['tree.props.defaultValue']);
    expect(paths({ el: 'Radio', props: { name: 's', options: [] } })).toEqual(['tree.props.options']);
    expect(paths({ el: 'Radio', props: { name: 's' } })).toEqual(['tree.props.options']);
    expect(paths({ el: 'Radio', props: { name: 's', options: opts, orientation: 'grid' } })).toEqual(['tree.props.orientation']);
  });
  it('Checkbox and Switch', () => {
    expect(issuesOf({ el: 'Checkbox', props: { name: 'agree', value: 'yes', defaultChecked: true, required: true } })).toEqual([]);
    expect(issuesOf({ el: 'Switch', props: { name: 'news', defaultChecked: false, disabled: true } })).toEqual([]);
    expect(paths({ el: 'Switch', props: { name: 'news', required: true } })).toEqual(['tree.props.required']);
    expect(paths({ el: 'Checkbox', props: { name: 'a', value: 3 } })).toEqual(['tree.props.value']);
  });
  it('rejects binding non-bindable props', () => {
    expect(paths({ el: 'Radio', props: { name: 'r', options: opts }, bind: { placeholder: c('x') } })).toEqual(['tree.bind.placeholder']);
  });
});

describe('Button icons', () => {
  it('validates the new Button props only', () => {
    expect(issuesOf({ el: 'Button', props: { icon: 'search', iconPosition: 'end', iconOnly: true, foo: 1 }, bind: { label: c('Search') } })).toEqual([]);
    expect(paths({ el: 'Button', props: { icon: 'nope', iconPosition: 'middle', iconOnly: 'y' } })).toEqual(['tree.props.icon', 'tree.props.iconPosition', 'tree.props.iconOnly']);
  });
});

describe('clickable Image, Box and Card', () => {
  it('isClickable', () => {
    expect(isClickable({ el: 'Box', bind: { href: c('/x') } })).toBe(true);
    expect(isClickable({ el: 'Card', props: { action: { type: 'scroll', target: 'top' } } })).toBe(true);
    expect(isClickable({ el: 'Card', props: { action: { type: 'scroll', target: '1 bad' } } })).toBe(false);
    expect(isClickable({ el: 'Image', bind: { href: c('/') } })).toBe(true);
    expect(isClickable({ el: 'Box' })).toBe(false);
    expect(isClickable({ el: 'Button', bind: { href: c('/') } })).toBe(false);
  });
  it('a clickable Box refuses interactive descendants', () => {
    expect(paths({ el: 'Box', bind: { href: c('/x') }, children: [{ el: 'Stack', children: [btn()] }] })).toEqual(['tree.children.0.children.0.el']);
    expect(paths({ el: 'Box', props: { action: { type: 'overlay', op: 'open', target: 'm' } }, children: [{ el: 'Image', bind: { href: c('/') } }] })).toEqual(['tree.children.0.el']);
    expect(paths({ el: 'Box', bind: { href: c('/x') }, children: [{ el: 'Slot' }] })).toEqual(['tree.children.0.el']);
  });
  it('a non-clickable Box keeps accepting interactive children', () => {
    expect(issuesOf({ el: 'Box', children: [btn(), { el: 'Box', bind: { href: c('/') }, children: [{ el: 'Text' }] }] })).toEqual([]);
  });
  it('a clickable Card with text and image is valid', () => {
    expect(issuesOf({ el: 'Card', bind: { href: c('/p') }, props: { ariaLabel: 'Product' }, children: [{ el: 'Text', bind: { text: c('Hi') } }, { el: 'Image', bind: { src: c('/a.png'), alt: c('A') } }] })).toEqual([]);
    expect(issuesOf({ el: 'Card', bind: { href: { from: 'entryUrl' } }, children: [{ el: 'Text' }] }, coll)).toEqual([]);
  });
  it('validates action and ariaLabel', () => {
    expect(issuesOf({ el: 'Image', props: { action: { type: 'overlay', op: 'open', target: 'lien-he' } } })).toEqual([]);
    expect(paths({ el: 'Image', props: { action: { type: 'overlay', op: 'open' } } })).toEqual(['tree.props.action.target']);
    expect(paths({ el: 'Card', props: { action: { type: 'x' } } })).toEqual(['tree.props.action.type']);
    expect(paths({ el: 'Text', props: { action: { type: 'scroll', target: 'a' } } })).toEqual(['tree.props.action']);
    expect(paths({ el: 'Box', props: { ariaLabel: 3 } })).toEqual(['tree.props.ariaLabel']);
  });
  it('a clickable Image needs a non-empty alt', () => {
    expect(paths({ el: 'Image', bind: { href: c('/'), alt: c('') } })).toEqual(['tree.bind.alt']);
    expect(issuesOf({ el: 'Image', bind: { alt: c('') } })).toEqual([]);
    expect(issuesOf({ el: 'Image', bind: { href: c('/'), alt: c('Logo') } })).toEqual([]);
  });
});

describe('collection carousel layout', () => {
  const withLayout = (layout: unknown) => validateComposedSpec(spec({ el: 'Card' }, { binding: { apiId: 'p', mode: 'collection', layout } as any })).map((i) => i.path.join('.'));
  it('accepts carousel with 1-6 columns, keeps grid at 2-6', () => {
    expect(withLayout({ kind: 'carousel', columns: 1 })).toEqual([]);
    expect(withLayout({ kind: 'carousel', columns: 6 })).toEqual([]);
    expect(withLayout({ kind: 'carousel', columns: 7 })).toEqual(['binding.layout.columns']);
    expect(withLayout({ kind: 'grid', columns: 1 })).toEqual(['binding.layout.columns']);
    expect(withLayout({ kind: 'masonry' })).toEqual(['binding.layout.kind']);
  });
});

describe('existing specs keep their validation results', () => {
  const dir = path.resolve(__dirname, '../../../examples/my-store/src/blocks');
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.block.ts'));
  const load = (file: string): unknown => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
      .replace(/^import .*$/gm, '')
      .replace('export default defineComposedBlock(', 'return (');
    return new Function(src)();
  };
  it('finds the my-store specs', () => expect(files.length).toBeGreaterThan(5));
  it.each(files)('%s validates', (file) => expect(validateComposedSpec(load(file))).toEqual([]));
});
