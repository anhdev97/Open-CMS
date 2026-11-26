// @vitest-environment happy-dom
// The base frame drawn around the page content in the page editor, and overlay blocks on the editor canvas.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PUCK_FORMAT_VERSION,
  blockRenderProps,
  coreBlocks,
  defineBlocks,
  defineComposedBlock,
  type ComposedBlockSpec,
  type ContentFetcher,
} from '@opencloudcms/core/blocks';
import { Puck } from '@puckeditor/core';
import { BaseFrame, OverlayChip, loadBaseFrame, prefixItemIds } from '../../admin/src/page-editor/BaseFrame';
import { buildEditorConfig } from '../../admin/src/page-editor/editor-config';
import { toEditorData } from '../../admin/src/page-editor/field-logic';
import { BaseContext, type BaseState } from '../../admin/src/page-editor/editor-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spec = (over: Partial<ComposedBlockSpec>): ComposedBlockSpec => ({
  id: 'blk_test01',
  name: 'TestBlock',
  label: { 'en-US': 'Test block' },
  category: 'layout',
  version: 1,
  fields: {},
  tree: { el: 'Box' },
  ...over,
});
const frameBlock = defineComposedBlock(
  spec({
    id: 'blk_frame01',
    name: 'SiteFrame',
    tree: {
      el: 'Stack',
      children: [{ el: 'Region', props: { name: 'header' } }, { el: 'PageContent' }, { el: 'Region', props: { name: 'footer' } }],
    },
  }),
);
const modal = defineComposedBlock(
  spec({ id: 'blk_modal01', name: 'LienHe', tree: { el: 'Overlay', props: { variant: 'drawer' }, children: [{ el: 'Text', props: { text: 'Inside overlay' } }] } }),
);
const registry = defineBlocks([...coreBlocks, frameBlock, modal]);
const BASE_ID = '11111111-1111-4111-8111-111111111111';

const heading = (text: string, id = text) => ({ type: 'Heading', props: { id, _v: 1, text, level: 1, align: 'left' } });
const stored = (content: unknown[]) => ({ format: 'puck' as const, formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content } });
const baseContent = () =>
  stored([
    {
      type: 'SiteFrame',
      props: { id: 'f1', _v: 1, region__header: [heading('Base header', 'h1')], pageContent: [], region__footer: [heading('Base footer', 'h2')] },
    },
  ]);
const fetcher: ContentFetcher = { byIds: async () => [], query: async () => [], pagePaths: async () => ({}) };

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('prefixItemIds', () => {
  it('prefixes the ids of every item, also in slots, without touching the input', () => {
    const input = [{ type: 'SiteFrame', props: { id: 'f1', region__header: [heading('x', 'h1')] } }];
    const out = prefixItemIds(input, 'base-');
    expect(out[0]!.props.id).toBe('base-f1');
    expect((out[0]!.props.region__header as { props: { id: string } }[])[0]!.props.id).toBe('base-h1');
    expect(input[0]!.props.id).toBe('f1');
  });
});

describe('blockRenderProps (frame props built like the Puck render)', () => {
  it('renders slot components, keeps slot elements, drops raw arrays and adds the reserved props', () => {
    const el = createElement('i', null, 'x');
    const Comp = () => createElement('b');
    const out = blockRenderProps(frameBlock, { id: 'f', region__header: el, region__footer: Comp, pageContent: [], _locale: 'vi-VN', _editor: true }, 'en-US');
    expect(out.region__header).toBe(el);
    expect((out.region__footer as { type: unknown }).type).toBe(Comp);
    expect(out.pageContent).toBeNull();
    expect(out).toMatchObject({ _locale: 'vi-VN', _editor: true });
  });
});

describe('loadBaseFrame', () => {
  it('composes the base like the website (all regions default) and resolves it; ids are made unique', async () => {
    const r = await loadBaseFrame(baseContent(), registry, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
    expect(r.status).toBe('ok');
    expect(r.frame!.type).toBe('SiteFrame');
    expect(r.frame!.props.id).toBe('base-f1');
    expect((r.frame!.props.region__header as { props: { id: string } }[])[0]!.props.id).toBe('base-h1');
    expect(r.regions).toEqual(['header', 'footer']);
  });
  it('is invalid when the base root is not one layout block', async () => {
    const r = await loadBaseFrame(stored([heading('x')]), registry, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
    expect(r.status).toBe('invalid');
  });
});

async function state(): Promise<BaseState> {
  const r = await loadBaseFrame(baseContent(), registry, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
  return { kind: 'page', registry, locale: 'en-US', key: BASE_ID, status: r.status, frame: r.frame, regions: r.regions };
}

const draw = (value: BaseState, props: Record<string, unknown>, children: ReactNode) =>
  act(() => root.render(createElement(BaseContext.Provider, { value }, createElement(BaseFrame, { ...props, children }))));

describe('BaseFrame', () => {
  it('renders default regions read-only and dimmed, hidden regions as a marker, page content in the middle', async () => {
    draw(await state(), { basePage: BASE_ID, regionMode__footer: 'hide' }, createElement('p', { id: 'page-body' }, 'Page body'));
    const dimmed = container.querySelector('.pointer-events-none.opacity-60');
    expect(dimmed?.textContent).toContain('Base header');
    expect(dimmed?.getAttribute('data-base-region')).toBe('header');
    expect(container.textContent).not.toContain('Base footer');
    expect(container.querySelector('[data-base-region-hidden="footer"]')?.textContent).toContain('footer');
    const text = container.textContent!;
    expect(text.indexOf('Base header')).toBeLessThan(text.indexOf('Page body'));
  });

  it('renders a replaced region as the root slot field', async () => {
    const Slot = () => createElement('div', { 'data-slot-zone': 'header' }, 'My header');
    draw(await state(), { basePage: BASE_ID, regionMode__header: 'replace', region__header: Slot }, 'body');
    expect(container.querySelector('[data-slot-zone="header"]')?.textContent).toBe('My header');
    expect(container.textContent).not.toContain('Base header');
    expect(container.textContent).toContain('Base footer');
  });

  it('frames with the default base when the layout has region modes but no baseId', async () => {
    const value = { ...(await state()), key: 'default' };
    const Slot = () => createElement('div', { 'data-slot-zone': 'header' }, 'My header');
    draw(value, { basePage: '__default', regionMode__header: 'replace', region__header: Slot }, 'body');
    expect(container.querySelector('[data-slot-zone="header"]')?.textContent).toBe('My header');
    expect(container.textContent).toContain('Base footer');
  });

  it('renders the page alone when there is no base page', async () => {
    draw(await state(), { basePage: '__none' }, createElement('p', null, 'Only page'));
    expect(container.textContent).toBe('Only page');
  });

  it('renders the page alone with a warning badge when the base cannot be used', () => {
    draw({ kind: 'page', registry, locale: 'en-US', key: BASE_ID, status: 'invalid', frame: null, regions: [] }, { basePage: BASE_ID }, createElement('p', null, 'Body'));
    expect(container.textContent).toContain('Body');
    expect(container.querySelector('[data-base-warning]')).not.toBeNull();
  });
});

describe('OverlayChip', () => {
  it('shows "Overlay: <name> (Drawer)" and previews the content inline on demand', () => {
    const render = () => createElement('dialog', { 'data-ocms-overlay': 'lien-he' }, 'Inside overlay');
    act(() => root.render(createElement(OverlayChip, { def: modal, props: { id: 'o1' }, render })));
    expect(container.textContent).toContain('Overlay: lien-he (Drawer)');
    expect(container.querySelector('dialog')).toBeNull();
    const preview = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Preview')!;
    act(() => preview.click());
    const dialog = container.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toBe('Inside overlay');
  });
});

describe('in the Puck editor', () => {
  const opts = {
    locale: 'en-US' as const,
    customFields: {} as never,
    token: () => null as never,
    contentType: () => null as never,
    unknown: () => null as never,
    wrapRender: (_n: string, r: never) => r,
  };
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));

  it('page: the base frame around the page, the replaced region editable, region modes in the root fields', async () => {
    const config = buildEditorConfig(registry, { ...opts, kind: 'page', bases: [], regionsOf: async () => ['header', 'footer'], baseFrame: BaseFrame }, []);
    const data = toEditorData(
      { title: 'T', path: '/t', layout: { baseId: BASE_ID, regions: { header: 'replace', footer: 'hide' } } },
      { root: { props: { region__header: [heading('Mine', 'm1')] } }, content: [heading('Body', 'b1')] } as never,
    );
    const value = await state();
    await act(async () => {
      root.render(createElement(BaseContext.Provider, { value }, createElement(Puck as never, { config, data, iframe: { enabled: false } })));
    });
    await settle();
    const text = document.body.textContent!;
    expect(text).toContain('Mine');
    expect(text).toContain('Body');
    expect(text).toContain('Hidden: footer');
    expect(text).not.toContain('Base header');
    expect(text).toContain('Region: header');
    expect(text).toContain('Replace for this page');
  });

  it('base page: the layout block with its regions and a page content placeholder', async () => {
    const config = buildEditorConfig(registry, { ...opts, kind: 'base' }, []);
    const data = toEditorData({ title: 'Frame' }, baseContent().data as never, 'base');
    await act(async () => {
      root.render(createElement(Puck as never, { config, data, iframe: { enabled: false } }));
    });
    await settle();
    const text = document.body.textContent!;
    expect(text).toContain('Base header');
    expect(container.querySelector('[data-page-content-placeholder]')).not.toBeNull();
  });
});
