import { describe, expect, it } from 'vitest';
import {
  composedManifestEntry, isBreakingChange, validateComposedSpec, withAutoVersion, type ComposedBlockSpec,
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
