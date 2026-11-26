import { composedFieldNameIssue, composedKind, validateComposedSpec } from '@opencloudcms/schema';
import { describe, expect, it } from 'vitest';
import type { ComposedBlockSpec } from '@opencloudcms/schema';
import {
  ENTRY_PROP_KINDS as CLIENT_KINDS,
  bindingResetNotes,
  breakingNotes,
  buildSpec,
  changeSummary,
  emptySpec,
  fieldUsage,
  filterValueKind,
  filterableFields,
  initialSaveState,
  newBlockId,
  saveReducer,
  showCurrencyFor,
  sortableFields,
  sourceOptions,
  suggestFieldName,
  suggestName,
} from '../../admin/src/block-builder/logic';
import { canvasFieldValues, placeholderEntry, sampleQuery } from '../../admin/src/block-builder/sample-data';
import { STYLE_SECTIONS, buildBuilderConfig, paletteCategories } from '../../admin/src/block-builder/element-config';
import { enUS } from '../../admin/src/i18n/messages/en-US';
import { migrateLegacyProps } from '../../admin/src/block-builder/style/migrate';
import { DEVICE_VIEWPORTS, breakpointForWidth } from '../../admin/src/block-builder/style/breakpoint';
import { shownTracks } from '../../admin/src/block-builder/style/puck-fields';
import { canvasStyle, frameAttrs } from '../../admin/src/block-builder/Canvas';
import { ApiError } from '../../admin/src/lib/api-error';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';
import { ENTRY_PROP_KINDS as SERVER_KINDS } from '../../src/block-builder/blocks-checks';

const field = (name: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`,
  name,
  kind: 'text',
  required: false,
  localizable: false,
  indexed: false,
  unique: false,
  options: {},
  ...extra,
});

const product: ContentTypeDefinition = {
  id: 'ct_product',
  apiId: 'product',
  displayName: { 'en-US': 'Product' },
  fields: [
    field('name', { indexed: true, label: 'Name' }),
    field('slug', { kind: 'slug', unique: true }),
    field('email', { kind: 'email' }),
    field('summary', { kind: 'longText' }),
    field('body', { kind: 'richText' }),
    field('price', { kind: 'money', options: { currencyMode: 'fixed', currency: 'EUR' } }),
    field('marketPrice', { kind: 'money', options: { currencyMode: 'market' } }),
    field('stock', { kind: 'number', indexed: true }),
    field('active', { kind: 'boolean', indexed: true }),
    field('released', { kind: 'date' }),
    field('cover', { kind: 'asset', options: { multiple: false } }),
    field('gallery', { kind: 'asset', options: { multiple: true } }),
    field('site', { kind: 'url' }),
    field('brand', { kind: 'reference', indexed: true, options: { target: 'brand' } }),
    field('tags', { kind: 'text', indexed: true, options: { multiple: true } }),
    field('cats', { kind: 'taxonomy', indexed: true, options: { taxonomy: 'c' } }),
  ],
};

const names = (o: { name: string }[]) => o.map((x) => x.name);

describe('sourceOptions (spec §5.4)', () => {
  const ctx = (over: Partial<Parameters<typeof sourceOptions>[1]> = {}) => ({ type: product, fields: {}, urlPattern: undefined, ...over });

  it('offers only kind-compatible content fields, never multiple or reference fields (but Image may show a multiple asset)', () => {
    expect(names(sourceOptions({ el: 'Heading', prop: 'text' }, ctx()).entry)).toEqual(['name', 'slug', 'email', 'summary']);
    expect(names(sourceOptions({ el: 'Text', prop: 'html' }, ctx()).entry)).toEqual(['body']);
    expect(names(sourceOptions({ el: 'Image', prop: 'src' }, ctx()).entry)).toEqual(['cover', 'gallery', 'site']);
    expect(names(sourceOptions({ el: 'Image', prop: 'alt' }, ctx()).entry)).toEqual(['name', 'slug', 'email', 'summary', 'cover', 'gallery']);
    expect(names(sourceOptions({ el: 'Price', prop: 'value' }, ctx()).entry)).toEqual(['price', 'marketPrice', 'stock']);
    expect(names(sourceOptions({ el: 'Date', prop: 'value' }, ctx()).entry)).toEqual(['released', 'createdAt', 'updatedAt', 'publishedAt']);
    expect(names(sourceOptions({ el: 'Button', prop: 'href' }, ctx()).entry)).toEqual(['site']);
    for (const [el, props] of Object.entries(CLIENT_KINDS)) {
      for (const prop of Object.keys(props!)) {
        const offered = names(sourceOptions({ el: el as never, prop }, ctx()).entry);
        if (el !== 'Image') expect(offered).not.toContain('gallery');
        expect(offered).not.toContain('brand');
        expect(offered).not.toContain('tags');
        expect(offered).not.toContain('cats');
      }
    }
  });

  it('no content fields without a binding; entryUrl only for href with a urlPattern; manual fields by kind', () => {
    const fields = { title: { kind: 'text' as const }, link: { kind: 'link' as const }, pic: { kind: 'image' as const }, n: { kind: 'number' as const } };
    expect(sourceOptions({ el: 'Heading', prop: 'text' }, ctx({ type: null, fields })).entry).toEqual([]);
    expect(sourceOptions({ el: 'Heading', prop: 'text' }, ctx({ fields })).manual).toEqual(['title']);
    expect(sourceOptions({ el: 'Button', prop: 'href' }, ctx({ fields })).manual).toEqual(['link']);
    expect(sourceOptions({ el: 'Image', prop: 'src' }, ctx({ fields })).manual).toEqual(['pic']);
    expect(sourceOptions({ el: 'Price', prop: 'value' }, ctx({ fields })).manual).toEqual(['n']);
    expect(sourceOptions({ el: 'Button', prop: 'href' }, ctx()).entryUrl).toBe(false);
    expect(sourceOptions({ el: 'Button', prop: 'href' }, ctx({ urlPattern: '/p/{slug}' })).entryUrl).toBe(true);
    expect(sourceOptions({ el: 'Button', prop: 'label' }, ctx({ urlPattern: '/p/{slug}' })).entryUrl).toBe(false);
    expect(sourceOptions({ el: 'Button', prop: 'href' }, ctx({ type: null, urlPattern: '/p/{slug}' })).entryUrl).toBe(false);
  });

  it('mirrors the server kind table', () => {
    expect(CLIENT_KINDS).toEqual(SERVER_KINDS);
  });
});

describe('filterable / sortable fields', () => {
  it('filters: only indexed/unique single-value fields', () => {
    expect(names(filterableFields(product))).toEqual(['name', 'slug', 'stock', 'active']);
  });
  it('sort: the filterable fields plus the timestamps', () => {
    expect(sortableFields(product)).toEqual(['name', 'slug', 'stock', 'active', 'createdAt', 'updatedAt', 'publishedAt']);
  });
  it('filter value editor by kind', () => {
    expect(filterValueKind(field('a', { kind: 'boolean' }))).toBe('boolean');
    expect(filterValueKind(field('a', { kind: 'number' }))).toBe('number');
    expect(filterValueKind(field('a', { kind: 'money' }))).toBe('number');
    expect(filterValueKind(field('a', { kind: 'slug' }))).toBe('string');
  });
});

describe('names and ids', () => {
  it('suggests a PascalCase name from the en-US label', () => {
    expect(suggestName({ 'vi-VN': 'Thẻ sản phẩm', 'en-US': 'Product card' })).toBe('ProductCard');
    expect(suggestName({ 'en-US': '  café  déjà-vu 2 ' })).toBe('CafeDejaVu2');
    expect(suggestName({ 'en-US': '3 columns' })).toBe('Block3Columns');
    expect(suggestName({ 'en-US': '' })).toBe('');
    expect(suggestName({ 'en-US': 'x'.repeat(80) })).toHaveLength(64);
  });
  it('suggests a free camelCase manual field name', () => {
    expect(suggestFieldName('Button label', {})).toBe('buttonLabel');
    expect(suggestFieldName('Button label', { buttonLabel: { kind: 'text' } })).toBe('buttonLabel2');
    expect(suggestFieldName('', {})).toBe('field');
    expect(suggestFieldName('Entry', {})).toBe('entry2');
  });
  it('never suggests a reserved or generated field name', () => {
    expect(suggestFieldName('Id', {})).toBe('id2');
    expect(suggestFieldName('Edit mode', {})).toBe('editMode2');
    expect(suggestFieldName('Puck', {})).toBe('puck2');
    expect(suggestFieldName('Layout', {})).toBe('layout2');
    expect(suggestFieldName('Constructor', {})).toBe('constructor2');
    expect(suggestFieldName('Slot', {})).toBe('slotField');
    expect(suggestFieldName('Slot', { slotField: { kind: 'text' } })).toBe('slotField2');
    for (const label of ['ID', 'Id', 'Edit mode', 'Puck', 'Slot', 'Slot 2', 'Entries', 'V', '_v', 'To string', '__proto__']) {
      const name = suggestFieldName(label, {});
      expect(composedFieldNameIssue(name), `${label} → ${name}`).toBeNull();
    }
  });
  it('new ids match the spec pattern', () => {
    expect(newBlockId()).toMatch(/^blk_[a-z0-9]{6,}$/);
  });
  it('the overlay starting template is a valid overlay block', () => {
    const o = { ...emptySpec('blk_abcdef1', 'overlay'), name: 'Menu', label: { 'en-US': 'Menu' } };
    expect(o.tree.el).toBe('Overlay');
    expect(o.tree.props).toEqual({ variant: 'modal', size: 'md', closeOnBackdrop: true, showClose: true });
    expect(validateComposedSpec(o)).toEqual([]);
    expect(composedKind(o)).toBe('overlay');
  });
  it('emptySpec is a valid starting point', () => {
    const s = emptySpec('blk_abcdef');
    expect(s).toMatchObject({ id: 'blk_abcdef', name: '', version: 1, fields: {}, tree: { el: 'Card' } });
  });
});

describe('Price currency from the bound money field', () => {
  it('fixed → true, market → false, other kinds → undefined', () => {
    expect(showCurrencyFor(product.fields.find((f) => f.name === 'price')!)).toBe(true);
    expect(showCurrencyFor(product.fields.find((f) => f.name === 'marketPrice')!)).toBe(false);
    expect(showCurrencyFor(field('m', { kind: 'money' }))).toBe(false);
    expect(showCurrencyFor(product.fields.find((f) => f.name === 'stock')!)).toBeUndefined();
  });
});

describe('save flow', () => {
  it('409 block_in_use → confirm with the page count; confirm → resend with confirmBreaking', () => {
    let s = saveReducer(initialSaveState, { type: 'save' });
    expect(s).toEqual({ status: 'saving', confirmBreaking: false });
    s = saveReducer(s, { type: 'failed', error: new ApiError(409, 'block_in_use', 'in use', [{ path: ['ProductCard'], message: '3' }]) });
    expect(s).toEqual({ status: 'confirm', pages: 3 });
    s = saveReducer(s, { type: 'confirm' });
    expect(s).toEqual({ status: 'saving', confirmBreaking: true });
    s = saveReducer(s, { type: 'saved', files: ['a.ts'] });
    expect(s).toEqual({ status: 'saved', files: ['a.ts'] });
  });
  it('cancel from confirm → idle; other errors → error; confirm outside confirm is ignored', () => {
    const confirm = { status: 'confirm', pages: 1 } as const;
    expect(saveReducer(confirm, { type: 'cancel' })).toEqual(initialSaveState);
    const e = new ApiError(422, 'invalid_block', 'bad');
    expect(saveReducer({ status: 'saving', confirmBreaking: false }, { type: 'failed', error: e })).toEqual({ status: 'error', error: e });
    expect(saveReducer(initialSaveState, { type: 'confirm' })).toBe(initialSaveState);
  });
});

const spec = (over: Partial<ComposedBlockSpec> = {}): ComposedBlockSpec => ({
  id: 'blk_abcdef',
  name: 'ProductCard',
  label: { 'en-US': 'Product card' },
  category: 'commerce',
  version: 1,
  binding: { apiId: 'product', mode: 'single' },
  fields: { cta: { kind: 'text' }, tone: { kind: 'select', options: ['a', 'b'] } },
  tree: { el: 'Card' },
  ...over,
});

describe('change summary and breaking notes', () => {
  it('new block → created', () => {
    expect(changeSummary(null, spec())).toEqual([{ key: 'created' }]);
  });
  it('lists label, field, binding and tree changes', () => {
    const next = spec({
      label: { 'en-US': 'Card' },
      fields: { tone: { kind: 'select', options: ['a'] }, extra: { kind: 'number' } },
      binding: { apiId: 'product', mode: 'collection' },
      tree: { el: 'Box' },
    });
    expect(changeSummary(spec(), next)).toEqual([
      { key: 'label' },
      { key: 'fieldAdded', name: 'extra' },
      { key: 'fieldRemoved', name: 'cta' },
      { key: 'fieldChanged', name: 'tone' },
      { key: 'binding' },
      { key: 'design' },
    ]);
    expect(changeSummary(spec(), spec())).toEqual([]);
  });
  it('breaking notes name removed/changed fields and binding changes', () => {
    const next = spec({ fields: { tone: { kind: 'select', options: ['a'] } }, binding: { apiId: 'brand', mode: 'single' } });
    expect(breakingNotes(spec(), next)).toEqual([
      { key: 'fieldRemoved', name: 'cta' },
      { key: 'optionRemoved', name: 'tone' },
      { key: 'binding' },
    ]);
    expect(breakingNotes(null, next)).toEqual([]);
  });
  it('a kind change (block ↔ layout ↔ overlay) and a region change are breaking notes', () => {
    const block = { ...spec(), fields: {}, tree: { el: 'Stack', children: [{ el: 'Heading' }] } } as ComposedBlockSpec;
    const layout = { ...block, tree: { el: 'Stack', children: [{ el: 'Region', props: { name: 'header' } }, { el: 'PageContent' }] } } as ComposedBlockSpec;
    const overlay = { ...block, tree: { el: 'Overlay', children: [{ el: 'Heading' }] } } as ComposedBlockSpec;
    expect(breakingNotes(block, layout)).toEqual([{ key: 'kind', from: 'block', to: 'layout' }]);
    expect(breakingNotes(block, overlay)).toEqual([{ key: 'kind', from: 'block', to: 'overlay' }]);
    const renamed = { ...layout, tree: { el: 'Stack', children: [{ el: 'Region', props: { name: 'top' } }, { el: 'PageContent' }] } } as ComposedBlockSpec;
    expect(breakingNotes(layout, renamed)).toEqual([{ key: 'regions' }]);
    expect(enUS.blockBuilder.changes.kind).toContain('{from}');
    expect(enUS.blockBuilder.changes.kind).toContain('{to}');
    expect(enUS.blockBuilder.changes.regions).toBeTruthy();
  });
  it('removing or moving a Slot is a breaking note', () => {
    const prev = { ...spec(), tree: { el: 'Stack', children: [{ el: 'Slot' }, { el: 'Slot' }] } } as ComposedBlockSpec;
    const next = { ...prev, tree: { el: 'Stack', children: [{ el: 'Slot' }] } } as ComposedBlockSpec;
    expect(breakingNotes(prev, next)).toEqual([{ key: 'slots' }]);
    expect(breakingNotes(prev, { ...prev, tree: { el: 'Stack', children: [{ el: 'Slot' }, { el: 'Slot' }, { el: 'Slot' }] } } as ComposedBlockSpec)).toEqual([]);
  });
});

describe('sample data', () => {
  it('collection query uses the fixed filter, sort and limit (capped for the canvas)', () => {
    expect(
      sampleQuery({ apiId: 'product', mode: 'collection', filter: [{ field: 'active', value: true }, { field: 'stock', value: 3 }], sort: { field: 'createdAt', direction: 'desc' }, limit: 8 }),
    ).toEqual({ limit: 8, sort: 'createdAt:desc', filter: { active: 'true', stock: '3' } });
    expect(sampleQuery({ apiId: 'product', mode: 'collection' })).toEqual({ limit: 12, filter: {} });
    expect(sampleQuery({ apiId: 'product', mode: 'collection', limit: 100 }).limit).toBe(12);
  });
  it('single query lists entries to pick from', () => {
    expect(sampleQuery({ apiId: 'product', mode: 'single' })).toEqual({ limit: 20, filter: {} });
  });
  it('placeholder entry has a value per usable field, shaped like the content API', () => {
    const e = placeholderEntry(product, 'en-US');
    expect(e.name).toBe('Name');
    expect(e.price).toEqual({ amount: 1234.5, currency: 'EUR' });
    expect(e.marketPrice).toEqual({ amount: 1234.5, currency: 'USD' });
    expect(e.stock).toBe(42);
    expect(e.active).toBe(true);
    expect(e.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof e.createdAt).toBe('string');
    expect(e.documentId).toBe('sample');
    expect(e.cover).toBeNull();
  });
  it('manual field values for the canvas: defaults, else a value that shows', () => {
    expect(
      canvasFieldValues({
        a: { kind: 'text', default: 'Buy' },
        b: { kind: 'text', label: { 'en-US': 'Button label', 'vi-VN': 'Nhãn' } },
        c: { kind: 'number' },
        d: { kind: 'select', options: ['x', 'y'] },
        e: { kind: 'boolean' },
        f: { kind: 'image' },
        g: { kind: 'link' },
      }, 'vi-VN'),
    ).toEqual({ a: 'Buy', b: 'Nhãn', c: 0, d: 'x', e: true, f: null, g: { href: '#' } });
  });
});

describe('buildSpec', () => {
  it('drops empty labels/icon and every binding key the mode does not use', () => {
    const s = buildSpec(
      {
        id: 'blk_abcdef',
        name: 'ProductCard',
        label: { 'en-US': 'Card', 'vi-VN': '', 'fr-FR': 'Carte' },
        category: 'data',
        icon: '',
        version: 2,
        fields: {},
        binding: {
          apiId: 'product',
          mode: 'single',
          urlPattern: ' ',
          filter: [{ field: 'active', value: true }],
          limit: 4,
          layout: { kind: 'grid', columns: 3 },
          options: { editorSort: true },
        },
      },
      { el: 'Card' },
    );
    expect(s).toEqual({
      id: 'blk_abcdef',
      name: 'ProductCard',
      label: { 'en-US': 'Card', 'fr-FR': 'Carte' },
      category: 'data',
      version: 2,
      fields: {},
      binding: { apiId: 'product', mode: 'single' },
      tree: { el: 'Card' },
    });
  });
  it('collection keeps filter/sort/limit/layout, only true switches and a non-empty empty text', () => {
    const s = buildSpec(
      {
        id: 'blk_abcdef',
        name: 'List',
        label: { 'en-US': 'List' },
        category: 'data',
        version: 1,
        fields: {},
        binding: {
          apiId: 'product',
          mode: 'collection',
          urlPattern: '/p/{slug}',
          filter: [],
          sort: { field: 'createdAt', direction: 'desc' },
          limit: 8,
          layout: { kind: 'list', columns: 3 },
          options: { editorSort: true, editorLimit: false, emptyText: { 'en-US': '', 'vi-VN': 'Trống' } },
        },
      },
      { el: 'Card' },
    );
    expect(s.binding).toEqual({
      apiId: 'product',
      mode: 'collection',
      urlPattern: '/p/{slug}',
      sort: { field: 'createdAt', direction: 'desc' },
      limit: 8,
      layout: { kind: 'list' },
      options: { editorSort: true },
    });
  });
});

describe('fieldUsage', () => {
  it('counts elements that bind or show-if a manual field', () => {
    const tree = {
      el: 'Card',
      showIf: { from: 'field', name: 'cta', is: 'present' },
      children: [
        { el: 'Button', bind: { label: { from: 'field', name: 'cta' }, href: { from: 'field', name: 'link' } } },
        { el: 'Heading', bind: { text: { from: 'entry', path: 'cta' } } },
      ],
    } as never;
    expect(fieldUsage(tree, 'cta')).toBe(2);
    expect(fieldUsage(tree, 'link')).toBe(1);
    expect(fieldUsage(tree, 'other')).toBe(0);
  });
});

describe('bindingResetNotes', () => {
  const tree = {
    el: 'Card',
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Button', bind: { href: { from: 'entryUrl' } }, showIf: { from: 'entry', path: 'slug', is: 'present' } },
      { el: 'Text', bind: { text: { from: 'const', value: 'x' } }, showIf: { from: 'entry', path: 'slug', is: 'present' } },
    ],
  } as never;
  it('nothing to lose: no binding, or only apiId/mode and no entry binds', () => {
    expect(bindingResetNotes(undefined, { el: 'Box' })).toEqual([]);
    expect(bindingResetNotes({ apiId: 'product', mode: 'collection' }, { el: 'Box' })).toEqual([]);
  });
  it('lists the binding settings and the elements reading the entry', () => {
    expect(
      bindingResetNotes(
        {
          apiId: 'product',
          mode: 'collection',
          urlPattern: '/p/{slug}',
          filter: [{ field: 'active', value: true }, { field: 'stock', value: 1 }],
          sort: { field: 'createdAt', direction: 'desc' },
          limit: 8,
          layout: { kind: 'list' },
          options: { editorSort: true, emptyText: { 'en-US': 'None' } },
        },
        tree,
      ),
    ).toEqual([
      { key: 'filters', count: 2 },
      { key: 'sort' },
      { key: 'limit' },
      { key: 'layout' },
      { key: 'editorOptions' },
      { key: 'emptyText' },
      { key: 'urlPattern' },
      { key: 'entryElements', count: 3 },
    ]);
  });
  it('empty filter list, false switches and empty texts are not losses', () => {
    expect(bindingResetNotes({ apiId: 'p', mode: 'single', filter: [], urlPattern: ' ', options: { editorSort: false, emptyText: { 'en-US': '' } } }, { el: 'Box' })).toEqual([]);
  });
});

describe('legacy props → style (spec decision 2)', () => {
  it('Box padding → top/bottom, Card padding → all sides; background stays a prop', () => {
    expect(migrateLegacyProps('Box', { padding: '8' }, undefined)).toEqual({ props: {}, style: { padding: { t: '8', b: '8' } } });
    expect(migrateLegacyProps('Card', { padding: '4', background: 'muted', bordered: false }, undefined)).toEqual({
      props: { background: 'muted', bordered: false },
      style: { padding: { t: '4', r: '4', b: '4', l: '4' } },
    });
    expect(migrateLegacyProps('Box', { background: 'primary' }, undefined)).toEqual({ props: { background: 'primary' }, style: undefined });
  });

  it('an existing style padding wins; the old prop is still dropped', () => {
    const style = { padding: { md: { t: '37px' } }, radius: 'md' };
    expect(migrateLegacyProps('Box', { padding: '8' }, style)).toEqual({ props: {}, style });
  });

  it('Columns count → tracks (1 column on mobile; count 4 is 2 then 4, like COLS[4])', () => {
    expect(migrateLegacyProps('Columns', { count: 3, gap: '4' }, undefined)).toEqual({
      props: { gap: '4', tracks: { base: ['1fr'], md: ['1fr', '1fr', '1fr'] } },
      style: undefined,
    });
    expect(migrateLegacyProps('Columns', { count: 2 }, undefined).props).toEqual({ tracks: { base: ['1fr'], md: ['1fr', '1fr'] } });
    expect(migrateLegacyProps('Columns', { count: 4 }, undefined).props).toEqual({
      tracks: { base: ['1fr'], md: ['1fr', '1fr'], lg: ['1fr', '1fr', '1fr', '1fr'] },
    });
    const tracks = { base: ['2fr', '1fr'] };
    expect(migrateLegacyProps('Columns', { count: 3, tracks }, undefined).props).toEqual({ tracks });
  });

  it('leaves other elements and migrated nodes as they are', () => {
    expect(migrateLegacyProps('Stack', { direction: 'vertical', gap: '4' }, undefined)).toEqual({ props: { direction: 'vertical', gap: '4' }, style: undefined });
    expect(migrateLegacyProps('Text', { padding: '8' }, undefined).props).toEqual({ padding: '8' });
  });
});

describe('style sections per element (spec table)', () => {
  it('containers get spacing, size and colors; text gets margin, max width and text color', () => {
    expect(STYLE_SECTIONS.Box).toEqual(expect.arrayContaining(['spacing', 'size', 'colors', 'visibility', 'span']));
    expect(STYLE_SECTIONS.Columns).toContain('layout');
    expect(STYLE_SECTIONS.Heading).not.toContain('spacing');
    expect(STYLE_SECTIONS.Heading).toEqual(expect.arrayContaining(['margin', 'maxWidth', 'textColor', 'visibility']));
    expect(STYLE_SECTIONS.Image).toEqual(expect.arrayContaining(['margin', 'size']));
    expect(STYLE_SECTIONS.Image).not.toContain('colors');
    expect(STYLE_SECTIONS.Divider).not.toContain('size');
    for (const [el, sections] of Object.entries(STYLE_SECTIONS)) {
      // AccordionItem / TabPanel are laid out by their Accordion / Tabs: no style of their own.
      if (!['Region', 'PageContent', 'Overlay', 'AccordionItem', 'TabPanel'].includes(el)) expect(sections).toContain('span');
    }
  });
  it('Region and PageContent have no style; the Overlay frame gets spacing, size and colors (no visibility or span)', () => {
    expect(STYLE_SECTIONS.Region).toEqual([]);
    expect(STYLE_SECTIONS.PageContent).toEqual([]);
    expect(STYLE_SECTIONS.Overlay).toEqual(['spacing', 'size', 'colors']);
  });
});

describe('builder Puck config and the style system', () => {
  const stub = (() => null) as never;
  const config = buildBuilderConfig({
    collection: false, token: stub, sources: stub, showIf: stub, allow: stub, tracks: stub, style: stub, responsiveSelect: stub, length: stub,
    render: () => stub, root: stub,
  });
  type Comp = {
    fields: Record<string, unknown>;
    defaultProps: Record<string, unknown>;
    resolveData: (d: { props: Record<string, unknown> }, p: { lastData: null; trigger: string }) => { props: Record<string, unknown> };
    resolveFields: (d: { props: Record<string, unknown> }, p: { fields: Record<string, unknown> }) => Record<string, unknown>;
  };
  const comp = (el: string) => config.components[el] as unknown as Comp;

  it('one style field per element; new layout fields; Box/Card padding and background move into the style panel', () => {
    for (const el of Object.keys(config.components)) {
      if (['Region', 'PageContent', 'AccordionItem', 'TabPanel'].includes(el)) expect(comp(el).fields).not.toHaveProperty('style');
      else expect(comp(el).fields).toHaveProperty('style');
    }
    expect(Object.keys(comp('Columns').fields)).toEqual(expect.arrayContaining(['tracks', 'alignY', 'gapX', 'gapY']));
    expect(Object.keys(comp('Stack').fields)).toEqual(expect.arrayContaining(['justify', 'wrap']));
    expect(Object.keys(comp('Image').fields)).toEqual(expect.arrayContaining(['fit', 'aspect']));
    expect(comp('Box').fields).not.toHaveProperty('padding');
    expect(comp('Box').fields).not.toHaveProperty('background');
    expect(comp('Columns').defaultProps).toEqual({ tracks: { base: ['1fr'], md: ['1fr', '1fr'] } });
  });

  it('count is shown only while a node still has it', () => {
    const c = comp('Columns');
    expect(c.resolveFields({ props: { count: 3 } }, { fields: c.fields })).toHaveProperty('count');
    expect(c.resolveFields({ props: {} }, { fields: c.fields })).not.toHaveProperty('count');
  });

  it('the first change of an item migrates its old props; loading does not', () => {
    const box = comp('Box');
    expect(box.resolveData({ props: { id: 'b', padding: '8' } }, { lastData: null, trigger: 'load' }).props).toEqual({ id: 'b', padding: '8' });
    const out = box.resolveData({ props: { id: 'b', padding: '8', background: 'muted' } }, { lastData: null, trigger: 'replace' }).props;
    expect(out).toEqual({ id: 'b', padding: undefined, background: 'muted', style: { padding: { t: '8', b: '8' } } });
    const cols = comp('Columns').resolveData({ props: { id: 'c', count: 2 } }, { lastData: null, trigger: 'replace' }).props;
    expect(cols).toEqual({ id: 'c', count: undefined, tracks: { base: ['1fr'], md: ['1fr', '1fr'] } });
  });
});

describe('device breakpoints and canvas fidelity', () => {
  it('breakpointForWidth: < 768 is Mobile, < 1024 Tablet, else Desktop', () => {
    expect(breakpointForWidth(375)).toBe('base');
    expect(breakpointForWidth(767)).toBe('base');
    expect(breakpointForWidth(768)).toBe('md');
    expect(breakpointForWidth(1023)).toBe('md');
    expect(breakpointForWidth(1024)).toBe('lg');
    expect(breakpointForWidth(1280)).toBe('lg');
    expect(DEVICE_VIEWPORTS.map((v) => v.width)).toEqual([375, 768, 1280]);
  });

  it('canvasStyle puts margin, width and maxWidth on the item frame; the element fills it', () => {
    const out = canvasStyle({ margin: { l: 'auto' }, width: { base: '50%', md: 'auto' }, maxWidth: '600px', padding: { t: '4' }, span: 2 }, 'base');
    expect(out.frame).toEqual({ margin: { l: 'auto' }, width: { base: '50%', md: 'auto' }, maxWidth: '600px', span: 2 });
    expect(out.inner).toEqual({ padding: { t: '4' }, width: { base: '100%', md: 'auto' } });
    expect(out.hidden).toBe(false);
    const attrs = frameAttrs(out.frame);
    expect(attrs.className).toContain('ml-(--ocms-ml)');
    expect(attrs.style).toMatchObject({ '--ocms-ml': 'auto', '--ocms-w': '50%', '--ocms-maxw': '600px' });
    expect(canvasStyle(undefined, 'base')).toEqual({ frame: undefined, inner: undefined, hidden: false });
  });

  it('an element hidden at the edited breakpoint is kept (dimmed), never display:none, in the canvas', () => {
    const style = { hidden: { md: true }, padding: { t: '4' } };
    expect(canvasStyle(style, 'md')).toEqual({ frame: undefined, inner: { padding: { t: '4' } }, hidden: true });
    expect(canvasStyle(style, 'base').hidden).toBe(false);
    expect(canvasStyle(style, 'lg').hidden).toBe(false);
  });

  it('a legacy Columns count shows as tracks until it is migrated', () => {
    expect(shownTracks(undefined, 3)).toEqual({ base: ['1fr'], md: ['1fr', '1fr', '1fr'] });
    expect(shownTracks(null, undefined)).toBeUndefined();
    expect(shownTracks({ base: ['2fr'] }, 3)).toEqual({ base: ['2fr'] });
  });
});

describe('layout and overlay elements in the builder', () => {
  const stub = (() => null) as never;
  const make = (collection: boolean, regionNames?: (exceptId: string) => string[]) =>
    buildBuilderConfig({
      collection, token: stub, sources: stub, showIf: stub, allow: stub, tracks: stub, style: stub, responsiveSelect: stub, length: stub,
      action: stub, pattern: stub, render: () => stub, root: stub, ...(regionNames ? { regionNames } : {}),
    });
  type Comp = {
    label: string;
    fields: Record<string, { type: string; metadata?: Record<string, unknown> }>;
    defaultProps: Record<string, unknown>;
    permissions?: { insert?: boolean };
    resolveData: (d: { props: Record<string, unknown> }, p: { lastData: { props: Record<string, unknown> } | null; trigger: string }) => { props: Record<string, unknown> };
    resolveFields: (d: { props: Record<string, unknown> }, p: { fields: Record<string, unknown> }) => Record<string, unknown>;
  };
  const config = make(false, (except) => (except === 'Region-new' ? ['region', 'region-2'] : []));
  const comp = (el: string, c = config) => c.components[el] as unknown as Comp;

  it('palette: a "Layout regions" category; Overlay only while the root is empty; regions hidden in an overlay block', () => {
    const cats = paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false });
    expect(cats.regions).toEqual({ title: 'Layout regions', components: ['Region', 'PageContent'], visible: true });
    expect(cats.overlay).toMatchObject({ components: ['Overlay'], visible: false });
    expect(cats.content!.components).not.toEqual(expect.arrayContaining(['Region']));
    expect(cats.content!.components).not.toContain('PageContent');
    expect(cats.content!.components).not.toContain('Overlay');
    expect(paletteCategories({ collection: false, overlayRoot: false, emptyRoot: true }).overlay!.visible).toBe(true);
    expect(paletteCategories({ collection: false, overlayRoot: true, emptyRoot: false }).regions!.visible).toBe(false);
    expect(config.categories).toMatchObject({ regions: { visible: true }, overlay: { visible: false } });
  });

  it('labels and defaults: Region (name region, auto-uniquified), Page content, Overlay (modal/md, backdrop and × on)', () => {
    expect(comp('Region').label).toBe('Region');
    expect(comp('PageContent').label).toBe('Page content');
    expect(comp('Overlay').label).toBe('Overlay');
    expect(comp('Region').defaultProps).toEqual({ name: 'region' });
    expect(comp('Overlay').defaultProps).toEqual({ variant: 'modal', size: 'md', closeOnBackdrop: true, showClose: true });
    const inserted = comp('Region').resolveData({ props: { id: 'Region-new', name: 'region' } }, { lastData: null, trigger: 'insert' });
    expect(inserted.props.name).toBe('region-3');
    const typed = comp('Region').resolveData({ props: { id: 'Region-new', name: 'region' } }, { lastData: { props: { name: 'regio' } }, trigger: 'replace' });
    expect(typed.props.name).toBe('region');
  });

  it('fields: Region name/label/allow; Overlay side only for a drawer; Button action; anchorId on content elements', () => {
    expect(Object.keys(comp('Region').fields)).toEqual(['name', 'label', 'allow']);
    expect(comp('Region').fields.name!.metadata).toMatchObject({ pattern: 'name' });
    expect(comp('Region').fields.label!.type).toBe('custom'); // a localized label from code is shown read-only
    expect(Object.keys(comp('PageContent').fields)).toEqual([]);
    const ov = comp('Overlay');
    expect(Object.keys(ov.fields)).toEqual(expect.arrayContaining(['variant', 'side', 'size', 'closeOnBackdrop', 'showClose', 'anchorId', 'style', 'children']));
    expect(ov.resolveFields({ props: { variant: 'modal' } }, { fields: ov.fields })).not.toHaveProperty('side');
    expect(ov.resolveFields({ props: { variant: 'drawer' } }, { fields: ov.fields })).toHaveProperty('side');
    // Switching to a drawer pins it right; back to a modal drops the side (only valid on a drawer).
    expect(ov.resolveData({ props: { id: 'o', variant: 'drawer' } }, { lastData: { props: { variant: 'modal' } }, trigger: 'replace' }).props.side).toBe('right');
    const back = ov.resolveData({ props: { id: 'o', variant: 'modal', side: 'left' } }, { lastData: { props: { variant: 'drawer' } }, trigger: 'replace' }).props;
    expect('side' in back && back.side === undefined).toBe(true);
    expect(comp('Button').fields.action!.type).toBe('custom');
    expect(comp('Heading').fields.anchorId!.metadata).toMatchObject({ pattern: 'anchor' });
    expect(comp('Box').fields).toHaveProperty('anchorId');
    for (const el of ['Region', 'PageContent', 'Slot']) expect(comp(el).fields).not.toHaveProperty('anchorId');
  });

  it('Overlay and regions never go into a slot; in a collection block Region and Page content cannot be inserted', () => {
    const slot = comp('Box').fields.children as unknown as { disallow?: string[] };
    expect(slot.disallow).toEqual(expect.arrayContaining(['Overlay']));
    expect((comp('Overlay').fields.children as unknown as { disallow: string[] }).disallow).toEqual(expect.arrayContaining(['Overlay', 'Region', 'PageContent']));
    const col = make(true);
    expect(comp('Region', col).permissions).toEqual({ insert: false });
    expect(comp('PageContent', col).permissions).toEqual({ insert: false });
    expect(comp('Region').permissions).toBeUndefined();
    expect((comp('Box', col).fields.children as unknown as { disallow: string[] }).disallow).toEqual(expect.arrayContaining(['Slot', 'Region', 'PageContent', 'Overlay']));
  });
});
