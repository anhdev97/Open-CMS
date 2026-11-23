import { describe, expect, it } from 'vitest';
import {
  composedManifestEntry, isBreakingChange, slotSignature, validateComposedSpec, withAutoVersion, type ComposedBlockSpec,
} from '../src/composed-block';

const single = (): ComposedBlockSpec => ({
  id: 'blk_abc123', name: 'ProductHero', label: { 'en-US': 'Product hero' }, category: 'Content', version: 1,
  binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' },
  fields: { cta: { kind: 'text' }, body: { kind: 'richText' } },
  tree: { el: 'Stack', children: [
    { el: 'Heading', bind: { text: { from: 'entry', path: 'title' } } },
    { el: 'Button', bind: { label: { from: 'field', name: 'cta' }, href: { from: 'entryUrl' } }, showIf: { from: 'field', name: 'cta', is: 'present' } },
  ] },
});
const collection = (): ComposedBlockSpec => ({
  ...single(), binding: { apiId: 'product', mode: 'collection', limit: 12, layout: { kind: 'grid', columns: 3 }, urlPattern: '/p/{slug}', options: { editorFilter: true } },
  tree: { el: 'Card', children: [{ el: 'Image', bind: { src: { from: 'entry', path: 'img' } } }] },
});
const unbound = (): ComposedBlockSpec => {
  const { binding, ...rest } = single();
  return { ...rest, tree: { el: 'Box', children: [{ el: 'Text', bind: { text: { from: 'const', value: 'hi' } } }, { el: 'Slot' }] } };
};
const paths = (s: unknown) => validateComposedSpec(s).map((i) => i.path.join('.'));
const mut = (base: ComposedBlockSpec, f: (s: any) => void) => { const s = structuredClone(base) as any; f(s); return s; };

describe('validateComposedSpec', () => {
  it('accepts valid specs', () => {
    expect(validateComposedSpec(single())).toEqual([]);
    expect(validateComposedSpec(collection())).toEqual([]);
    expect(validateComposedSpec(unbound())).toEqual([]);
  });
  it('rejects non-objects', () => expect(validateComposedSpec(null)).toHaveLength(1));
  it('reports each rule once with a path', () => {
    expect(paths(mut(single(), (s) => (s.id = 'x')))).toEqual(['id']);
    expect(paths(mut(single(), (s) => (s.name = 'productHero')))).toEqual(['name']);
    expect(paths(mut(single(), (s) => (s.label = { 'vi-VN': 'x' })))).toEqual(['label.en-US']);
    expect(paths(mut(single(), (s) => (s.tree.children[0].el = 'Marquee')))).toEqual(['tree.children.0.el']);
    expect(paths(mut(single(), (s) => (s.tree.children[0].bind = { color: { from: 'const', value: 1 } })))).toEqual(['tree.children.0.bind.color']);
    expect(paths(mut(single(), (s) => (s.tree.children[1].bind.label.name = 'x')))).toEqual(['tree.children.1.bind.label.name']);
    expect(paths(mut(unbound(), (s) => (s.tree.children[0].bind = { text: { from: 'entry', path: 'a' } })))).toEqual(['tree.children.0.bind.text']);
    expect(paths(mut(unbound(), (s) => (s.tree.children[0].bind = { text: { from: 'entryUrl' } })))).toEqual(['tree.children.0.bind.text']);
    expect(paths(mut(single(), (s) => delete s.binding.urlPattern))).toEqual(['tree.children.1.bind.href']);
    expect(paths(mut(collection(), (s) => s.tree.children.push({ el: 'Slot' })))).toEqual(['tree.children.1.el']);
    expect(paths(mut(single(), (s) => (s.binding.options = { editorFilter: true })))).toEqual(['binding.options.editorFilter']);
    expect(paths(mut(collection(), (s) => (s.binding.limit = 0)))).toEqual(['binding.limit']);
    expect(paths(mut(collection(), (s) => (s.binding.limit = 101)))).toEqual(['binding.limit']);
    expect(paths(mut(collection(), (s) => (s.binding.layout.columns = 7)))).toEqual(['binding.layout.columns']);
    expect(paths(mut(single(), (s) => (s.fields.cta.kind = 'video')))).toEqual(['fields.cta.kind']);
    expect(paths(mut(unbound(), (s) => (s.tree.showIf = { from: 'entry', path: 'a', is: 'present' })))).toEqual(['tree.showIf']);
  });
});

describe('select fields', () => {
  const sel = () => mut(single(), (s) => (s.fields.size = { kind: 'select', options: ['s', 'm', 'l'], default: 'm' }));
  it('validates options', () => {
    expect(validateComposedSpec(sel())).toEqual([]);
    expect(paths(mut(sel(), (s) => delete s.fields.size.options))).toEqual(['fields.size.options']);
    expect(paths(mut(sel(), (s) => (s.fields.size.options = [])))).toEqual(['fields.size.options']);
    expect(paths(mut(sel(), (s) => (s.fields.size.options = ['a', 'a'])))).toEqual(['fields.size.options']);
    expect(paths(mut(sel(), (s) => (s.fields.size.options = [true])))).toEqual(['fields.size.options']);
    expect(paths(mut(sel(), (s) => (s.fields.size.default = 'xl')))).toEqual(['fields.size.default']);
    expect(paths(mut(single(), (s) => (s.fields.cta.options = ['a'])))).toEqual(['fields.cta.options']);
  });
  it('removing an option is breaking, adding is not', () => {
    expect(isBreakingChange(sel(), mut(sel(), (s) => (s.fields.size.options = ['s', 'm'])))).toBe(true);
    expect(isBreakingChange(sel(), mut(sel(), (s) => s.fields.size.options.push('xl')))).toBe(false);
  });
});

describe('composedManifestEntry', () => {
  it('lists richText fields', () => {
    expect(composedManifestEntry(single())).toEqual({ name: 'ProductHero', version: 1, richText: ['body'] });
    expect(composedManifestEntry(unbound())).toEqual({ name: 'ProductHero', version: 1, richText: ['body'] });
    expect(composedManifestEntry(mut(single(), (s) => (s.fields = {})))).toEqual({ name: 'ProductHero', version: 1 });
  });
});

describe('isBreakingChange / withAutoVersion', () => {
  const b = single();
  it('detects breaking changes', () => {
    expect(isBreakingChange(b, mut(b, (s) => delete s.fields.cta))).toBe(true);
    expect(isBreakingChange(b, mut(b, (s) => (s.fields.cta.kind = 'number')))).toBe(true);
    expect(isBreakingChange(b, mut(b, (s) => (s.binding.mode = 'collection')))).toBe(true);
    expect(isBreakingChange(b, mut(b, (s) => (s.binding.apiId = 'post')))).toBe(true);
    expect(isBreakingChange(b, mut(b, (s) => delete s.binding))).toBe(true);
    expect(isBreakingChange(unbound(), single())).toBe(true);
  });
  it('ignores non-breaking changes', () => {
    expect(isBreakingChange(b, mut(b, (s) => (s.label = { 'en-US': 'Other' })))).toBe(false);
    expect(isBreakingChange(b, mut(b, (s) => (s.fields.extra = { kind: 'text' })))).toBe(false);
  });
  it('auto-versions', () => {
    expect(withAutoVersion(null, { ...b, version: 7 }).version).toBe(1);
    expect(withAutoVersion(b, mut(b, (s) => delete s.fields.cta)).version).toBe(2);
    expect(withAutoVersion(b, mut(b, (s) => (s.label = { 'en-US': 'Z' }))).version).toBe(1);
  });
});

describe('field names and defaults (mirror defineBlocks)', () => {
  const withField = (name: string, f: unknown = { kind: 'text' }) => mut(unbound(), (s) => (s.fields = { [name]: f }));
  it('rejects reserved, generated, prototype and non-identifier names', () => {
    for (const n of ['entry', 'entries', 'layout', 'slot', 'slot2', 'slot10', 'id', '_v', 'puck', 'editMode', '_locale', '_editor', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '1a', 'a-b', 'a b', '', 'a.b']) {
      const s = unbound();
      // JSON.parse keeps `__proto__` as an own key (as a request body would).
      (s as any).fields = JSON.parse(`{${JSON.stringify(n)}:{"kind":"text"}}`);
      expect(paths(s), n).toEqual([`fields.${n}`]);
    }
    expect(validateComposedSpec(withField('slotTitle'))).toEqual([]);
    expect(validateComposedSpec(withField('entryTitle'))).toEqual([]);
    expect(validateComposedSpec(withField('identifier'))).toEqual([]);
  });
  it('rejects defaults that do not fit the kind', () => {
    const bad: [string, unknown][] = [
      ['text', 1], ['longText', false], ['richText', {}], ['number', 'abc'], ['boolean', 'yes'], ['boolean', 0],
      ['image', 'https://x/y.png'], ['link', 'javascript:x'], ['link', ['a']], ['image', 3],
    ];
    for (const [kind, d] of bad) expect(paths(withField('f', { kind, default: d })), `${kind} ${JSON.stringify(d)}`).toEqual(['fields.f.default']);
    const good: [string, unknown][] = [
      ['text', 'a'], ['longText', ''], ['richText', '<p>x</p>'], ['number', 2.5], ['boolean', false], ['image', null], ['link', { kind: 'url', href: '/a' }],
    ];
    for (const [kind, d] of good) expect(validateComposedSpec(withField('f', { kind, default: d })), kind).toEqual([]);
  });
  it('validates labels like defineBlocks', () => {
    expect(paths(withField('f', { kind: 'text', label: 3 }))).toEqual(['fields.f.label']);
    expect(paths(withField('f', { kind: 'text', label: { 'en-US': 'A', xx: 'B' } }))).toEqual(['fields.f.label']);
    expect(validateComposedSpec(withField('f', { kind: 'text', label: 'Plain' }))).toEqual([]);
    expect(paths(mut(unbound(), (s) => (s.label = { 'en-US': 'A', 'de-DE': 'B' })))).toEqual(['label']);
    expect(paths(mut(unbound(), (s) => (s.label = { 'en-US': 'A', 'vi-VN': 1 })))).toEqual(['label']);
  });
  it('validates Slot allow and max', () => {
    expect(paths(mut(unbound(), (s) => (s.tree.children[1].props = { allow: [1] })))).toEqual(['tree.children.1.props.allow']);
    expect(paths(mut(unbound(), (s) => (s.tree.children[1].props = { allow: 'Hero' })))).toEqual(['tree.children.1.props.allow']);
    expect(paths(mut(unbound(), (s) => (s.tree.children[1].props = { max: 0 })))).toEqual(['tree.children.1.props.max']);
    expect(paths(mut(unbound(), (s) => (s.tree.children[1].props = { max: 1.5 })))).toEqual(['tree.children.1.props.max']);
    expect(validateComposedSpec(mut(unbound(), (s) => (s.tree.children[1].props = { allow: ['Hero'], max: 2 })))).toEqual([]);
  });
  it('validates the sort field and filter values', () => {
    expect(paths(mut(collection(), (s) => (s.binding.sort = { field: 'a:b', direction: 'asc' })))).toEqual(['binding.sort.field']);
    expect(paths(mut(collection(), (s) => (s.binding.filter = [{ field: 'a', value: { x: 1 } }])))).toEqual(['binding.filter.0.value']);
    expect(validateComposedSpec(mut(collection(), (s) => (s.binding.filter = [{ field: 'a', value: 1 }, { field: 'b', value: true }, { field: 'c', value: 'x' }])))).toEqual([]);
  });
});

describe('collection-only binding settings', () => {
  it('rejects filter, sort, limit and layout in single mode', () => {
    expect(paths(mut(single(), (s) => (s.binding.filter = [{ field: 'a', value: 'x' }])))).toEqual(['binding.filter']);
    expect(paths(mut(single(), (s) => (s.binding.sort = { field: 'createdAt', direction: 'asc' })))).toEqual(['binding.sort']);
    expect(paths(mut(single(), (s) => (s.binding.limit = 3)))).toEqual(['binding.limit']);
    expect(paths(mut(single(), (s) => (s.binding.layout = { kind: 'list' })))).toEqual(['binding.layout']);
  });
});

describe('slots and breaking changes', () => {
  const slotted = (): ComposedBlockSpec => ({
    ...unbound(),
    tree: { el: 'Stack', children: [{ el: 'Slot', props: { allow: ['Hero'] } }, { el: 'Box', children: [{ el: 'Slot' }] }] },
  });
  it('slotSignature lists slots in tree order by position path and allow', () => {
    expect(slotSignature(slotted().tree)).toEqual(['0|Hero', '1.0|*']);
    expect(slotSignature(mut(slotted(), (s) => (s.tree.children[0].props.allow = ['B', 'A'])).tree)).toEqual(['0|A,B', '1.0|*']);
  });
  it('removing, reordering or changing a slot is breaking; adding one at the end is not', () => {
    const p = slotted();
    expect(isBreakingChange(p, mut(p, (s) => s.tree.children.shift()))).toBe(true); // remove first slot
    expect(isBreakingChange(p, mut(p, (s) => s.tree.children.pop()))).toBe(true); // remove last slot
    expect(isBreakingChange(p, mut(p, (s) => s.tree.children.reverse()))).toBe(true); // reorder
    expect(isBreakingChange(p, mut(p, (s) => s.tree.children.unshift({ el: 'Slot' })))).toBe(true); // new first slot shifts the rest
    expect(isBreakingChange(p, mut(p, (s) => (s.tree.children[0].props.allow = ['Text'])))).toBe(true);
    expect(isBreakingChange(p, mut(p, (s) => s.tree.children.push({ el: 'Slot' })))).toBe(false);
    expect(isBreakingChange(p, mut(p, (s) => (s.tree.children[0].props.max = 3)))).toBe(false);
    expect(isBreakingChange(p, mut(p, (s) => (s.tree.el = 'Box')))).toBe(false);
    expect(withAutoVersion(p, mut(p, (s) => s.tree.children.shift())).version).toBe(2);
  });
});
