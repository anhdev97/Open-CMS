// @vitest-environment happy-dom
// Palette search of the Block builder palette (elements and templates) and of the Page builder block list
// (spec §3 "Palette search", Decision 8). Puck's store is stubbed; `getPuck()` returns a snapshot, as in Puck 0.24.1.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineBlocks, defineComposedBlock, type ComposedBlockSpec } from '@opencloudcms/core/blocks';
import { foldSearch } from '@opencloudcms/schema';

type Item = { type: string; props: Record<string, unknown> & { id: string } };
type Data = { root: { props: object }; content: Item[] };
const puck = vi.hoisted(() => ({
  data: { root: { props: {} }, content: [] } as unknown as { root: { props: object }; content: { type: string; props: Record<string, unknown> & { id: string } }[] },
  componentList: {} as Record<string, Record<string, unknown>>,
  selectedId: null as string | null,
  actions: [] as Record<string, unknown>[],
}));

/** Every item by id, with the zone it is in (`root:default-zone` or `<parent>:children`) and its index. */
function index(data: Data) {
  const out = new Map<string, { item: Item; zone: string; index: number }>();
  const walk = (items: Item[], zone: string) =>
    items.forEach((it, i) => {
      out.set(it.props.id, { item: it, zone, index: i });
      if (Array.isArray(it.props.children)) walk(it.props.children as Item[], `${it.props.id}:children`);
    });
  walk(data.content, 'root:default-zone');
  return out;
}
/** A snapshot of the state now: later dispatches do not change what it sees. */
function snapshot() {
  const data = structuredClone(puck.data) as Data;
  const idx = index(data);
  return {
    appState: { data, ui: { componentList: structuredClone(puck.componentList) } },
    selectedItem: puck.selectedId ? (idx.get(puck.selectedId)?.item ?? null) : null,
    getSelectorForId: (id: string) => {
      const e = idx.get(id);
      return e ? { zone: e.zone, index: e.index } : undefined;
    },
    dispatch: (a: Record<string, unknown>) => {
      puck.actions.push(a);
      if (a.type === 'setUi') {
        const ui = a.ui as { componentList?: Record<string, Record<string, unknown>> };
        if (ui.componentList) puck.componentList = ui.componentList;
      }
      if (a.type === 'insert') {
        const item = { type: a.componentType as string, props: { id: a.id as string } };
        const zone = a.destinationZone as string;
        if (zone === 'root:default-zone') puck.data.content.splice(a.destinationIndex as number, 0, item);
        else {
          const parent = index(puck.data as Data).get(zone.split(':')[0]!)!.item;
          ((parent.props.children ??= []) as Item[]).splice(a.destinationIndex as number, 0, item);
        }
      }
    },
  };
}
vi.mock('@puckeditor/core', async (orig) => ({
  ...(await orig<object>()),
  useGetPuck: () => snapshot,
}));

import { PaletteSearch, filterPalette, insertAndSelect, isTextField, type PaletteModel } from '../../admin/src/components/PaletteSearch';
import { blockBuilderPalette, paletteCategories, paletteInsertTarget } from '../../admin/src/block-builder/element-config';
import { templateName } from '../../admin/src/block-builder/templates';
import { pageBuilderPalette } from '../../admin/src/page-editor/editor-config';
import { setActiveMessages } from '../../admin/src/i18n';
import { enUS } from '../../admin/src/i18n/messages/en-US';
import viVN from '../../admin/src/i18n/messages/vi-VN';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  puck.data = { root: { props: {} }, content: [] };
  puck.componentList = {};
  puck.selectedId = null;
  puck.actions = [];
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  setActiveMessages('en-US', enUS);
});

const input = () => container.querySelector<HTMLInputElement>('[data-palette-search] input')!;
function type(value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
};
/** Visible components of the componentList Puck was last given. */
const shown = () =>
  Object.values(puck.componentList)
    .filter((c) => c.visible !== false)
    .flatMap((c) => (c.components as string[] | undefined) ?? []);
const visibleCategories = () => Object.entries(puck.componentList).filter(([, c]) => c.visible !== false).map(([k]) => k);

function builderModel(onInsert = vi.fn()): PaletteModel {
  const cats = paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false });
  const m = blockBuilderPalette(cats, false);
  return { ...m, insert: onInsert };
}
const mount = (m: PaletteModel) => act(() => root.render(createElement(PaletteSearch, m)));

describe('foldSearch', () => {
  it('lowercases and strips accents (đ → d)', () => {
    expect(foldSearch('Ảnh đẹp')).toBe('anh dep');
  });
});

describe('filterPalette', () => {
  const describeName = (n: string) => ({ label: n === 'Image' ? 'Ảnh' : n, english: n });
  it('keeps matching components, hides empty categories and lists the matches in order', () => {
    const r = filterPalette({ a: { title: 'A', components: ['Image', 'Text'] }, b: { title: 'B', components: ['Tabs'] }, h: { components: ['X'], visible: false } }, 'anh', describeName);
    expect(r.matches).toEqual(['Image']);
    expect(r.categories.a).toMatchObject({ components: ['Image'] });
    expect(r.categories.b).toMatchObject({ components: [], visible: false });
    // Hidden categories stay hidden and are not searched.
    expect(r.categories.h).toMatchObject({ visible: false });
    // The components filtered out sit in a hidden category (Puck would list uncategorized ones under "Other").
    expect(Object.values(r.categories).flatMap((c) => c.components ?? []).sort()).toEqual(['Image', 'Tabs', 'Text', 'X']);
  });
  it('an empty query changes nothing', () => {
    const cats = { a: { title: 'A', components: ['Image'] } };
    expect(filterPalette(cats, '  ', describeName)).toEqual({ categories: cats, matches: ['Image'] });
  });
});

describe('Block builder palette search', () => {
  it('vi-VN: "anh" leaves Image (Ảnh); "tab" leaves Tabs and the Product tabs template', () => {
    setActiveMessages('vi-VN', viVN as never);
    mount(builderModel());
    expect(input().getAttribute('aria-label') ?? container.querySelector('label')?.textContent).toBe(viVN.paletteSearch.labelBlockBuilder);
    type('anh');
    expect(shown()).toContain('Image');
    expect(shown()).not.toContain('Heading');
    type('tab');
    expect(shown()).toEqual(expect.arrayContaining(['Tabs', templateName('product-tabs')]));
    expect(shown()).not.toContain('Image');
    expect(visibleCategories().sort()).toEqual(['interactive', 'templates']);
  });

  it('"zzz" shows "No matches" and hides every category; clearing restores the palette', () => {
    mount(builderModel());
    const all = shown().length;
    type('zzz');
    expect(container.querySelector('[data-palette-empty]')?.textContent).toBe('No matches');
    expect(shown()).toEqual([]);
    type('');
    expect(container.querySelector('[data-palette-empty]')).toBeNull();
    expect(shown()).toHaveLength(all);
  });

  it('Enter inserts the first match ("faq" → the FAQ template) and clears the box; Esc clears', () => {
    const insert = vi.fn();
    mount(builderModel(insert));
    type('faq');
    key(input(), 'Enter');
    expect(insert).toHaveBeenCalledWith(templateName('faq'), snapshot);
    expect(input().value).toBe('');
    type('head');
    key(input(), 'Escape');
    expect(input().value).toBe('');
    // Nothing matches: Enter does nothing.
    type('zzz');
    key(input(), 'Enter');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('`/` and Ctrl/Cmd+K focus the box from the canvas, but not while typing in a text field', () => {
    mount(builderModel());
    const canvas = document.createElement('div');
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    canvas.focus();
    const e = key(canvas, '/');
    expect(document.activeElement).toBe(input());
    expect(e.defaultPrevented).toBe(true);
    canvas.focus();
    key(canvas, 'k', { ctrlKey: true });
    expect(document.activeElement).toBe(input());
    canvas.focus();
    key(canvas, 'k', { metaKey: true });
    expect(document.activeElement).toBe(input());
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    const typed = key(field, '/');
    expect(document.activeElement).toBe(field);
    expect(typed.defaultPrevented).toBe(false);
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    area.focus();
    key(area, 'k', { ctrlKey: true });
    expect(document.activeElement).toBe(area);
  });

  it('isTextField: inputs, textareas, selects and contenteditable; not checkboxes or plain elements', () => {
    const el = (html: string) => {
      const d = document.createElement('div');
      d.innerHTML = html;
      document.body.appendChild(d);
      return d.firstElementChild!;
    };
    expect(isTextField(el('<input type="text">'))).toBe(true);
    expect(isTextField(el('<textarea></textarea>'))).toBe(true);
    expect(isTextField(el('<div contenteditable="true"><span>x</span></div>').firstElementChild)).toBe(true);
    expect(isTextField(el('<input type="checkbox">'))).toBe(false);
    expect(isTextField(el('<button>x</button>'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('inserts at the end of the selected container, else of the root; the new item is selected from a fresh snapshot', () => {
    puck.data = {
      root: { props: {} },
      content: [
        { type: 'Stack', props: { id: 'root-1', children: [{ type: 'Box', props: { id: 'box-1', children: [{ type: 'Text', props: { id: 'text-1' } }] } }, { type: 'Heading', props: { id: 'h-1' } }] } },
      ],
    };
    const data = puck.data as Data;
    // Selected container: its end.
    expect(paletteInsertTarget(data, 'box-1', 'Image', false)).toEqual({ zone: 'box-1:children', index: 1 });
    // Selected leaf: the end of the container holding it.
    expect(paletteInsertTarget(data, 'h-1', 'Image', false)).toEqual({ zone: 'root-1:children', index: 2 });
    // Nothing selected: the end of the root.
    expect(paletteInsertTarget(data, null, 'Image', false)).toEqual({ zone: 'root-1:children', index: 2 });
    // A container that refuses the element: the nearest one that takes it.
    puck.data.content[0]!.props.children = [{ type: 'Dropdown', props: { id: 'dd-1', children: [] } }];
    expect(paletteInsertTarget(puck.data as Data, 'dd-1', templateName('nav-menu'), false)).toEqual({ zone: 'root-1:children', index: 1 });
    expect(paletteInsertTarget(puck.data as Data, 'dd-1', 'Button', false)).toEqual({ zone: 'dd-1:children', index: 0 });
    // A root that is not a container: next to it at the top level.
    expect(paletteInsertTarget({ root: { props: {} }, content: [{ type: 'Heading', props: { id: 'h' } }] }, null, 'Text', false)).toEqual({ zone: 'root:default-zone', index: 1 });

    puck.selectedId = 'dd-1';
    const id = insertAndSelect(snapshot, 'Button', paletteInsertTarget(puck.data as Data, 'dd-1', 'Button', false));
    expect(puck.actions[0]).toMatchObject({ type: 'insert', componentType: 'Button', destinationZone: 'dd-1:children', destinationIndex: 0, id });
    expect(puck.actions[1]).toEqual({ type: 'setUi', ui: { itemSelector: { zone: 'dd-1:children', index: 0 } } });
  });

  it('the palette model inserts through Puck (Enter on "faq" adds the template item at the end of the root)', () => {
    puck.data = { root: { props: {} }, content: [{ type: 'Stack', props: { id: 'root-1', children: [] } }] };
    const cats = paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false });
    mount(blockBuilderPalette(cats, false));
    type('faq');
    key(input(), 'Enter');
    expect(puck.actions.find((a) => a.type === 'insert')).toMatchObject({ componentType: templateName('faq'), destinationZone: 'root-1:children', destinationIndex: 0 });
    expect(puck.actions.find((a) => (a.ui as { itemSelector?: unknown } | undefined)?.itemSelector)).toEqual({ type: 'setUi', ui: { itemSelector: { zone: 'root-1:children', index: 0 } } });
  });
});

describe('Page builder block list search', () => {
  const card = (name: string, label: Record<string, string>): ComposedBlockSpec =>
    ({ id: `blk_${name.toLowerCase()}000000`, name, version: 1, label, category: 'marketing', fields: {}, tree: { el: 'Box' } }) as unknown as ComposedBlockSpec;
  const registry = defineBlocks([
    defineComposedBlock(card('Hero', { 'en-US': 'Hero banner', 'vi-VN': 'Ảnh bìa lớn' })),
    defineComposedBlock(card('Faq', { 'en-US': 'Questions', 'vi-VN': 'Câu hỏi' })),
    defineComposedBlock(card('Footer', { 'en-US': 'Footer', 'vi-VN': 'Chân trang' })),
  ]);
  const config = {
    components: { Hero: { label: 'Ảnh bìa lớn' }, Faq: { label: 'Câu hỏi' }, Footer: { label: 'Chân trang' } },
    categories: { marketing: { title: 'Tiếp thị', components: ['Hero', 'Faq', 'Footer'] }, other: { visible: false } },
  };

  it('filters blocks by translated or English label; Enter adds the first match at the end of the page', () => {
    puck.data = { root: { props: {} }, content: [{ type: 'Footer', props: { id: 'Footer-1' } }] };
    mount(pageBuilderPalette(config as never, registry));
    type('anh');
    expect(shown()).toEqual(['Hero']);
    type('questions');
    expect(shown()).toEqual(['Faq']);
    type('cau hoi');
    expect(shown()).toEqual(['Faq']);
    key(input(), 'Enter');
    expect(puck.actions.find((a) => a.type === 'insert')).toMatchObject({ componentType: 'Faq', destinationZone: 'root:default-zone', destinationIndex: 1 });
    expect(puck.actions.find((a) => (a.ui as { itemSelector?: unknown } | undefined)?.itemSelector)).toEqual({ type: 'setUi', ui: { itemSelector: { zone: 'root:default-zone', index: 1 } } });
    type('zzz');
    expect(container.querySelector('[data-palette-empty]')).not.toBeNull();
  });
});
