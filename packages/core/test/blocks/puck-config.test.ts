import * as fs from 'node:fs';
import * as path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  PUCK_FORMAT_VERSION,
  SPACING_TOKENS,
  b,
  defineBlock,
  defineBlocks,
  toPuckConfig,
  type CustomFieldRenderers,
} from '../../blocks/src';

const dummy = (kind: string) => (() => createElement('span', null, kind)) as any;
const customFields: CustomFieldRenderers = {
  link: dummy('link'),
  image: dummy('image'),
  entry: dummy('entry'),
  entries: dummy('entries'),
};

const Hero = defineBlock({
  name: 'Hero',
  label: { 'en-US': 'Hero', 'vi-VN': 'Ảnh bìa' },
  category: 'marketing',
  fields: {
    heading: b.text({ label: { 'en-US': 'Heading', 'fr-FR': 'Titre' }, default: 'Hello' }),
    body: b.longText(),
    rich: b.richText(),
    count: b.number({ default: 3, min: 1, max: 9 }),
    show: b.boolean({ default: true }),
    columns: b.select({ options: [2, 3, 4], default: 3 }),
    align: b.radio({ options: [{ value: 'left', label: { 'en-US': 'Left', 'vi-VN': 'Trái' } }, 'right'] }),
    bg: b.color({ default: 'muted' }),
    pad: b.spacing(),
    cta: b.link(),
    image: b.image(),
    product: b.entry('product', { displayField: 'name' }),
    products: b.entries('product', { limit: 12, sortable: true }),
    features: b.list({ title: b.text({ default: 'Feature' }), on: b.boolean() }, { max: 6 }),
    children: b.slot({ allow: ['Heading'], max: 2 }),
  },
  render: ({ heading, children }) => createElement('section', null, createElement('h1', null, heading), children),
});
const Heading = defineBlock({ name: 'Heading', label: 'Heading', category: 'basic', fields: { text: b.text() }, render: ({ text }) => text });
const Spacer = defineBlock({ name: 'Spacer', label: 'Spacer', category: 'layout', fields: {}, render: () => null });
const registry = defineBlocks([Hero, Heading, Spacer]);

describe('toPuckConfig', () => {
  const vi = toPuckConfig(registry, { locale: 'vi-VN', customFields });
  const fr = toPuckConfig(registry, { locale: 'fr-FR', customFields });
  const hero = vi.components.Hero as any;

  it('picks labels by locale with en-US fallback', () => {
    expect(hero.label).toBe('Ảnh bìa');
    expect((fr.components.Hero as any).label).toBe('Hero');
    expect(hero.fields.heading.label).toBe('Heading');
    expect((fr.components.Hero as any).fields.heading.label).toBe('Titre');
    expect(hero.fields.align.options).toEqual([
      { label: 'Trái', value: 'left' },
      { label: 'right', value: 'right' },
    ]);
  });

  it('groups components into categories in definition order', () => {
    expect(vi.categories).toEqual({
      marketing: { title: 'marketing', components: ['Hero'] },
      basic: { title: 'basic', components: ['Heading'] },
      layout: { title: 'layout', components: ['Spacer'] },
    });
  });

  it('maps every field kind to a Puck field', () => {
    const f = hero.fields;
    expect(f.heading.type).toBe('text');
    expect(f.body.type).toBe('textarea');
    expect(f.rich.type).toBe('richtext');
    expect(f.count).toMatchObject({ type: 'number', min: 1, max: 9 });
    expect(f.show.type).toBe('radio');
    expect(f.show.options.map((o: any) => o.value)).toEqual([true, false]);
    expect(f.columns).toMatchObject({ type: 'select', options: [{ label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }] });
    expect(f.bg.type).toBe('select');
    expect(f.bg.options.map((o: any) => o.value)).toEqual([...COLOR_TOKENS]);
    expect(f.pad.options.map((o: any) => o.value)).toEqual([...SPACING_TOKENS]);
    expect(f.features.type).toBe('array');
    expect(f.features.max).toBe(6);
    expect(f.features.arrayFields.title.type).toBe('text');
    expect(f.features.defaultItemProps).toEqual({ title: 'Feature', on: false });
  });

  it('maps b.slot to a native Puck slot field', () => {
    expect(hero.fields.children).toMatchObject({ type: 'slot', allow: ['Heading'] });
  });

  it('maps data fields to custom fields rendered by customFields, carrying the block field', () => {
    for (const k of ['cta', 'image', 'product', 'products'] as const) expect(hero.fields[k].type).toBe('custom');
    expect(hero.fields.products.render).toBe(customFields.entries);
    expect(hero.fields.product.render).toBe(customFields.entry);
    expect(hero.fields.cta.render).toBe(customFields.link);
    expect(hero.fields.image.render).toBe(customFields.image);
    expect(hero.fields.products.metadata.blockField).toMatchObject({ kind: 'entries', apiId: 'product', limit: 12, sortable: true });
  });

  it('puts defaults in defaultProps', () => {
    expect(hero.defaultProps).toEqual({
      heading: 'Hello',
      body: '',
      rich: '',
      count: 3,
      show: true,
      columns: 3,
      align: 'left',
      bg: 'muted',
      cta: null,
      image: null,
      product: null,
      products: { mode: 'pick', ids: [] },
      features: [],
      children: [],
    });
  });

  it('renders the block, turning slot components into nodes', () => {
    const Slot = () => createElement('i', null, 'slot');
    const html = renderToStaticMarkup(
      createElement(hero.render, { id: 'Hero-1', heading: 'Hi', children: Slot, puck: { isEditing: false } }),
    );
    expect(html).toBe('<section><h1>Hi</h1><i>slot</i></section>');
  });

  it('PUCK_FORMAT_VERSION is the minor of the installed Puck', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../node_modules/@puckeditor/core/package.json'), 'utf8'),
    );
    expect(pkg.version).toBe('0.24.1');
    expect(PUCK_FORMAT_VERSION).toBe(Number(pkg.version.split('.')[1]));
    const core = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    expect(core.dependencies['@puckeditor/core']).toBe(pkg.version);
  });
});
