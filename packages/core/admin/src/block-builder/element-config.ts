// Puck config of the block builder: one component per design-system element (spec §5.3), its design-token props,
// a sources field for the bindable props, a show-if field, a `style` field and, for containers, a `children` slot.
// Relative imports only (root vitest).
import type { ComponentConfig, Config, CustomFieldRender, Field } from '@puckeditor/core';
import { COLOR_TOKENS, SPACING_TOKENS } from '@opencloudcms/core/blocks';
import {
  AUTOCOMPLETE_TOKENS, COMPOSED_ELEMENTS, ELEMENT_BINDABLE, FORM_CONTROL_ELEMENTS, INPUT_TYPES, INTERACTIVE_CONTAINERS, optionValues,
  type ComposedElement, type NodeStyle,
} from '@opencloudcms/schema';
import type { ReactElement, ReactNode } from 'react';
import { getActiveLocale, t, tEnglish } from '../i18n';
import { insertAndSelect, type PaletteCategory as SearchCategory, type PaletteModel } from '../components/PaletteSearch';
import { BUILDER_TEMPLATES, templateName, templateOf, templatePuckProps, templateRootEl, templatesRefused } from './templates';
import { hasLegacyProps, migrateLegacyProps } from './style/migrate';
import { indexPuck, isContainer, pathOf, uniqueRegionName, type BuilderPuckData } from './tree-puck';

export type PropKind =
  | 'color' | 'spacing' | 'select' | 'boolean' | 'text' | 'number' | 'allow' | 'tracks' | 'length' | 'responsiveSelect' | 'pattern' | 'action' | 'regionLabel'
  | 'options' | 'icon' | 'name';
export interface PropDef {
  name: string;
  kind: PropKind;
  options?: readonly (string | number)[];
  /** `pattern` props: `name` (Region/overlay names) or `anchor` (`anchorId`, scroll targets). */
  pattern?: 'name' | 'anchor';
  /** Label key under `blockBuilder.props` when it differs from `name`. */
  labelKey?: string;
  /** The prop may be unset: a select gets a "None" choice, and an emptied select or text drops the prop. */
  optional?: boolean;
  /** `responsiveSelect` of numbers (Carousel `perView`): the stored values are numbers. */
  numeric?: boolean;
  /** Number options are seconds (Carousel `autoplay`). */
  seconds?: boolean;
}

const spacing = (name: string): PropDef => ({ name, kind: 'spacing' });
const color = (name: string): PropDef => ({ name, kind: 'color' });
const select = (name: string, options: readonly (string | number)[]): PropDef => ({ name, kind: 'select', options });
const perBreakpoint = (name: string, options: readonly string[]): PropDef => ({ name, kind: 'responsiveSelect', options });
const ALIGN = ['start', 'center', 'end', 'stretch'] as const;
const bool = (name: string): PropDef => ({ name, kind: 'boolean' });
const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'link'] as const;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ACTION: PropDef = { name: 'action', kind: 'action' };
const ARIA_LABEL: PropDef = { name: 'ariaLabel', kind: 'text', optional: true };
/** Form control `name` (`FORM_CONTROL_NAME_RE`, required). */
const CONTROL_NAME: PropDef = { name: 'name', kind: 'name' };
const OPTIONS: PropDef = { name: 'options', kind: 'options' };
/** One of the current option values (`resolveFields` fills the choices). */
const DEFAULT_VALUE: PropDef = { name: 'defaultValue', kind: 'select', options: [], optional: true };
const REQUIRED = bool('required');
const DISABLED = bool('disabled');

/**
 * The fixed (design-token and layout) props of each element, in panel order. Values match the `ui` primitives' lookup
 * tables. Box/Card `padding` and `background` are edited in the style panel; Columns `count` only shows while a node
 * still has it (it becomes `tracks` on the first change).
 */
export const ELEMENT_PROPS: Record<ComposedElement, readonly PropDef[]> = {
  Box: [ACTION, ARIA_LABEL],
  Stack: [
    perBreakpoint('direction', ['vertical', 'horizontal']), spacing('gap'), perBreakpoint('align', ALIGN),
    select('justify', ['start', 'center', 'end', 'between']), { name: 'wrap', kind: 'boolean' },
  ],
  Columns: [
    select('count', [2, 3, 4]), { name: 'tracks', kind: 'tracks' }, select('alignY', ALIGN), spacing('gap'),
    { name: 'gapX', kind: 'length' }, { name: 'gapY', kind: 'length' },
  ],
  Grid: [select('columns', [2, 3, 4, 5, 6]), spacing('gap')],
  Card: [{ name: 'bordered', kind: 'boolean' }, ACTION, ARIA_LABEL],
  Slot: [{ name: 'allow', kind: 'allow' }, { name: 'max', kind: 'number' }],
  Heading: [select('level', [1, 2, 3, 4]), select('align', ['left', 'center', 'right'])],
  Text: [select('size', ['sm', 'base', 'lg']), color('color')],
  Image: [
    select('ratio', ['auto', 'square', 'video', 'wide']), { name: 'rounded', kind: 'boolean' }, select('fit', ['cover', 'contain']),
    perBreakpoint('aspect', ['auto', 'square', 'video', '3/2', '4/3', 'wide']), ACTION,
  ],
  Button: [
    select('variant', BUTTON_VARIANTS), select('size', ['sm', 'default', 'lg']), { name: 'icon', kind: 'icon', optional: true },
    select('iconPosition', ['start', 'end']), bool('iconOnly'), ACTION,
  ],
  Badge: [select('variant', ['default', 'secondary', 'outline', 'destructive'])],
  Price: [{ name: 'showCurrency', kind: 'boolean' }],
  Date: [select('format', ['short', 'long']), { name: 'timeZone', kind: 'text' }],
  Divider: [],
  Spacer: [spacing('size')],
  Region: [{ name: 'name', kind: 'pattern', pattern: 'name' }, { name: 'label', kind: 'regionLabel', labelKey: 'regionLabel' }, { name: 'allow', kind: 'allow' }],
  PageContent: [],
  Overlay: [
    { ...select('variant', ['modal', 'drawer']), labelKey: 'overlayVariant' }, select('side', ['left', 'right', 'top', 'bottom']),
    select('size', ['sm', 'md', 'lg', 'xl', 'full']), { name: 'closeOnBackdrop', kind: 'boolean' }, { name: 'showClose', kind: 'boolean' },
  ],
  // Builder component elements (spec §1 table). AccordionItem / TabPanel only have their bound title / label.
  Dropdown: [
    select('openOn', ['hover', 'click']), select('placement', ['bottom-start', 'bottom-end', 'bottom']), perBreakpoint('display', ['popover', 'inline']),
    select('triggerVariant', BUTTON_VARIANTS), bool('chevron'),
  ],
  Tooltip: [select('side', ['top', 'bottom', 'left', 'right'])],
  Accordion: [bool('single'), select('defaultOpen', ['none', 'first'])],
  AccordionItem: [],
  Tabs: [select('variant', ['underline', 'pills']), select('align', ['start', 'center', 'stretch'])],
  TabPanel: [],
  Carousel: [
    { name: 'perView', kind: 'responsiveSelect', options: range(1, 6), numeric: true }, spacing('gap'), bool('arrows'), bool('dots'), bool('loop'),
    { ...select('autoplay', ['off', ...range(3, 10)]), seconds: true },
  ],
  Icon: [{ name: 'name', kind: 'icon', labelKey: 'icon' }, select('size', ['sm', 'md', 'lg', 'xl'])],
  Input: [CONTROL_NAME, { ...select('type', INPUT_TYPES), labelKey: 'inputType' }, REQUIRED, DISABLED, { ...select('autocomplete', AUTOCOMPLETE_TOKENS), optional: true }],
  Textarea: [CONTROL_NAME, select('rows', range(2, 12)), REQUIRED, DISABLED],
  Select: [CONTROL_NAME, OPTIONS, DEFAULT_VALUE, REQUIRED, DISABLED],
  Combobox: [CONTROL_NAME, OPTIONS, DEFAULT_VALUE, REQUIRED, DISABLED],
  Radio: [CONTROL_NAME, OPTIONS, select('orientation', ['vertical', 'horizontal']), DEFAULT_VALUE, REQUIRED, DISABLED],
  Checkbox: [CONTROL_NAME, { name: 'value', kind: 'text', optional: true, labelKey: 'checkboxValue' }, bool('defaultChecked'), REQUIRED, DISABLED],
  Switch: [CONTROL_NAME, bool('defaultChecked'), DISABLED],
};

/** The item element of Accordion / Tabs (added with "Add item" / "Add tab", never from the palette). */
export const CHILD_ITEM: Partial<Record<ComposedElement, 'AccordionItem' | 'TabPanel'>> = { Accordion: 'AccordionItem', Tabs: 'TabPanel' };
const ITEM_ELEMENTS: readonly ComposedElement[] = ['AccordionItem', 'TabPanel'];
/** Bound text of the `n`-th (1-based) new Accordion / Tabs item: `Item n` / `Tab n`. */
export const childItemBind = (item: 'AccordionItem' | 'TabPanel', n: number) =>
  item === 'TabPanel' ? { label: { from: 'const', value: `Tab ${n}` } } : { title: { from: 'const', value: `Item ${n}` } };
const OPTION_DEFAULTS = [
  { value: 'option-1', label: 'Option 1' },
  { value: 'option-2', label: 'Option 2' },
];
const text = (value: string) => ({ from: 'const', value });

/** Elements with no `anchorId` (they render no element of their own). */
const NO_ANCHOR: readonly ComposedElement[] = ['Slot', 'Region', 'PageContent'];
/** Elements without a show-if condition (layout regions and the overlay frame are always there). */
const NO_SHOW_IF: readonly ComposedElement[] = ['Slot', 'Region', 'PageContent', 'Overlay'];
/** Default name of a new Region (then `region-2`, `region-3`…). */
export const REGION_DEFAULT_NAME = 'region';

/** Props of a freshly dropped element (what its render needs, plus visible placeholder text). */
export const ELEMENT_DEFAULTS: Partial<Record<ComposedElement, Record<string, unknown>>> = {
  Stack: { direction: 'vertical' },
  Columns: { tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
  Grid: { columns: 3 },
  Heading: { level: 2, bind: { text: { from: 'const', value: 'Heading' } } },
  Text: { bind: { text: { from: 'const', value: 'Text' } } },
  Button: { bind: { label: { from: 'const', value: 'Button' } } },
  Badge: { bind: { text: { from: 'const', value: 'Badge' } } },
  Date: { timeZone: 'UTC' },
  Spacer: { size: '8' },
  Region: { name: REGION_DEFAULT_NAME },
  Overlay: { variant: 'modal', size: 'md', closeOnBackdrop: true, showClose: true },
  // Builder component elements: the spec table defaults, written out so the panel shows them.
  Dropdown: { openOn: 'hover', placement: 'bottom-start', display: 'popover', triggerVariant: 'ghost', chevron: true, bind: { label: text('Menu') } },
  Tooltip: { side: 'top', bind: { text: text('Tooltip text') } },
  Accordion: { single: false, defaultOpen: 'none', children: [{ type: 'AccordionItem', props: { bind: childItemBind('AccordionItem', 1) } }] },
  AccordionItem: { bind: childItemBind('AccordionItem', 1) },
  Tabs: { variant: 'underline', align: 'start', children: [{ type: 'TabPanel', props: { bind: childItemBind('TabPanel', 1) } }] },
  TabPanel: { bind: childItemBind('TabPanel', 1) },
  Carousel: { perView: { base: 1 }, gap: '4', arrows: true, dots: true, loop: false, autoplay: 'off' },
  Icon: { name: 'star', size: 'md' },
  Input: { name: 'name', type: 'text', bind: { label: text('Label') } },
  Textarea: { name: 'message', rows: 4, bind: { label: text('Message') } },
  Select: { name: 'choice', options: OPTION_DEFAULTS, bind: { label: text('Choose') } },
  Combobox: { name: 'choice', options: OPTION_DEFAULTS, bind: { label: text('Choose') } },
  Radio: { name: 'choice', options: OPTION_DEFAULTS, orientation: 'vertical', bind: { label: text('Choose') } },
  Checkbox: { name: 'agree', value: 'on', bind: { label: text('Checkbox') } },
  Switch: { name: 'enabled', bind: { label: text('Switch') } },
};

export type StyleSection = 'layout' | 'spacing' | 'margin' | 'size' | 'maxWidth' | 'colors' | 'hover' | 'textColor' | 'visibility' | 'span';

const BOX: StyleSection[] = ['spacing', 'size', 'maxWidth', 'colors', 'visibility', 'span'];
/** Box and Card: the container sections and "On hover" (spec §1.2: hover on Box, Card, Button only). */
const BOX_HOVER: StyleSection[] = ['spacing', 'size', 'maxWidth', 'colors', 'hover', 'visibility', 'span'];
/** Component blocks that take the width of their parent (Accordion, Tabs, Carousel, form controls). */
const WIDE: StyleSection[] = ['margin', 'maxWidth', 'visibility', 'span'];
const TEXT: StyleSection[] = ['margin', 'maxWidth', 'textColor', 'visibility', 'span'];
const MEDIA: StyleSection[] = ['margin', 'size', 'visibility', 'span'];
const PLAIN: StyleSection[] = ['margin', 'visibility', 'span'];

/**
 * Style sections of each element (spec "Rendering" table). `layout` marks elements whose layout props (tracks,
 * direction, gaps…) are element fields shown above the style panel; `span` is shown when the parent is Columns or Grid.
 */
export const STYLE_SECTIONS: Record<ComposedElement, readonly StyleSection[]> = {
  Box: BOX_HOVER, Card: BOX_HOVER,
  Stack: ['layout', ...BOX], Columns: ['layout', ...BOX], Grid: ['layout', ...BOX],
  Image: MEDIA,
  Button: ['margin', 'size', 'colors', 'hover', 'visibility', 'span'],
  Badge: ['margin', 'size', 'textColor', 'visibility', 'span'],
  Heading: TEXT, Text: TEXT, Price: TEXT, Date: TEXT,
  Divider: PLAIN, Spacer: PLAIN, Slot: PLAIN,
  // Regions render their page blocks only; the overlay frame has no visibility or span (size per variant/side).
  Region: [], PageContent: [], Overlay: ['spacing', 'size', 'colors'],
  // Builder component elements. AccordionItem / TabPanel render no box of their own (their parent lays them out).
  Dropdown: PLAIN, Tooltip: PLAIN, Accordion: WIDE, AccordionItem: [], Tabs: WIDE, TabPanel: [], Carousel: WIDE,
  Icon: ['margin', 'textColor', 'visibility', 'span'],
  Input: WIDE, Textarea: WIDE, Select: WIDE, Combobox: WIDE, Radio: WIDE, Checkbox: WIDE, Switch: WIDE,
};

export const LAYOUT_ELEMENTS: readonly ComposedElement[] = ['Box', 'Stack', 'Columns', 'Grid', 'Card', 'Slot'];
/** Elements of layout blocks (base pages): offered unless the block is an overlay. */
export const REGION_ELEMENTS: readonly ComposedElement[] = ['Region', 'PageContent'];
/** The "Interactive" palette category (spec §3). */
export const INTERACTIVE_PALETTE: readonly ComposedElement[] = ['Dropdown', 'Tooltip', 'Accordion', 'Tabs', 'Carousel', 'Icon'];
/** The "Form" palette category: the 7 form controls. */
export const FORM_PALETTE: readonly ComposedElement[] = FORM_CONTROL_ELEMENTS;
export const CONTENT_ELEMENTS: readonly ComposedElement[] = COMPOSED_ELEMENTS.filter(
  (e) =>
    !LAYOUT_ELEMENTS.includes(e) && !REGION_ELEMENTS.includes(e) && e !== 'Overlay'
    && !INTERACTIVE_PALETTE.includes(e) && !FORM_PALETTE.includes(e) && !ITEM_ELEMENTS.includes(e),
);

/** Translated label, or `fallback` when the key is missing. */
export function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

export const elementLabel = (el: string) => tr(`blockBuilder.elements.${el}`, el);
export const propLabel = (name: string) => tr(`blockBuilder.props.${name}`, name);
const valueLabel = (v: string | number) => tr(`blockBuilder.values.${v}`, String(v));
const optionLabel = (p: PropDef, v: string | number) => (p.seconds && typeof v === 'number' ? t('blockBuilder.values.seconds', { n: v }) : valueLabel(v));

export type Render = (props: Record<string, unknown>) => ReactElement;

export interface BuilderConfigOptions {
  /** Collection mode: `Slot` is not offered (not allowed in an item template). */
  collection: boolean;
  /** Design-token select (`metadata.blockField.kind` is `color` or `spacing`). */
  token: CustomFieldRender<string>;
  /** The sources of an element's bindable props (`metadata.el`). */
  sources: CustomFieldRender<unknown>;
  showIf: CustomFieldRender<unknown>;
  /** Slot `allow` (page-builder block names). */
  allow: CustomFieldRender<unknown>;
  /** Columns `tracks` (`metadata.blockField.max`). */
  tracks: CustomFieldRender<unknown>;
  /** The element's `style` (`metadata.el`). */
  style: CustomFieldRender<unknown>;
  /** A select per breakpoint (`metadata.options`: `{ value, label }[]`). */
  responsiveSelect: CustomFieldRender<unknown>;
  /** A plain spacing token or length (Columns gaps). */
  length: CustomFieldRender<unknown>;
  /** Button `action` (`ActionField`). */
  action: CustomFieldRender<unknown>;
  /** A text checked against a name pattern (`metadata.pattern`: `name` or `anchor`). */
  pattern: CustomFieldRender<unknown>;
  /** Region `label`: text, or a localized label written in code (shown read-only). */
  regionLabel: CustomFieldRender<unknown>;
  /** Select / Combobox / Radio `options` (`OptionsField`). */
  options: CustomFieldRender<unknown>;
  /** An icon name (`IconPicker`; `metadata.optional`: a "None" choice). */
  icon: CustomFieldRender<unknown>;
  /** "Add item" / "Add tab" of Accordion / Tabs (`metadata.item`: the item element). */
  childItems: CustomFieldRender<unknown>;
  /** Region names in the canvas, but item `exceptId`'s (a new Region gets a free name). */
  regionNames?: (exceptId: string) => string[];
  /** Palette state at mount (later changes go through `paletteCategories` and Puck's `setUi`). */
  palette?: Omit<PaletteState, 'collection'>;
  /** Canvas render of an element. Components are `inline`: the render puts `props.puck.dragRef` on its root. */
  render: (el: ComposedElement) => Render;
  /** Canvas render of the root (wraps the template: collection layout, sample repeats). */
  root: (props: { children?: ReactNode }) => ReactElement;
  /**
   * Called when an element's props change (Puck `resolveData`): returns props to merge (e.g. `showCurrency` when a
   * Price gets bound to a money field), or null.
   */
  onPropsChange?: (el: ComposedElement, next: Record<string, unknown>, prev: Record<string, unknown> | undefined, trigger: string) => Record<string, unknown> | null;
}

function propField(p: PropDef, opts: BuilderConfigOptions): Field {
  const label = propLabel(p.labelKey ?? p.name);
  switch (p.kind) {
    case 'color':
    case 'spacing':
      return { type: 'custom', label, render: opts.token, metadata: { blockField: { kind: p.kind } } } as Field;
    case 'select':
      return {
        type: 'select',
        label,
        options: [...(p.optional ? [{ label: t('blockBuilder.none'), value: '' }] : []), ...(p.options ?? []).map((v) => ({ label: optionLabel(p, v), value: v }))],
      } as Field;
    case 'boolean':
      return {
        type: 'radio',
        label,
        options: [
          { label: t('blockBuilder.yes'), value: true },
          { label: t('blockBuilder.no'), value: false },
        ],
      } as Field;
    case 'text':
      return { type: 'text', label, ...(p.name === 'timeZone' ? { placeholder: 'UTC' } : {}) } as Field;
    case 'number':
      return { type: 'number', label, min: 1 } as Field;
    case 'allow':
      return { type: 'custom', label, render: opts.allow } as Field;
    case 'tracks':
      return { type: 'custom', label, render: opts.tracks, metadata: { blockField: { kind: 'tracks', max: 12 } } } as Field;
    case 'length':
      return { type: 'custom', label, render: opts.length } as Field;
    case 'responsiveSelect':
      return {
        type: 'custom',
        label,
        render: opts.responsiveSelect,
        metadata: { options: (p.options ?? []).map((v) => ({ label: valueLabel(v), value: String(v) })), ...(p.numeric ? { numeric: true } : {}) },
      } as Field;
    case 'pattern':
      return { type: 'custom', label, render: opts.pattern, metadata: { pattern: p.pattern ?? 'anchor', required: p.pattern === 'name' } } as Field;
    case 'action':
      return { type: 'custom', label, render: opts.action } as Field;
    case 'regionLabel':
      return { type: 'custom', label, render: opts.regionLabel } as Field;
    case 'options':
      return { type: 'custom', label, render: opts.options } as Field;
    case 'icon':
      return { type: 'custom', label, render: opts.icon, metadata: { icon: true, optional: p.optional === true } } as Field;
    case 'name':
      return { type: 'custom', label, render: opts.pattern, metadata: { pattern: 'control', required: true } } as Field;
  }
}

/** Puck `fields` of one element: sources first, then the token props, show-if, style and the children slot. */
export function elementFields(el: ComposedElement, opts: BuilderConfigOptions): Record<string, Field> {
  const out: Record<string, Field> = {};
  if (ELEMENT_BINDABLE[el].length) out.bind = { type: 'custom', label: t('blockBuilder.sources'), render: opts.sources, metadata: { el } } as Field;
  for (const p of ELEMENT_PROPS[el]) out[p.name] = propField(p, opts);
  const item = CHILD_ITEM[el];
  if (item) out.childItems = { type: 'custom', label: t(`blockBuilder.childItems.${item}.label`), render: opts.childItems, metadata: { item } } as Field;
  if (!NO_ANCHOR.includes(el)) out.anchorId = propField({ name: 'anchorId', kind: 'pattern', pattern: 'anchor' }, opts);
  if (!NO_SHOW_IF.includes(el)) out.showIf = { type: 'custom', label: t('blockBuilder.showIf.label'), render: opts.showIf, metadata: { el } } as Field;
  if (STYLE_SECTIONS[el].length) out.style = { type: 'custom', label: t('blockBuilder.style.title'), render: opts.style, metadata: { el } } as Field;
  if (isContainer(el)) out.children = { type: 'slot', ...slotRules(el, opts.collection) } as Field;
  return out;
}

/**
 * What a container's slot accepts. Accordion / Tabs take only their item element. Elsewhere it refuses `Overlay`
 * (only ever the root), the Accordion / Tabs items, Slot, the layout regions and Carousel in a collection item
 * template, the layout regions and the interactive containers directly in the overlay frame, a Dropdown and the
 * layout regions in a Dropdown, and Tooltip / Dropdown / form controls in a Tooltip (spec §1 rules).
 */
export function slotRules(el: ComposedElement, collection: boolean): { allow?: string[]; disallow?: string[] } {
  const item = CHILD_ITEM[el];
  if (item) return { allow: [item] };
  const out: string[] = collection ? ['Slot', ...REGION_ELEMENTS, 'Overlay', 'Carousel'] : ['Overlay'];
  const add = (els: readonly string[]) => {
    for (const e of els) if (!out.includes(e)) out.push(e);
  };
  add(ITEM_ELEMENTS);
  if (el === 'Overlay') add([...REGION_ELEMENTS, ...INTERACTIVE_CONTAINERS]);
  if (el === 'Dropdown') add(['Dropdown', ...REGION_ELEMENTS]);
  if (el === 'Tooltip') add(['Tooltip', 'Dropdown', ...FORM_CONTROL_ELEMENTS]);
  // Templates: refused when their root breaks a direct-child rule or they contain an element refused at any depth.
  const deep: string[] = [...(collection ? ['Slot', ...REGION_ELEMENTS, 'Carousel'] : []), ...(el === 'Dropdown' ? ['Dropdown'] : [])];
  add(templatesRefused(out, deep));
  return { disallow: out };
}

export interface PaletteState {
  /** Collection mode: no Slot; Region / Page content shown but not insertable. */
  collection: boolean;
  /** The block is an overlay: the layout regions are hidden. */
  overlayRoot: boolean;
  /** Nothing designed yet: Overlay is offered as a starting point. */
  emptyRoot: boolean;
}

type PaletteCategory = { title?: string; components: string[]; visible?: boolean };

/** Template component names offered in the palette. */
function templateNames(collection: boolean): string[] {
  const refused = collection ? templatesRefused([], ['Slot', ...REGION_ELEMENTS, 'Carousel']) : [];
  return BUILDER_TEMPLATES.map((tpl) => templateName(tpl.id)).filter((n) => !refused.includes(n));
}

/** The palette (Puck categories) for the block's current state. */
export function paletteCategories(
  s: PaletteState,
): Record<'layout' | 'content' | 'interactive' | 'form' | 'templates' | 'regions' | 'overlay', PaletteCategory> & { other: { visible: false } } {
  const layout = s.collection ? LAYOUT_ELEMENTS.filter((e) => e !== 'Slot') : LAYOUT_ELEMENTS;
  // No Carousel in a collection item template (spec §1 rules).
  const interactive = s.collection ? INTERACTIVE_PALETTE.filter((e) => e !== 'Carousel') : INTERACTIVE_PALETTE;
  return {
    layout: { title: t('blockBuilder.categories.layout'), components: [...layout] },
    content: { title: t('blockBuilder.categories.content'), components: [...CONTENT_ELEMENTS] },
    interactive: { title: t('blockBuilder.categories.interactive'), components: [...interactive] },
    form: { title: t('blockBuilder.categories.form'), components: [...FORM_PALETTE] },
    // Starter templates (spec §3); no banner carousel in a collection item template.
    templates: { title: t('blockBuilder.categories.templates'), components: templateNames(s.collection) },
    regions: { title: t('blockBuilder.categories.regions'), components: [...REGION_ELEMENTS], visible: !s.overlayRoot },
    overlay: { title: t('blockBuilder.categories.overlay'), components: ['Overlay'], visible: s.emptyRoot && !s.overlayRoot },
    other: { visible: false },
  };
}

/** Item props with the old token props migrated (`padding: undefined` / `count: undefined` drop them in Puck's merge). */
export function migrateItemProps(el: ComposedElement, props: Record<string, unknown>): Record<string, unknown> | null {
  if (!hasLegacyProps(el, props)) return null;
  const { style, ...rest } = props;
  const m = migrateLegacyProps(el, rest, style as NodeStyle | undefined);
  const out: Record<string, unknown> = { ...m.props, ...(m.style ? { style: m.style } : {}) };
  for (const k of Object.keys(rest)) if (!(k in m.props)) out[k] = undefined;
  return out;
}

/**
 * Props the builder sets itself: a new Region gets a free name; an Overlay turned into a drawer is pinned right and
 * a modal drops its `side` (only valid on a drawer).
 */
function ownChange(
  el: ComposedElement, props: Record<string, unknown>, prev: Record<string, unknown> | undefined, trigger: string, opts: BuilderConfigOptions,
): Record<string, unknown> | null {
  if (el === 'Region' && trigger === 'insert' && opts.regionNames) {
    const base = typeof props.name === 'string' && props.name ? props.name : REGION_DEFAULT_NAME;
    const name = uniqueRegionName(base, opts.regionNames(String(props.id ?? '')));
    return name === props.name ? null : { name };
  }
  if (el === 'Overlay' && trigger !== 'load') {
    if (props.variant === 'drawer' && props.side === undefined) return { side: 'right' };
    if (props.variant !== 'drawer' && props.side !== undefined) return { side: undefined };
  }
  if (trigger === 'load') return null;
  const out: Record<string, unknown> = {};
  // An emptied optional select / text drops the prop (the schema refuses empty values).
  for (const p of ELEMENT_PROPS[el]) if (p.optional && props[p.name] === '') out[p.name] = undefined;
  // A default value that is no longer one of the options is dropped.
  if (typeof props.defaultValue === 'string' && props.defaultValue && !optionValues(props.options).includes(props.defaultValue)) out.defaultValue = undefined;
  return Object.keys(out).length ? out : null;
}

/** The choices of a form control's `defaultValue`: none, then the current option values. */
function defaultValueField(field: Field, props: Record<string, unknown>): Field {
  const options = [{ label: t('blockBuilder.none'), value: '' }, ...optionValues(props.options).map((v) => ({ label: v, value: v }))];
  return { ...field, options } as Field;
}

/** The Puck config of the builder canvas. */
export function buildBuilderConfig(opts: BuilderConfigOptions): Config {
  const components: Record<string, ComponentConfig> = {};
  for (const el of COMPOSED_ELEMENTS) {
    components[el] = {
      label: elementLabel(el),
      fields: elementFields(el, opts) as never,
      defaultProps: structuredClone(ELEMENT_DEFAULTS[el] ?? {}),
      render: opts.render(el) as never,
      inline: true,
      // `count` (legacy Columns) is a field only while the node still has it.
      ...(opts.collection && REGION_ELEMENTS.includes(el) ? { permissions: { insert: false } } : {}),
      resolveFields: (data: { props: Record<string, unknown> }, params: { fields: Record<string, Field> }) => {
        // Overlay `side` applies to a drawer only.
        if (el === 'Overlay' && data.props.variant !== 'drawer') {
          const { side: _side, ...rest } = params.fields;
          return rest;
        }
        if (params.fields.defaultValue) return { ...params.fields, defaultValue: defaultValueField(params.fields.defaultValue, data.props) };
        if (el !== 'Columns' || data.props.count !== undefined) return params.fields;
        const { count: _count, ...rest } = params.fields;
        return rest;
      },
      resolveData: (data: { props: Record<string, unknown> }, params: { lastData: { props: Record<string, unknown> } | null; trigger: string }) => {
        // The first change of an item (not the load) turns its old token props into style/tracks.
        const migrated = params.trigger === 'load' ? null : migrateItemProps(el, data.props);
        let props = migrated ? { ...data.props, ...migrated } : data.props;
        const own = ownChange(el, props, params.lastData?.props, params.trigger, opts);
        if (own) props = { ...props, ...own };
        const extra = opts.onPropsChange?.(el, props, params.lastData?.props, params.trigger) ?? null;
        if (extra) props = { ...props, ...extra };
        return props === data.props ? data : { ...data, props };
      },
    } as ComponentConfig;
  }
  // Starter templates: the root element's config with the template (text in the admin locale) as default props. The
  // inserted item becomes that element in the builder's onChange (`expandTemplates`).
  const locale = getActiveLocale();
  for (const tpl of BUILDER_TEMPLATES) {
    const tree = tpl.tree(locale);
    components[templateName(tpl.id)] = { ...components[tree.el]!, label: t(tpl.label), defaultProps: templatePuckProps(tree) } as ComponentConfig;
  }
  return {
    components,
    categories: paletteCategories({ collection: opts.collection, overlayRoot: false, emptyRoot: false, ...opts.palette }),
    root: { fields: {}, render: opts.root as never },
  } as Config;
}

const ROOT_ZONE = 'root:default-zone';

/** Whether the slot of container `el` takes component `name` (an element or a template). */
function slotTakes(el: ComposedElement, name: string, collection: boolean): boolean {
  const r = slotRules(el, collection);
  return r.allow ? r.allow.includes(name) : !(r.disallow ?? []).includes(name);
}

/**
 * Where Enter in the palette search inserts `name`: the end of the selected container, or of the nearest container
 * around the selection that takes it; with nothing selected (or none taking it) the end of the root container, else
 * next to the root at the top level.
 */
export function paletteInsertTarget(data: BuilderPuckData, selectedId: string | null, name: string, collection: boolean): { zone: string; index: number } {
  const index = indexPuck(data);
  const top = Array.isArray(data.content) ? data.content : [];
  const candidates = pathOf(index, selectedId);
  if (top.length === 1 && !candidates.includes(String(top[0]!.props.id))) candidates.push(String(top[0]!.props.id));
  for (const id of candidates) {
    const it = index.get(id)!.item;
    const el = (templateRootEl(it.type) ?? it.type) as ComposedElement;
    if (!isContainer(el) || !slotTakes(el, name, collection)) continue;
    const kids = Array.isArray(it.props.children) ? it.props.children : [];
    return { zone: `${id}:children`, index: kids.length };
  }
  return { zone: ROOT_ZONE, index: top.length };
}

/** The palette search model of the Block builder: elements and templates, Enter inserts as `paletteInsertTarget`. */
export function blockBuilderPalette(categories: Record<string, SearchCategory>, collection: boolean): PaletteModel {
  return {
    categories,
    label: t('paletteSearch.labelBlockBuilder'),
    describe: (name) => {
      const tpl = templateOf(name);
      if (tpl) return { label: t(tpl.label), english: tEnglish(tpl.label) };
      const key = `blockBuilder.elements.${name}`;
      return { label: elementLabel(name), english: tEnglish(key) === key ? name : tEnglish(key) };
    },
    insert: (name, get) => {
      const api = get();
      const selected = (api.selectedItem?.props as { id?: string } | undefined)?.id ?? null;
      insertAndSelect(get, name, paletteInsertTarget(api.appState.data as unknown as BuilderPuckData, selected, name, collection));
    },
  };
}
