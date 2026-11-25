// @vitest-environment happy-dom
// Base pages in the page builder: root fields (base choice, region modes), save payload, structure rules, overlay
// name warnings and the base publish confirm.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUCK_FORMAT_VERSION, coreBlocks, defineBlocks, defineComposedBlock, type ComposedBlockSpec, type PuckData } from '@opencloudcms/core/blocks';
import {
  BASE_DEFAULT,
  BASE_NONE,
  BasePublishDialog,
  OverlayWarning,
  baseRegionNames,
  layoutBlockNames,
  layoutToRootProps,
  overlayNameIssues,
  pageRootResolveFields,
  rootPropsToLayout,
  structureViolation,
} from '../../admin/src/page-editor/base-fields';
import { buildEditorConfig } from '../../admin/src/page-editor/editor-config';
import { fromEditorData, toEditorData, walkItems } from '../../admin/src/page-editor/field-logic';
import { overlayNameEntries } from '../../admin/src/block-builder/ActionField';

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
const frame = defineComposedBlock(
  spec({
    id: 'blk_frame01',
    name: 'SiteFrame',
    tree: {
      el: 'Stack',
      children: [{ el: 'Region', props: { name: 'header', label: 'Header' } }, { el: 'PageContent' }, { el: 'Region', props: { name: 'footer' } }],
    },
  }),
);
const modal = defineComposedBlock(spec({ id: 'blk_modal01', name: 'LienHe', tree: { el: 'Overlay', children: [{ el: 'Text', props: { text: 'Hi' } }] } }));
const registry = defineBlocks([...coreBlocks, frame, modal]);
const BASE_ID = '11111111-1111-4111-8111-111111111111';

const heading = (text: string, id = text) => ({ type: 'Heading', props: { id, _v: 1, text, level: 1, align: 'left' } });
const stored = (content: unknown[]) => ({ format: 'puck' as const, formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content } });
const baseContent = () =>
  stored([{ type: 'SiteFrame', props: { id: 'f1', _v: 1, region__header: [heading('Base header')], pageContent: [], region__footer: [] } }]);

const renderers = {
  customFields: { entry: () => null as never, entries: () => null as never, link: () => null as never, image: () => null as never },
  token: () => null as never,
  contentType: () => null as never,
  unknown: () => null as never,
  wrapRender: (_name: string, render: unknown) => render as never,
};

describe('layout ⇄ root props', () => {
  it('maps null / no base / a base with region modes both ways', () => {
    expect(layoutToRootProps(null)).toEqual({ basePage: BASE_DEFAULT });
    expect(layoutToRootProps({ baseId: null })).toEqual({ basePage: BASE_NONE });
    expect(layoutToRootProps({ baseId: BASE_ID, regions: { header: 'replace', footer: 'hide' } })).toEqual({
      basePage: BASE_ID,
      regionMode__header: 'replace',
      regionMode__footer: 'hide',
    });
    expect(rootPropsToLayout({ basePage: BASE_DEFAULT, regionMode__header: 'replace' })).toBeNull();
    expect(rootPropsToLayout({})).toBeNull();
    expect(rootPropsToLayout({ basePage: BASE_NONE })).toEqual({ baseId: null });
    expect(rootPropsToLayout({ basePage: BASE_ID, regionMode__header: 'default' })).toEqual({ baseId: BASE_ID });
    expect(rootPropsToLayout({ basePage: BASE_ID, regionMode__header: 'replace', regionMode__footer: 'hide' })).toEqual({
      baseId: BASE_ID,
      regions: { header: 'replace', footer: 'hide' },
    });
  });
  it('lists layout blocks and the regions of a base page (null when its root is not one layout block)', () => {
    expect(layoutBlockNames(registry)).toEqual(['SiteFrame']);
    expect(baseRegionNames(baseContent(), registry)).toEqual(['header', 'footer']);
    expect(baseRegionNames(stored([heading('x')]), registry)).toBeNull();
    expect(baseRegionNames(null, registry)).toBeNull();
  });
});

describe('page root fields', () => {
  const config = buildEditorConfig(registry, { locale: 'en-US', ...renderers, kind: 'page', bases: [{ documentId: BASE_ID, title: 'Main', isDefault: true }] }, []);
  const fields = config.root!.fields as Record<string, { type: string; options?: { label: string; value: unknown }[] }>;

  it('adds a Base page select: Default (name), each base, None; static region slots for the layout regions', () => {
    expect(fields.basePage!.type).toBe('select');
    expect(fields.basePage!.options).toEqual([
      { label: 'Default (Main)', value: BASE_DEFAULT },
      { label: 'Main', value: BASE_ID },
      { label: 'None', value: BASE_NONE },
    ]);
    expect(fields.region__header).toMatchObject({ type: 'slot', disallow: ['SiteFrame'] });
    expect(fields.path).toBeDefined();
  });

  it('radio "Replace" on a region adds the region__<name> slot field; other modes do not', async () => {
    const resolve = pageRootResolveFields({ regionsOf: async (id) => (id === BASE_ID ? ['header', 'footer'] : null), registry });
    const props = { basePage: BASE_ID, regionMode__header: 'replace' };
    const out = (await resolve({ props } as never, { fields } as never)) as Record<string, { type: string; label?: string; metadata?: { options: { value: string }[] } }>;
    // One radio group per region (Default / Replace for this page / Hide; unset shows as Default).
    expect(out.regionMode__header).toMatchObject({ type: 'custom', label: 'Region: Header' });
    expect(out.regionMode__header!.metadata!.options.map((o) => o.value)).toEqual(['default', 'replace', 'hide']);
    expect(out.regionMode__footer).toMatchObject({ type: 'custom' });
    expect(out.region__header).toMatchObject({ type: 'slot' });
    expect(out.region__footer).toBeUndefined();
    expect(out.title).toBeDefined();

    const def = (await resolve({ props: { basePage: BASE_DEFAULT } } as never, { fields } as never)) as Record<string, unknown>;
    expect(Object.keys(def).some((k) => k.startsWith('region'))).toBe(false);
  });

  it('base pages: title only, the root accepts layout blocks only, layout blocks are in the drawer', () => {
    const base = buildEditorConfig(registry, { locale: 'en-US', ...renderers, kind: 'base' }, []);
    expect(Object.keys(base.root!.fields!)).toEqual(['title']);
    const drawer = Object.values(base.categories ?? {}).filter((c) => c.visible !== false).flatMap((c) => c.components ?? []);
    expect(drawer).toContain('SiteFrame');
    const page = Object.values(config.categories ?? {}).filter((c) => c.visible !== false).flatMap((c) => c.components ?? []);
    expect(page).not.toContain('SiteFrame');
    expect(page).toContain('Heading');
  });
});

describe('save payload', () => {
  it('writes layout { baseId, regions:{header:"replace"} } with the region blocks in the root props', () => {
    const data = toEditorData({ title: 'A', path: '/a', layout: null }, { root: { props: {} }, content: [] } as unknown as PuckData);
    expect(data.root.props).toMatchObject({ basePage: BASE_DEFAULT });
    Object.assign(data.root.props as object, {
      basePage: BASE_ID,
      regionMode__header: 'replace',
      region__header: [{ type: 'Heading', props: { id: 'h1', text: 'Mine', level: 2, align: 'left', junk: 1 } }],
      region__footer: [],
    });
    const body = fromEditorData(data, registry);
    expect(body.layout).toEqual({ baseId: BASE_ID, regions: { header: 'replace' } });
    const root = body.content.data.root.props as Record<string, unknown>;
    expect(root).not.toHaveProperty('basePage');
    expect(root).not.toHaveProperty('regionMode__header');
    expect(root).not.toHaveProperty('region__footer');
    expect(root.region__header).toEqual([{ type: 'Heading', props: { id: 'h1', text: 'Mine', level: 2, align: 'left', _v: 1 } }]);
  });
  it('keeps region blocks when the region is no longer replaced (switching back restores them)', () => {
    const data = toEditorData(
      { title: 'A', path: '/a', layout: { baseId: BASE_ID, regions: { header: 'replace' } } },
      { root: { props: { region__header: [heading('Mine')] } }, content: [] } as unknown as PuckData,
    );
    expect(data.root.props).toMatchObject({ regionMode__header: 'replace' });
    (data.root.props as Record<string, unknown>).regionMode__header = 'default';
    const body = fromEditorData(data, registry);
    expect(body.layout).toEqual({ baseId: BASE_ID });
    expect((body.content.data.root.props as Record<string, unknown>).region__header).toHaveLength(1);
  });
  it('base pages save title and content only (no path, SEO or layout)', () => {
    const data = toEditorData({ title: 'Frame', path: null, layout: null }, baseContent().data as unknown as PuckData, 'base');
    expect(data.root.props).toEqual({ title: 'Frame' });
    const body = fromEditorData(data, registry, null, 'base');
    expect(Object.keys(body).sort()).toEqual(['content', 'title']);
  });
  it('walks replaced region blocks too (unknown blocks, slot limits, preview resolution)', () => {
    const seen: string[] = [];
    walkItems({ root: { props: { region__header: [heading('R')] } }, content: [heading('C')] } as unknown as PuckData, registry, (it) => seen.push(String(it.props.id)));
    expect(seen).toEqual(['C', 'R']);
  });
});

describe('structure rules', () => {
  const data = (content: unknown[], rootProps: Record<string, unknown> = {}) => ({ root: { props: rootProps }, content }) as unknown as PuckData;
  const frameItem = (id: string) => ({ type: 'SiteFrame', props: { id, region__header: [], pageContent: [], region__footer: [] } });

  it('base page: a second root block is rejected; a layout block inside a region too', () => {
    expect(structureViolation('base', data([frameItem('a')]), registry)).toBeNull();
    expect(structureViolation('base', data([frameItem('a'), frameItem('b')]), registry)).toBe('pageEditor.base.oneLayout');
    expect(structureViolation('base', data([frameItem('a'), heading('x')]), registry)).toBe('pageEditor.base.oneLayout');
    expect(structureViolation('base', data([heading('x')]), registry)).toBe('pageEditor.base.layoutOnly');
    const nested = frameItem('a');
    nested.props.region__header = [frameItem('b')] as never;
    expect(structureViolation('base', data([nested]), registry)).toBe('pageEditor.layoutMisplaced');
  });
  it('page: no layout block anywhere, also not in a replaced region', () => {
    expect(structureViolation('page', data([heading('x')]), registry)).toBeNull();
    expect(structureViolation('page', data([frameItem('a')]), registry)).toBe('pageEditor.layoutMisplaced');
    expect(structureViolation('page', data([], { region__header: [frameItem('a')] }), registry)).toBe('pageEditor.layoutMisplaced');
  });
});

describe('overlay names', () => {
  const overlay = (id: string, name?: string) => ({ type: 'LienHe', props: { id, ...(name === undefined ? {} : { name }) } });

  it('lists every overlay placement (default name when unset), with replaced regions of the root', () => {
    const page = {
      root: { props: { regionMode__header: 'replace', region__header: [overlay('a', 'menu')], region__footer: [overlay('z', 'ignored')] } },
      content: [overlay('b'), overlay('c', 'Bad Name')],
    };
    expect(overlayNameEntries(page, registry)).toEqual([
      { name: 'lien-he', valid: true },
      { name: 'Bad Name', valid: false },
      { name: 'menu', valid: true },
    ]);
  });

  it('finds duplicates across base and page and invalid names', () => {
    expect(overlayNameIssues([{ name: 'lien-he', valid: true }], [{ name: 'menu', valid: true }])).toBeNull();
    expect(
      overlayNameIssues(
        [
          { name: 'lien-he', valid: true },
          { name: 'Bad Name', valid: false },
        ],
        [{ name: 'lien-he', valid: true }],
      ),
    ).toEqual({ duplicates: ['lien-he'], invalid: ['Bad Name'] });
  });
});

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

describe('editor UI', () => {
  it('shows a (non-blocking) warning banner for duplicate overlay names', () => {
    act(() => root.render(createElement(OverlayWarning, { issues: { duplicates: ['lien-he'], invalid: [] } })));
    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain('lien-he');
    expect(banner?.textContent).toContain('more than once');
    act(() => root.render(createElement(OverlayWarning, { issues: null })));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('base publish confirm shows "Used by N pages" from the usage endpoint', async () => {
    const onConfirm = vi.fn();
    const usage = vi.fn(async () => ({ count: 3, pages: [] }));
    await act(async () => {
      root.render(createElement(BasePublishDialog, { documentId: BASE_ID, open: true, loadUsage: usage, onOpenChange: () => {}, onConfirm }));
    });
    expect(usage).toHaveBeenCalledWith(BASE_ID);
    expect(document.body.textContent).toContain('Used by 3 pages');
    const publish = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Publish');
    act(() => publish!.click());
    expect(onConfirm).toHaveBeenCalled();
  });
});
