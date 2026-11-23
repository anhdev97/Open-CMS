import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { blockManifest, defineBlocks, resolvePage, toPuckConfig, writePageContent, type CustomFieldRenderers } from '../../blocks/src';
import { coreBlocks } from '../../blocks/src/library';

const NAMES = [
  'Section', 'Columns', 'Grid', 'Spacer', 'Divider', 'Heading', 'Text', 'Image', 'Button', 'ButtonGroup',
  'Card', 'Badge', 'Hero', 'FeatureList', 'CallToAction', 'FAQ', 'EntryList',
];
const LOCALES = ['en-US', 'vi-VN', 'fr-FR', 'id-ID'] as const;
const registry = defineBlocks(coreBlocks);
const dummy = () => (() => createElement('span')) as any;
const customFields: CustomFieldRenderers = { link: dummy(), image: dummy(), entry: dummy(), entries: dummy() };

const defaults = (name: string) => (toPuckConfig(registry, { locale: 'en-US', customFields }).components[name] as any).defaultProps;
const html = (name: string, props: Record<string, unknown> = {}) =>
  renderToString(registry.get(name)!.render({ ...defaults(name), ...props } as never) as any);

describe('coreBlocks', () => {
  it('defines exactly the expected blocks and passes defineBlocks', () => {
    expect(coreBlocks.map((x) => x.name)).toEqual(NAMES);
    expect(blockManifest(registry).map((m) => m.name)).toEqual(NAMES);
  });

  it('labels every block and select option in all four locales', () => {
    for (const def of coreBlocks) {
      expect(typeof def.label, def.name).toBe('object');
      for (const l of LOCALES) expect((def.label as Record<string, string>)[l], `${def.name} ${l}`).toBeTruthy();
      for (const [k, f] of Object.entries(def.fields)) {
        if ('label' in f && f.label) for (const l of LOCALES) expect((f.label as Record<string, string>)[l], `${def.name}.${k} ${l}`).toBeTruthy();
      }
    }
  });

  it.each(NAMES)('%s renders with default props without throwing or touching window', (name) => {
    expect(typeof window).toBe('undefined');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(() => html(name)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('Heading level 2 renders an h2', () => {
    expect(html('Heading', { level: 2, text: 'Hi' })).toContain('<h2');
    expect(html('Heading', { level: 4, text: 'Hi' })).toContain('<h4');
  });

  it('Section with a muted background has bg-muted', () => {
    expect(html('Section', { background: 'muted' })).toContain('bg-muted');
  });

  it('Button without a resolved href renders a span, with one an anchor', () => {
    const none = html('Button', { label: 'Go', link: { href: null } });
    expect(none).toContain('<span');
    expect(none).not.toContain('<a');
    expect(html('Button', { label: 'Go', link: { href: '/x' } })).toContain('<a');
  });

  it('Columns and Grid use literal grid classes', () => {
    expect(html('Columns', { columns: 3 })).toContain('md:grid-cols-3');
    expect(html('Grid', { columns: 4 })).toContain('lg:grid-cols-4');
  });

  it('Text renders rich text nodes and treats plain strings as text', () => {
    expect(html('Text', { content: '<b>x</b>' })).toContain('&lt;b&gt;');
    expect(html('Text', { content: createElement('p', null, 'rich') })).toContain('<p>rich</p>');
  });

  it('Image renders nothing without a source and an img with one', () => {
    expect(html('Image')).not.toContain('<img');
    expect(html('Image', { image: { src: '/a.png', alt: 'A' } })).toContain('<img');
  });

  it('FAQ renders details elements', () => {
    expect(html('FAQ', { items: [{ question: 'Q?', answer: 'A.' }] })).toContain('<details');
  });

  it('EntryList without an apiId renders nothing', () => {
    expect(html('EntryList')).toBe('');
  });

  it('EntryList renders list, grid and table layouts of resolved entries', () => {
    const source = [{ documentId: '1', title: 'One', price: 5 }, { documentId: '2', title: 'Two', price: 6 }];
    const base = { apiId: 'product', source, fields: ['title', 'price'] };
    expect(html('EntryList', { ...base, layout: 'list' })).toContain('<ul');
    expect(html('EntryList', { ...base, layout: 'grid' })).toContain('grid-cols-');
    const table = html('EntryList', { ...base, layout: 'table' });
    expect(table).toContain('<table');
    expect(table).toContain('One');
  });

  it('EntryList resolves its source from the apiId prop', async () => {
    const fetcher = {
      byIds: vi.fn(async () => []),
      query: vi.fn(async () => [{ documentId: '1', title: 'One' }]),
      pagePaths: vi.fn(async () => ({})),
    };
    const content = writePageContent(
      { root: { props: {} }, content: [{ type: 'EntryList', props: { id: 'a', apiId: 'product', source: { mode: 'query', limit: 3 }, fields: ['title'] } }] } as never,
      registry,
    );
    const data = await resolvePage(content, registry, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
    expect(fetcher.query).toHaveBeenCalledWith('product', { filter: undefined, sort: undefined, limit: 3 }, 'en-US');
    expect((data.content[0].props as any).source).toEqual([{ documentId: '1', title: 'One' }]);
    const none = writePageContent({ root: { props: {} }, content: [{ type: 'EntryList', props: { id: 'b' } }] } as never, registry);
    fetcher.query.mockClear();
    await resolvePage(none, registry, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
    expect(fetcher.query).not.toHaveBeenCalled();
  });
});
