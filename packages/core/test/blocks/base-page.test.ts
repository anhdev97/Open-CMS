import { describe, expect, it } from 'vitest';
import {
  PUCK_FORMAT_VERSION,
  blockManifest,
  composeWithBase,
  containsInteractive,
  coreBlocks,
  defineBlocks,
  defineComposedBlock,
  type ComposedBlockSpec,
  type StoredPageContent,
} from '../../blocks/src';

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
      children: [{ el: 'Region', props: { name: 'header' } }, { el: 'PageContent' }, { el: 'Region', props: { name: 'footer' } }],
    },
  }),
);
const modal = defineComposedBlock(
  spec({ id: 'blk_modal01', name: 'LienHe', tree: { el: 'Overlay', children: [{ el: 'Text', props: { text: 'Hi' } }] } }),
);
const promo = defineComposedBlock(
  spec({
    id: 'blk_promo01',
    name: 'Promo',
    tree: { el: 'Button', props: { label: 'Open', action: { type: 'overlay', op: 'open', target: 'lien-he' } } },
  }),
);
const plain = defineComposedBlock(spec({ id: 'blk_plain01', name: 'Plain', tree: { el: 'Text', props: { text: 'x' } } }));
const nav = defineComposedBlock(
  spec({
    id: 'blk_nav001',
    name: 'Nav',
    tree: { el: 'Stack', children: [{ el: 'Dropdown', bind: { label: { from: 'const', value: 'Menu' } }, children: [{ el: 'Text', props: { text: 'x' } }] }] },
  }),
);
const logo = defineComposedBlock(
  spec({ id: 'blk_logo01', name: 'Logo', tree: { el: 'Box', props: { action: { type: 'overlay', op: 'open', target: 'lien-he' } } } }),
);
const registry = defineBlocks([...coreBlocks, frame, modal, promo, plain, nav, logo]);
const manifest = blockManifest(registry);

const heading = (text: string, id = text) => ({ type: 'Heading', props: { id, _v: 1, text, level: 1, align: 'left' } });
const stored = (content: unknown[], rootProps: Record<string, unknown> = {}, zones?: Record<string, unknown[]>): StoredPageContent => ({
  format: 'puck',
  formatVersion: PUCK_FORMAT_VERSION,
  data: { root: { props: rootProps }, content, ...(zones ? { zones } : {}) },
});
const baseContent = () =>
  stored([
    {
      type: 'SiteFrame',
      props: { id: 'f1', _v: 1, region__header: [heading('Base header')], pageContent: [], region__footer: [heading('Base footer')] },
    },
  ]);
const pageContent = () => stored([heading('Body')], { title: 'About', region__header: [heading('Own header')], region__nope: [heading('X')] });
type Item = { type: string; props: Record<string, unknown> };
const frameOf = (c: StoredPageContent) => c.data.content[0] as Item;

describe('composeWithBase', () => {
  for (const m of [['manifest', manifest], ['registry', registry]] as const) {
    it(`default regions take the base content, page content goes to pageContent (${m[0]})`, () => {
      const out = composeWithBase(baseContent(), pageContent(), null, m[1]);
      expect(out.data.content).toHaveLength(1);
      const f = frameOf(out);
      expect(f.type).toBe('SiteFrame');
      expect(f.props.id).toBe('f1');
      expect(f.props.pageContent).toEqual([heading('Body')]);
      expect(f.props.region__header).toEqual([heading('Base header')]);
      expect(f.props.region__footer).toEqual([heading('Base footer')]);
    });
  }

  it('replace takes the page root region__<name>, hide empties the region; absent = default', () => {
    const out = composeWithBase(baseContent(), pageContent(), { baseId: 'b', regions: { header: 'replace', footer: 'hide' } }, manifest);
    expect(frameOf(out).props.region__header).toEqual([heading('Own header')]);
    expect(frameOf(out).props.region__footer).toEqual([]);
    const footerOnly = composeWithBase(baseContent(), pageContent(), { baseId: 'b', regions: { footer: 'replace' } }, manifest);
    // Replaced without page blocks → empty; header stays default.
    expect(frameOf(footerOnly).props.region__footer).toEqual([]);
    expect(frameOf(footerOnly).props.region__header).toEqual([heading('Base header')]);
  });

  it('unknown region keys are ignored; page root keeps title but drops region__* props', () => {
    const out = composeWithBase(baseContent(), pageContent(), { baseId: 'b', regions: { nope: 'replace', header: 'default' } }, manifest);
    expect(frameOf(out).props).not.toHaveProperty('region__nope');
    expect(out.data.root).toEqual({ props: { title: 'About' } });
    expect(out.format).toBe('puck');
    expect(out.formatVersion).toBe(PUCK_FORMAT_VERSION);
  });

  it('zones are merged, page zones win', () => {
    const b = { ...baseContent(), data: { ...baseContent().data, zones: { a: [heading('ba')], s: [heading('bs')] } } };
    const p = stored([heading('Body')], {}, { s: [heading('ps')] });
    expect(composeWithBase(b, p, null, manifest).data.zones).toEqual({ a: [heading('ba')], s: [heading('ps')] });
  });

  it('null base, or a base that is not one layout block at root, leaves the page unchanged (same object)', () => {
    const p = pageContent();
    expect(composeWithBase(null, p, null, manifest)).toBe(p);
    expect(composeWithBase(stored([heading('not a layout')]), p, null, manifest)).toBe(p);
    expect(composeWithBase(stored([...baseContent().data.content, heading('extra')]), p, null, manifest)).toBe(p);
    expect(composeWithBase(stored([]), p, null, manifest)).toBe(p);
    expect(composeWithBase({ ...baseContent(), formatVersion: 1 }, p, null, manifest)).toBe(p);
  });

  it('does not mutate its inputs', () => {
    const b = baseContent();
    const p = pageContent();
    const before = JSON.stringify([b, p]);
    composeWithBase(b, p, { baseId: 'x', regions: { header: 'replace' } }, manifest);
    expect(JSON.stringify([b, p])).toBe(before);
  });
});

describe('containsInteractive', () => {
  const inFrame = (...items: unknown[]) => stored([{ type: 'SiteFrame', props: { id: 'f', region__header: [], pageContent: items } }]);
  it('true for an overlay block anywhere (slots, zones, root props)', () => {
    expect(containsInteractive(stored([{ type: 'LienHe', props: { id: 'm' } }]), manifest)).toBe(true);
    expect(containsInteractive(inFrame({ type: 'LienHe', props: { id: 'm' } }), manifest)).toBe(true);
    expect(containsInteractive(stored([], {}, { z: [{ type: 'LienHe', props: {} }] }), registry)).toBe(true);
    expect(containsInteractive(stored([], { region__header: [{ type: 'LienHe', props: {} }] }), registry)).toBe(true);
  });

  it('true for a block with an action prop (library Button) or a composed block whose spec has a Button action', () => {
    const button = { type: 'Button', props: { id: 'b', label: 'Go', action: { type: 'overlay', op: 'open', target: 'x' } } };
    expect(containsInteractive(inFrame(button), manifest)).toBe(true);
    expect(containsInteractive(inFrame({ type: 'Promo', props: { id: 'p' } }), registry)).toBe(true);
    // Puck data (not stored) works too.
    expect(containsInteractive(inFrame(button).data as never, registry)).toBe(true);
  });

  it('true for a composed block with a Dropdown, or with an action on another element (Box)', () => {
    expect(containsInteractive(inFrame({ type: 'Nav', props: { id: 'n' } }), registry)).toBe(true);
    expect(containsInteractive(inFrame({ type: 'Logo', props: { id: 'l' } }), registry)).toBe(true);
  });

  it('false otherwise', () => {
    const link = { type: 'Button', props: { id: 'b', label: 'Go', action: null, link: { kind: 'url', url: '/x' } } };
    expect(containsInteractive(inFrame(heading('x'), link, { type: 'Plain', props: {} }), registry)).toBe(false);
    expect(containsInteractive(stored([]), manifest)).toBe(false);
    expect(containsInteractive(null, manifest)).toBe(false);
  });
});
