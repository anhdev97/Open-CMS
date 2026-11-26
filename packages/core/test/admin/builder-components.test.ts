// @vitest-environment happy-dom
// Block builder support of the component elements (spec §3): palette, element configs and field kinds, the
// "Add item / Add tab" field and the block-builder-only canvas visibility (Puck's store is stubbed).
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_CONTROL_ELEMENTS, INTERACTIVE_ELEMENTS, validateComposedSpec } from '@opencloudcms/schema';

const puck = vi.hoisted(() => ({
  snapshot: null as null | (() => unknown),
  state: {
    appState: { ui: { viewports: { current: { width: 1280 as number | '100%', height: 'auto' }, controlsVisible: true, options: [] } } },
    dispatch: (() => {}) as (a: unknown) => void,
    selectedItem: null as null | { type: string; props: Record<string, unknown> },
    getSelectorForId: (() => undefined) as (id: string) => { index: number; zone: string } | undefined,
  },
}));
vi.mock('@puckeditor/core', async (orig) => ({
  ...(await orig<object>()),
  createUsePuck: () => (sel: (s: unknown) => unknown) => sel(puck.state),
  useGetPuck: () => () => (puck.snapshot ? puck.snapshot() : puck.state),
}));

import { CanvasSelection, HoverPreview, type CanvasSelectionModel } from '../../admin/src/block-builder/context';
import { elementRender } from '../../admin/src/block-builder/Canvas';
import { ChildItemsField, newChildItem } from '../../admin/src/block-builder/ChildItemsField';
import { OptionsEditor } from '../../admin/src/block-builder/OptionsField';
import { IconPicker } from '../../admin/src/block-builder/IconPicker';
import { ELEMENT_DEFAULTS, ELEMENT_PROPS, STYLE_SECTIONS, buildBuilderConfig, paletteCategories } from '../../admin/src/block-builder/element-config';
import { enUS } from '../../admin/src/i18n/messages/en-US';
import { BreakpointContext } from '../../admin/src/block-builder/style/breakpoint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  puck.state.dispatch = vi.fn();
  puck.state.selectedItem = null;
  puck.snapshot = null;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const render = (node: ReactNode) => act(() => root.render(createElement(BreakpointContext.Provider, { value: 'lg' as const }, node)));
const q = <T extends Element = HTMLElement>(sel: string, from: ParentNode = container) => from.querySelector(sel) as T | null;
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byText = (sel: string, text: string) => [...container.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.trim() === text);
/** Whether `el` is shown: no `hidden` attribute and no `hidden` class on it or an ancestor inside the container. */
const isShown = (el: Element | null | undefined) => {
  for (let n = el; n && n !== container; n = n.parentElement) {
    if ((n as HTMLElement).hidden || n.classList.contains('hidden')) return false;
  }
  return !!el;
};

const stub = (() => null) as never;
const config = (collection = false) =>
  buildBuilderConfig({
    collection, token: stub, sources: stub, showIf: stub, allow: stub, tracks: stub, style: stub, responsiveSelect: stub, length: stub,
    action: stub, pattern: stub, regionLabel: stub, options: stub, icon: stub, childItems: stub, render: () => stub, root: stub,
  });
type Comp = {
  label: string;
  fields: Record<string, { type: string; allow?: string[]; disallow?: string[]; options?: { value: unknown }[]; metadata?: Record<string, unknown> }>;
  defaultProps: Record<string, unknown>;
  resolveData: (d: { props: Record<string, unknown> }, p: { lastData: { props: Record<string, unknown> } | null; trigger: string }) => { props: Record<string, unknown> };
  resolveFields: (d: { props: Record<string, unknown> }, p: { fields: Record<string, unknown> }) => Record<string, { options?: { value: unknown }[] }>;
};
const comp = (el: string, c = config()) => c.components[el] as unknown as Comp;

const NEW = ['Dropdown', 'Tooltip', 'Accordion', 'AccordionItem', 'Tabs', 'TabPanel', 'Carousel', 'Icon', ...FORM_CONTROL_ELEMENTS];
const bundles = {
  'en-US': async () => enUS,
  'vi-VN': async () => (await import('../../admin/src/i18n/messages/vi-VN')).default,
  'fr-FR': async () => (await import('../../admin/src/i18n/messages/fr-FR')).default,
  'id-ID': async () => (await import('../../admin/src/i18n/messages/id-ID')).default,
};

describe('palette', () => {
  it('an Interactive and a Form category; AccordionItem and TabPanel are not offered', () => {
    const cats = paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false });
    expect(cats.interactive).toEqual({ title: 'Interactive', components: ['Dropdown', 'Tooltip', 'Accordion', 'Tabs', 'Carousel', 'Icon'] });
    expect(cats.form).toEqual({ title: 'Form', components: [...FORM_CONTROL_ELEMENTS] });
    const offered = Object.values(cats).flatMap((c) => ('components' in c ? c.components : []));
    expect(offered).not.toContain('AccordionItem');
    expect(offered).not.toContain('TabPanel');
    for (const el of NEW.filter((e) => e !== 'AccordionItem' && e !== 'TabPanel')) expect(offered.filter((e) => e === el)).toHaveLength(1);
    // No Carousel in a collection item template.
    expect(paletteCategories({ collection: true, overlayRoot: false, emptyRoot: false }).interactive.components).not.toContain('Carousel');
  });

  it.each(Object.entries(bundles))('%s: labels of every new element, category, prop and value', async (_l, load) => {
    const m = (await load()) as unknown as typeof enUS;
    for (const el of NEW) expect(m.blockBuilder.elements[el as keyof typeof m.blockBuilder.elements], el).toBeTruthy();
    expect(m.blockBuilder.categories.interactive).toBeTruthy();
    expect(m.blockBuilder.categories.form).toBeTruthy();
    const NEW_PROPS = ['icon', 'iconPosition', 'iconOnly', 'action', 'ariaLabel'];
    for (const el of [...NEW, 'Button', 'Image', 'Box', 'Card'] as const) {
      for (const p of ELEMENT_PROPS[el as keyof typeof ELEMENT_PROPS].filter((d) => NEW.includes(el) || NEW_PROPS.includes(d.name))) {
        const key = p.labelKey ?? p.name;
        expect(m.blockBuilder.props[key as keyof typeof m.blockBuilder.props], `${el}.${key}`).toBeTruthy();
        for (const v of p.options ?? []) {
          if (typeof v === 'number') continue;
          expect(m.blockBuilder.values[v as keyof typeof m.blockBuilder.values], `${el}.${key}=${v}`).toBeTruthy();
        }
      }
    }
    const c = comp('Tabs');
    expect(c.label).toBe('Tabs');
  });
});

describe('element configs', () => {
  it('defaults from the spec table; Accordion and Tabs start with one item', () => {
    expect(ELEMENT_DEFAULTS.Dropdown).toEqual({
      openOn: 'hover', placement: 'bottom-start', display: 'popover', triggerVariant: 'ghost', chevron: true,
      bind: { label: { from: 'const', value: 'Menu' } },
    });
    expect(ELEMENT_DEFAULTS.Carousel).toMatchObject({ perView: { base: 1 }, arrows: true, dots: true, loop: false, autoplay: 'off' });
    expect(comp('Tabs').defaultProps).toEqual({
      variant: 'underline', align: 'start',
      children: [{ type: 'TabPanel', props: { bind: { label: { from: 'const', value: 'Tab 1' } } } }],
    });
    expect(comp('Accordion').defaultProps).toMatchObject({
      children: [{ type: 'AccordionItem', props: { bind: { title: { from: 'const', value: 'Item 1' } } } }],
    });
    expect(ELEMENT_DEFAULTS.Textarea).toMatchObject({ rows: 4 });
    expect(ELEMENT_DEFAULTS.Checkbox).toMatchObject({ value: 'on' });
  });

  it('dropped elements are valid specs (drop → a block that saves)', () => {
    const spec = (tree: unknown) => ({ id: 'blk_test01', name: 'T', label: { 'en-US': 'T' }, category: 'basic', version: 1, fields: {}, tree });
    const item = (el: string): Record<string, unknown> => {
      const { children, ...props } = (ELEMENT_DEFAULTS[el as keyof typeof ELEMENT_DEFAULTS] ?? {}) as Record<string, unknown>;
      const { bind, ...rest } = props;
      const node: Record<string, unknown> = { el };
      if (Object.keys(rest).length) node.props = rest;
      if (bind) node.bind = bind;
      if (Array.isArray(children)) node.children = children.map((c: { type: string; props: Record<string, unknown> }) => ({ el: c.type, bind: c.props.bind }));
      return node;
    };
    for (const el of NEW.filter((e) => !['AccordionItem', 'TabPanel', 'Tooltip', 'Carousel'].includes(e))) {
      expect(validateComposedSpec(spec({ el: 'Box', children: [item(el)] })), el).toEqual([]);
    }
  });

  it('slot rules: Accordion/Tabs take only their item; no Dropdown in a Dropdown; items never go elsewhere', () => {
    expect(comp('Accordion').fields.children!.allow).toEqual(['AccordionItem']);
    expect(comp('Tabs').fields.children!.allow).toEqual(['TabPanel']);
    expect(comp('Dropdown').fields.children!.disallow).toEqual(expect.arrayContaining(['Dropdown', 'Overlay', 'Region', 'PageContent']));
    expect(comp('Tooltip').fields.children!.disallow).toEqual(expect.arrayContaining(['Tooltip', 'Dropdown', ...FORM_CONTROL_ELEMENTS]));
    for (const el of ['Box', 'Stack', 'Card', 'Dropdown', 'Tooltip', 'Carousel', 'AccordionItem', 'TabPanel', 'Overlay']) {
      expect(comp(el).fields.children!.disallow, el).toEqual(expect.arrayContaining(['AccordionItem', 'TabPanel']));
    }
    // Interactive containers are not a direct child of the overlay frame; no Carousel in a collection template.
    expect(comp('Overlay').fields.children!.disallow).toEqual(expect.arrayContaining(['Dropdown', 'Tooltip', 'Accordion', 'Tabs', 'Carousel']));
    expect(comp('Box', config(true)).fields.children!.disallow).toContain('Carousel');
  });

  it('field kinds: options, icon, name; Image/Box/Card action; Box/Card ariaLabel; Button icon props', () => {
    expect(comp('Select').fields.options!.type).toBe('custom');
    expect(comp('Select').fields.name!.metadata).toMatchObject({ pattern: 'control', required: true });
    expect(comp('Icon').fields.name!.metadata).toMatchObject({ icon: true, optional: false });
    expect(comp('Button').fields.icon!.metadata).toMatchObject({ optional: true });
    expect(Object.keys(comp('Button').fields)).toEqual(expect.arrayContaining(['icon', 'iconPosition', 'iconOnly', 'action']));
    for (const el of ['Image', 'Box', 'Card']) expect(comp(el).fields.action!.type, el).toBe('custom');
    for (const el of ['Box', 'Card']) expect(comp(el).fields.ariaLabel!.type, el).toBe('text');
    expect(comp('Tabs').fields.childItems!.metadata).toMatchObject({ item: 'TabPanel' });
    expect(comp('Accordion').fields.childItems!.metadata).toMatchObject({ item: 'AccordionItem' });
    expect(comp('Carousel').fields.perView!.metadata).toMatchObject({ numeric: true });
  });

  it('defaultValue offers the current option values; an emptied optional prop is dropped', () => {
    const sel = comp('Select');
    const fields = sel.resolveFields({ props: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } }, { fields: sel.fields });
    expect(fields.defaultValue!.options!.map((o) => o.value)).toEqual(['', 'a', 'b']);
    const out = sel.resolveData({ props: { id: 's', defaultValue: '' } }, { lastData: { props: {} }, trigger: 'replace' }).props;
    expect('defaultValue' in out && out.defaultValue === undefined).toBe(true);
    const card = comp('Card').resolveData({ props: { id: 'c', ariaLabel: '' } }, { lastData: { props: {} }, trigger: 'replace' }).props;
    expect(card.ariaLabel).toBeUndefined();
  });

  it('style sections: hover on Box, Card and Button only', () => {
    for (const el of ['Box', 'Card', 'Button'] as const) expect(STYLE_SECTIONS[el]).toContain('hover');
    for (const [el, s] of Object.entries(STYLE_SECTIONS)) if (!['Box', 'Card', 'Button'].includes(el)) expect(s, el).not.toContain('hover');
  });
});

describe('Add item / Add tab', () => {
  it('newChildItem is the next numbered item', () => {
    expect(newChildItem('TabPanel', 1, 'TabPanel-x')).toEqual({ type: 'TabPanel', props: { id: 'TabPanel-x', bind: { label: { from: 'const', value: 'Tab 2' } } } });
    expect(newChildItem('AccordionItem', 0, 'AccordionItem-x').props.bind).toEqual({ title: { from: 'const', value: 'Item 1' } });
  });

  it('"Add tab" appends a TabPanel to the selected Tabs and selects it', () => {
    const tabs = { type: 'Tabs', props: { id: 'Tabs-1', children: [{ type: 'TabPanel', props: { id: 'TabPanel-1', bind: { label: { from: 'const', value: 'Tab 1' } } } }] } };
    // Like Puck's `getPuck()`, each call returns a snapshot whose `getSelectorForId` only knows the ids of the data at
    // that moment: the new TabPanel is found only through a snapshot taken after the `replace` was applied.
    let known = ['Tabs-1', 'TabPanel-1'];
    const snapshot = () => {
      const ids = [...known];
      return {
        ...puck.state,
        getSelectorForId: (id: string) => (!ids.includes(id) ? undefined : id === 'Tabs-1' ? { index: 0, zone: 'root:default-zone' } : { index: ids.indexOf(id) - 1, zone: 'Tabs-1:children' }),
      };
    };
    puck.snapshot = snapshot;
    puck.state.selectedItem = tabs;
    puck.state.dispatch = vi.fn((a: { type: string; data?: { props: { children: { props: { id: string } }[] } } }) => {
      if (a.type === 'replace') known = ['Tabs-1', ...a.data!.props.children.map((c) => c.props.id)];
    }) as never;
    const Field = ChildItemsField as unknown as (p: object) => ReactNode;
    render(createElement(Field, { field: { type: 'custom', label: 'Tabs', metadata: { item: 'TabPanel' } }, name: 'childItems', id: 'f', value: undefined, onChange: vi.fn() }));
    expect(container.textContent).toContain('1 tab');
    act(() => byText('button', 'Add tab')!.click());
    const calls = (puck.state.dispatch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const replace = calls.find((a) => a.type === 'replace');
    expect(replace).toMatchObject({ type: 'replace', destinationIndex: 0, destinationZone: 'root:default-zone' });
    const kids = replace.data.props.children;
    expect(kids).toHaveLength(2);
    expect(kids[1]).toMatchObject({ type: 'TabPanel', props: { bind: { label: { from: 'const', value: 'Tab 2' } } } });
    expect(calls.at(-1)).toEqual({ type: 'setUi', ui: { itemSelector: { index: 1, zone: 'Tabs-1:children' } } });
  });
});

describe('options field', () => {
  it('adds, reorders and removes rows', () => {
    const onChange = vi.fn();
    const one = [{ value: 'a', label: 'A' }];
    render(createElement(OptionsEditor, { id: 'o', label: 'Options', value: one, onChange }));
    act(() => byText('button', 'Add option')!.click());
    expect(onChange).toHaveBeenLastCalledWith([{ value: 'a', label: 'A' }, { value: 'option-2', label: 'Option 2' }]);
    const two = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    render(createElement(OptionsEditor, { id: 'o', label: 'Options', value: two, onChange }));
    act(() => q<HTMLButtonElement>('[data-row="0"] [data-move="down"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith([{ value: 'b', label: 'B' }, { value: 'a', label: 'A' }]);
    // The rows are now b, a: removing the second leaves b.
    act(() => q<HTMLButtonElement>('[data-row="1"] [data-remove]')!.click());
    expect(onChange).toHaveBeenLastCalledWith([{ value: 'b', label: 'B' }]);
    // The last row cannot be removed (1–100 entries).
    render(createElement(OptionsEditor, { id: 'o', label: 'Options', value: one, onChange }));
    expect(q<HTMLButtonElement>('[data-row="0"] [data-remove]')!.disabled).toBe(true);
  });

  it('rejects a duplicate value inline and writes nothing', () => {
    const onChange = vi.fn();
    render(createElement(OptionsEditor, { id: 'o', label: 'Options', value: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onChange }));
    type(q<HTMLInputElement>('[data-row="1"] input[data-value]')!, 'a');
    expect(onChange).not.toHaveBeenCalled();
    expect(q('[data-row="1"] [role="alert"]')?.textContent).toContain('a');
    type(q<HTMLInputElement>('[data-row="1"] input[data-value]')!, 'c');
    expect(onChange).toHaveBeenLastCalledWith([{ value: 'a', label: 'A' }, { value: 'c', label: 'B' }]);
    expect(q('[role="alert"]')).toBeNull();
  });
});

describe('icon picker', () => {
  it('filters by name and picks an icon', () => {
    const onChange = vi.fn();
    render(createElement(IconPicker, { id: 'i', label: 'Icon', value: 'star', onChange }));
    const all = container.querySelectorAll('[data-icon]').length;
    expect(all).toBeGreaterThan(50);
    type(q<HTMLInputElement>('input[type="search"]')!, 'cart');
    const shown = [...container.querySelectorAll('[data-icon]')].map((b) => b.getAttribute('data-icon'));
    expect(shown).toEqual(['shopping-cart']);
    act(() => q<HTMLButtonElement>('[data-icon="shopping-cart"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith('shopping-cart');
    type(q<HTMLInputElement>('input[type="search"]')!, 'zzz');
    expect(container.querySelectorAll('[data-icon]')).toHaveLength(0);
    expect(container.textContent).toContain('No matches');
  });
});

// ---- canvas ----
type Item = { type: string; props: Record<string, unknown> };
const sel = (over: Partial<CanvasSelectionModel> & { items?: Record<string, Item[]> }): CanvasSelectionModel => ({
  selectedId: over.selectedId ?? null,
  path: over.path ?? [],
  children: (id) => over.items?.[id] ?? [],
  select: over.select ?? (() => {}),
});
const withSel = (s: CanvasSelectionModel, node: ReactNode) => createElement(CanvasSelection.Provider, { value: s }, node);
const zone = (...kids: ReactNode[]) => ({ className, style }: { className?: string; style?: object }) => createElement('div', { 'data-zone': true, className, style }, ...kids);
const text = (t: string) => createElement('p', null, t);
const label = (v: string) => ({ from: 'const', value: v });

describe('canvas visibility (block builder only)', () => {
  const dropdown = (children = zone(text('Shop all'))) =>
    createElement(elementRender('Dropdown'), { id: 'Dropdown-1', openOn: 'hover', bind: { label: label('Shop') }, children, puck: {} });

  it('a Dropdown panel is open while the Dropdown or anything inside it is selected', () => {
    render(withSel(sel({ selectedId: 'Button-1', path: ['Button-1', 'Dropdown-1'] }), dropdown()));
    const panel = q('[role="group"]')!;
    expect(panel.textContent).toContain('Shop all');
    expect(isShown(panel)).toBe(true);
    render(withSel(sel({ selectedId: 'Heading-9', path: ['Heading-9'] }), dropdown()));
    expect(isShown(q('[role="group"]'))).toBe(false);
  });

  it('a Tooltip bubble is shown while selected', () => {
    const tip = createElement(elementRender('Tooltip'), { id: 'Tooltip-1', bind: { text: label('Free shipping') }, children: zone(text('Target')), puck: {} });
    render(withSel(sel({ selectedId: 'Tooltip-1', path: ['Tooltip-1'] }), tip));
    expect(isShown(q('[role="tooltip"]'))).toBe(true);
    render(withSel(sel({}), tip));
    expect(isShown(q('[role="tooltip"]'))).toBe(false);
  });

  const panels: Item[] = [
    { type: 'TabPanel', props: { id: 'TabPanel-1', bind: { label: label('Description') } } },
    { type: 'TabPanel', props: { id: 'TabPanel-2', bind: { label: label('Specs') } } },
  ];
  const panel = (i: number, content: string) =>
    createElement(elementRender('TabPanel'), { key: i, ...panels[i]!.props, children: zone(text(content)), puck: {} });
  const tabs = () => createElement(elementRender('Tabs'), { id: 'Tabs-1', variant: 'underline', children: zone(panel(0, 'First content'), panel(1, 'Second content')), puck: {} });

  it('Tabs show the selected TabPanel (or the one containing the selection); clicking a tab selects it', () => {
    const select = vi.fn();
    render(withSel(sel({ selectedId: 'TabPanel-2', path: ['TabPanel-2', 'Tabs-1'], items: { 'Tabs-1': panels }, select }), tabs()));
    expect(isShown(byText('p', 'Second content'))).toBe(true);
    expect(isShown(byText('p', 'First content'))).toBe(false);
    expect(byText('[role="tab"]', 'Specs')!.getAttribute('aria-selected')).toBe('true');

    render(withSel(sel({ selectedId: 'Text-5', path: ['Text-5', 'TabPanel-1', 'Tabs-1'], items: { 'Tabs-1': panels }, select }), tabs()));
    expect(isShown(byText('p', 'First content'))).toBe(true);
    expect(isShown(byText('p', 'Second content'))).toBe(false);

    act(() => byText('[role="tab"]', 'Specs')!.click());
    expect(select).toHaveBeenCalledWith('TabPanel-2');
  });

  it('removing the last TabPanel / AccordionItem shows an empty state and the validation message, no throw', () => {
    render(withSel(sel({ items: { 'Tabs-1': [] } }), createElement(elementRender('Tabs'), { id: 'Tabs-1', children: zone(), puck: {} })));
    const empty = q('[data-empty-items]')!;
    expect(empty.textContent).toContain('No tabs yet');
    expect(empty.textContent).toContain('Tabs must have 1 to 12 panels');
    render(withSel(sel({ items: { 'Accordion-1': [] } }), createElement(elementRender('Accordion'), { id: 'Accordion-1', children: zone(), puck: {} })));
    expect(q('[data-empty-items]')!.textContent).toContain('Accordion must have 1 to 30 items');
  });

  it('Accordion items render open', () => {
    const item = createElement(elementRender('AccordionItem'), { id: 'AccordionItem-1', bind: { title: label('Q') }, children: zone(text('Answer')), puck: {} });
    render(withSel(sel({ items: { 'Accordion-1': [{ type: 'AccordionItem', props: { id: 'AccordionItem-1' } }] } }),
      createElement(elementRender('Accordion'), { id: 'Accordion-1', children: zone(item), puck: {} })));
    expect(q<HTMLDetailsElement>('details')!.open).toBe(true);
    expect(q('[data-empty-items]')).toBeNull();
  });

  it('a Carousel lays its slides side by side (track and slide frames), no controls', () => {
    const slide = (t: string) => createElement(elementRender('Image'), { key: t, id: `Image-${t}`, puck: {} });
    render(withSel(sel({ items: { 'Carousel-1': [{ type: 'Image', props: { id: 'Image-a' } }, { type: 'Image', props: { id: 'Image-b' } }] } }),
      createElement(elementRender('Carousel'), { id: 'Carousel-1', perView: { base: 1, md: 3 }, autoplay: 5, children: zone(slide('a'), slide('b')), puck: {} })));
    const track = q('[data-zone]')!;
    expect(track.className).toContain('overflow-x-auto');
    expect(track.getAttribute('style') ?? '').toContain('--ocms-pv-md: 3');
    expect((track.firstElementChild as HTMLElement).className).toContain('shrink-0');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('a clickable Box refuses interactive elements in its slot while href/action is set', () => {
    let got: string[] | undefined;
    const Slot = ({ disallow }: { disallow?: string[] }) => {
      got = disallow;
      return null;
    };
    render(withSel(sel({}), createElement(elementRender('Box'), { id: 'Box-1', bind: { href: label('/x') }, children: Slot, puck: {} })));
    expect(got).toEqual(expect.arrayContaining([...INTERACTIVE_ELEMENTS]));
    got = undefined;
    render(withSel(sel({}), createElement(elementRender('Box'), { id: 'Box-1', children: Slot, puck: {} })));
    expect(got).toBeUndefined();
  });

  it('"Show hover" previews the hover colors on the selected element', () => {
    const btn = () => createElement(elementRender('Button'), { id: 'Button-1', bind: { label: label('Buy') }, style: { hover: { background: '#ff0000' } }, puck: {} });
    render(createElement(HoverPreview.Provider, { value: { id: null, set: () => {} } }, btn()));
    expect(container.innerHTML).not.toContain('--ocms-bg: #ff0000');
    render(createElement(HoverPreview.Provider, { value: { id: 'Button-1', set: () => {} } }, btn()));
    expect(container.innerHTML).toContain('--ocms-bg: #ff0000');
  });
});
