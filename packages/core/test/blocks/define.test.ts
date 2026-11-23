import { describe, expect, it } from 'vitest';
import { b, blockManifest, defineBlock, defineBlocks } from '../../blocks/src';

const ok = (name: string, extra: Record<string, unknown> = {}) =>
  defineBlock({ name, label: name, category: 'basic', fields: { title: b.text() }, render: () => null, ...extra } as any);

describe('defineBlocks', () => {
  it('accepts valid blocks and exposes them by name', () => {
    const r = defineBlocks([ok('Hero'), ok('ProductGrid', { version: 3 })]);
    expect(r.list.map((d) => d.name)).toEqual(['Hero', 'ProductGrid']);
    expect(r.get('Hero')?.name).toBe('Hero');
    expect(r.get('Nope')).toBeUndefined();
  });

  it('rejects duplicate names', () => {
    expect(() => defineBlocks([ok('Hero'), ok('Hero')])).toThrow(/Hero.*duplicate|duplicate.*Hero/i);
  });

  it('rejects names that are not PascalCase', () => {
    expect(() => defineBlocks([ok('productGrid')])).toThrow(/productGrid.*PascalCase/);
    expect(() => defineBlocks([ok('Product-Grid')])).toThrow(/Product-Grid/);
  });

  it('rejects a select default that is not one of its options, naming block and field', () => {
    const bad = defineBlock({
      name: 'ProductGrid',
      label: 'Grid',
      category: 'commerce',
      fields: { columns: b.select({ options: [2, 3], default: 5 as 2 }) },
      render: () => null,
    });
    expect(() => defineBlocks([bad])).toThrow(/ProductGrid.*columns|columns.*ProductGrid/);
  });

  it('rejects defaults of the wrong type and invalid tokens', () => {
    const mk = (fields: Record<string, unknown>) =>
      defineBlocks([{ name: 'Box', label: 'Box', category: 'layout', fields, render: () => null } as any]);
    expect(() => mk({ heading: b.text({ default: 3 as any }) })).toThrow(/Box.*heading/);
    expect(() => mk({ n: b.number({ default: 'x' as any }) })).toThrow(/Box.*n\b/);
    expect(() => mk({ on: b.boolean({ default: 'yes' as any }) })).toThrow(/Box.*on/);
    expect(() => mk({ bg: b.color({ default: 'hotpink' as any }) })).toThrow(/Box.*bg.*hotpink/);
    expect(() => mk({ pad: b.spacing({ default: '5' as any }) })).toThrow(/Box.*pad/);
    expect(() => mk({ items: b.list({ title: b.text({ default: 1 as any }) }) })).toThrow(/Box.*items\.title/);
    expect(() => mk({ products: b.entries('') })).toThrow(/Box.*products/);
    expect(() => mk({ x: { kind: 'weird' } })).toThrow(/Box.*x.*weird/);
  });

  it('rejects reserved prop names, bad labels, versions and migrations', () => {
    expect(() => defineBlocks([ok('A', { fields: { id: b.text() } })])).toThrow(/A.*id.*reserved/);
    expect(() => defineBlocks([ok('A', { fields: { _v: b.text() } })])).toThrow(/A.*_v/);
    expect(() => defineBlocks([ok('A', { label: { 'vi-VN': 'x' } })])).toThrow(/A.*label/);
    expect(() => defineBlocks([ok('A', { category: '' })])).toThrow(/A.*category/);
    expect(() => defineBlocks([ok('A', { version: 0 })])).toThrow(/A.*version/);
    expect(() => defineBlocks([ok('A', { version: 2, migrate: [{ from: 2, up: (p: any) => p }] })])).toThrow(/A.*migrate/);
    expect(() => defineBlocks([ok('A', { render: undefined })])).toThrow(/A.*render/);
  });

  it('accepts every field builder', () => {
    const all = defineBlock({
      name: 'Everything',
      label: { 'en-US': 'Everything', 'vi-VN': 'Mọi thứ' },
      category: 'basic',
      icon: 'box',
      version: 2,
      migrate: [{ from: 1, up: (p) => p }],
      fields: {
        a: b.text({ default: 'x' }),
        b: b.longText(),
        c: b.richText(),
        d: b.number({ default: 2, min: 0 }),
        e: b.boolean({ default: true }),
        f: b.select({ options: ['s', 'm'], default: 'm' }),
        g: b.radio({ options: [{ value: 'l', label: 'Left' }, { value: 'r', label: 'Right' }], default: 'r' }),
        h: b.link(),
        i: b.image(),
        j: b.color({ default: 'primary' }),
        k: b.spacing({ default: '8' }),
        l: b.entry('product', { displayField: 'name' }),
        m: b.entries('product', { limit: 12, sortable: true, filterable: true }),
        n: b.list({ q: b.text(), body: b.slot() }, { max: 5 }),
        o: b.slot({ allow: ['Heading'], max: 3 }),
      },
      render: () => null,
    });
    expect(() => defineBlocks([all])).not.toThrow();
  });
});

describe('blockManifest', () => {
  it('lists name and version (default 1) of every block', () => {
    const r = defineBlocks([ok('Hero'), ok('ProductGrid', { version: 3 })]);
    expect(blockManifest(r)).toEqual([
      { name: 'Hero', version: 1 },
      { name: 'ProductGrid', version: 3 },
    ]);
  });
});
