// @vitest-environment happy-dom
// Starter templates of the block builder palette (spec §3 "Starter templates", Decisions 4 and 6).
import { afterEach, describe, expect, it } from 'vitest';
import { INTERACTIVE_ELEMENTS, validateComposedSpec, type ComposedNode } from '@opencloudcms/schema';
import {
  BUILDER_TEMPLATES,
  TEMPLATE_PREFIX,
  expandTemplates,
  templateName,
  templatePuckProps,
  templatesRefused,
} from '../../admin/src/block-builder/templates';
import { buildBuilderConfig, paletteCategories, slotRules } from '../../admin/src/block-builder/element-config';
import { emptySpec } from '../../admin/src/block-builder/logic';
import { puckToTree, type BuilderPuckData, type PuckItem } from '../../admin/src/block-builder/tree-puck';
import { setActiveMessages } from '../../admin/src/i18n';
import { enUS } from '../../admin/src/i18n/messages/en-US';
import viVN from '../../admin/src/i18n/messages/vi-VN';

afterEach(() => setActiveMessages('en-US', enUS));

const LOCALES = ['en-US', 'vi-VN', 'fr-FR', 'id-ID'] as const;
const walk = (n: ComposedNode, out: ComposedNode[] = []) => {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
};
const constTexts = (n: ComposedNode) =>
  walk(n).flatMap((x) => Object.values(x.bind ?? {}).flatMap((s) => (s && (s as { from: string }).from === 'const' ? [String((s as { value: unknown }).value)] : [])));

const stub = (() => null) as never;
const config = (collection = false) =>
  buildBuilderConfig({
    collection, token: stub, sources: stub, showIf: stub, allow: stub, tracks: stub, style: stub, responsiveSelect: stub, length: stub,
    action: stub, pattern: stub, regionLabel: stub, options: stub, icon: stub, childItems: stub, render: () => stub, root: stub,
  });

/** Puck's `populateIds` on insert: every item (nested slots included) gets an id. */
let seq = 0;
function withIds(type: string, props: Record<string, unknown>): PuckItem {
  const kids = Array.isArray(props.children) ? (props.children as { type: string; props: Record<string, unknown> }[]).map((c) => withIds(c.type, c.props)) : undefined;
  return { type, props: { ...props, ...(kids ? { children: kids } : {}), id: `${type}-${++seq}` } };
}

describe('BUILDER_TEMPLATES', () => {
  it('the six templates of spec §3', () => {
    expect(BUILDER_TEMPLATES.map((t) => t.id)).toEqual(['nav-menu', 'mobile-nav', 'faq', 'product-tabs', 'banner-carousel', 'contact-form']);
  });

  it.each(LOCALES)('%s: every template tree passes validateComposedSpec in a block spec', (locale) => {
    for (const tpl of BUILDER_TEMPLATES) {
      const spec = { ...emptySpec(), name: 'Tpl', label: { 'en-US': 'Tpl' }, tree: tpl.tree(locale) };
      expect(validateComposedSpec(spec).map((i) => `${i.path.join('.')}: ${i.message}`), `${tpl.id} (${locale})`).toEqual([]);
    }
  });

  it('templates insert constant text only and create no block fields', () => {
    for (const tpl of BUILDER_TEMPLATES) {
      for (const n of walk(tpl.tree('en-US'))) for (const s of Object.values(n.bind ?? {})) expect((s as { from: string }).from).toBe('const');
    }
  });

  it('FAQ: a Heading and an Accordion with 3 items', () => {
    const tree = BUILDER_TEMPLATES.find((t) => t.id === 'faq')!.tree('en-US');
    expect(tree.children!.map((c) => c.el)).toEqual(['Heading', 'Accordion']);
    expect(tree.children![1]!.children!.map((c) => c.el)).toEqual(['AccordionItem', 'AccordionItem', 'AccordionItem']);
  });

  it('nav menu: link Buttons and a "Shop" Dropdown with three link Buttons; hover colours set', () => {
    const tree = BUILDER_TEMPLATES.find((t) => t.id === 'nav-menu')!.tree('en-US');
    const dd = walk(tree).filter((n) => n.el === 'Dropdown');
    expect(dd).toHaveLength(1);
    expect(dd[0]!.bind?.label).toEqual({ from: 'const', value: 'Shop' });
    const inner = walk(dd[0]!).filter((n) => n.el === 'Button');
    expect(inner).toHaveLength(3);
    for (const b of walk(tree).filter((n) => n.el === 'Button')) {
      expect(b.props?.variant).toBe('link');
      expect(b.style?.hover).toBeTruthy();
    }
  });

  it("mobile nav: the Dropdowns use display: { base: 'inline' }", () => {
    const tree = BUILDER_TEMPLATES.find((t) => t.id === 'mobile-nav')!.tree('en-US');
    const dd = walk(tree).filter((n) => n.el === 'Dropdown');
    expect(dd.length).toBeGreaterThan(0);
    for (const d of dd) expect(d.props?.display).toEqual({ base: 'inline' });
  });

  it('product tabs, banner carousel and contact form follow the spec', () => {
    const tabs = BUILDER_TEMPLATES.find((t) => t.id === 'product-tabs')!.tree('en-US');
    expect(walk(tabs).filter((n) => n.el === 'TabPanel').map((n) => (n.bind?.label as { value: string }).value)).toEqual(['Description', 'Specs', 'Shipping']);
    const car = walk(BUILDER_TEMPLATES.find((t) => t.id === 'banner-carousel')!.tree('en-US')).find((n) => n.el === 'Carousel')!;
    expect(car.props?.autoplay).toBe(5);
    expect(car.children).toHaveLength(3);
    for (const s of car.children!) expect(walk(s).map((n) => n.el)).toEqual(expect.arrayContaining(['Image', 'Heading', 'Button']));
    const form = BUILDER_TEMPLATES.find((t) => t.id === 'contact-form')!.tree('en-US');
    expect(walk(form).slice(1).map((n) => [n.el, n.props?.name ?? null])).toEqual([
      ['Input', 'name'], ['Input', 'email'], ['Input', 'phone'], ['Select', 'topic'], ['Textarea', 'message'], ['Checkbox', 'newsletter'], ['Button', null],
    ]);
    const send = walk(form).find((n) => n.el === 'Button')!;
    expect(send.props?.action).toBeUndefined();
    expect(send.bind?.href).toBeUndefined();
  });

  it('template text follows the locale (vi-VN gives Vietnamese copy, the 4 locales differ)', () => {
    const faq = BUILDER_TEMPLATES.find((t) => t.id === 'faq')!;
    expect(constTexts(faq.tree('vi-VN'))[0]).toBe('Câu hỏi thường gặp');
    for (const tpl of BUILDER_TEMPLATES) {
      const texts = LOCALES.map((l) => constTexts(tpl.tree(l)).join('|'));
      expect(new Set(texts).size, tpl.id).toBe(4);
    }
    // An unknown locale falls back to English.
    expect(constTexts(faq.tree('de-DE'))).toEqual(constTexts(faq.tree('en-US')));
  });
});

describe('Templates palette section', () => {
  it('a "Templates" category with the six templates (no banner carousel in a list block)', () => {
    const cats = paletteCategories({ collection: false, overlayRoot: false, emptyRoot: false });
    expect(cats.templates).toEqual({ title: 'Templates', components: BUILDER_TEMPLATES.map((t) => templateName(t.id)) });
    expect(paletteCategories({ collection: true, overlayRoot: false, emptyRoot: false }).templates.components).not.toContain(templateName('banner-carousel'));
  });

  it('each template is a Puck component: the root element config with the template as default props, label translated', () => {
    const c = config();
    const faq = c.components[templateName('faq')] as unknown as { label: string; defaultProps: Record<string, unknown>; fields: Record<string, { type: string }> };
    expect(faq.label).toBe('FAQ');
    expect(faq.fields.children).toMatchObject({ type: 'slot' });
    const kids = faq.defaultProps.children as { type: string; props: Record<string, unknown> }[];
    expect(kids.map((k) => k.type)).toEqual(['Heading', 'Accordion']);
    // No ids: Puck gives fresh ones on every insert.
    expect(JSON.stringify(faq.defaultProps)).not.toContain('"id"');
  });

  it('inserting "faq" (then expanding it) adds a Heading and an Accordion with 3 items', () => {
    const c = config();
    const tpl = c.components[templateName('faq')]!;
    const root = withIds('Stack', { direction: 'vertical', children: [] });
    const inserted = withIds(templateName('faq'), structuredClone(tpl.defaultProps as Record<string, unknown>));
    (root.props.children as PuckItem[]).push(inserted);
    const data: BuilderPuckData = { root: { props: {} }, content: [root] };
    const fixed = expandTemplates(data)!;
    expect(fixed).not.toBeNull();
    expect(expandTemplates(fixed)).toBeNull();
    const tree = puckToTree(fixed);
    const faq = tree.children![0]!;
    expect(faq.el).toBe('Stack');
    expect(faq.children!.map((n) => n.el)).toEqual(['Heading', 'Accordion']);
    expect(faq.children![1]!.children).toHaveLength(3);
    // Ids are kept (the selection stays on the inserted item).
    expect((fixed.content[0]!.props.children as PuckItem[])[0]!.props.id).toBe(inserted.props.id);
  });

  it('default props follow the admin locale', () => {
    setActiveMessages('vi-VN', viVN as never);
    const c = config();
    const faq = c.components[templateName('faq')] as unknown as { label: string; defaultProps: { children: { props: { bind: { text: { value: string } } } }[] } };
    expect(faq.defaultProps.children[0]!.props.bind.text.value).toBe('Câu hỏi thường gặp');
    expect(faq.label).toBe(viVN.blockBuilder.templates.faq);
  });

  it('templatePuckProps keeps bind, style and children of the tree', () => {
    const p = templatePuckProps({ el: 'Stack', props: { gap: '4' }, style: { padding: { t: '4' } } as never, children: [{ el: 'Heading', bind: { text: { from: 'const', value: 'H' } } }] });
    expect(p).toEqual({ gap: '4', style: { padding: { t: '4' } }, children: [{ type: 'Heading', props: { bind: { text: { from: 'const', value: 'H' } } } }] });
  });

  it('slots refuse templates that would break their rules', () => {
    const nav = templateName('nav-menu');
    const mobile = templateName('mobile-nav');
    const tabs = templateName('product-tabs');
    const car = templateName('banner-carousel');
    // A Dropdown cannot hold a Dropdown at any depth.
    expect(slotRules('Dropdown', false).disallow).toEqual(expect.arrayContaining([nav, mobile]));
    // The overlay frame refuses interactive containers as direct children only (a nav inside a Stack is fine).
    expect(slotRules('Overlay', false).disallow).toEqual(expect.arrayContaining([tabs, car]));
    expect(slotRules('Overlay', false).disallow).not.toContain(mobile);
    // No Carousel in a collection item template.
    expect(slotRules('Box', true).disallow).toContain(car);
    expect(slotRules('Box', false).disallow).not.toContain(car);
    // Accordion / Tabs take only their items.
    expect(slotRules('Tabs', false)).toEqual({ allow: ['TabPanel'] });
    // A clickable Box/Card refuses every template (each holds interactive elements).
    expect(templatesRefused([], INTERACTIVE_ELEMENTS).length).toBe(BUILDER_TEMPLATES.length);
    expect(TEMPLATE_PREFIX).toBe('Template-');
  });
});
