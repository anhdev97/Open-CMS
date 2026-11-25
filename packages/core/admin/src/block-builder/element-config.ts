// Puck config of the block builder: one component per design-system element (spec §5.3), its design-token props,
// a sources field for the bindable props, a show-if field, a `style` field and, for containers, a `children` slot.
// Relative imports only (root vitest).
import type { ComponentConfig, Config, CustomFieldRender, Field } from '@puckeditor/core';
import { COLOR_TOKENS, SPACING_TOKENS } from '@opencloudcms/core/blocks';
import { COMPOSED_ELEMENTS, ELEMENT_BINDABLE, type ComposedElement, type NodeStyle } from '@opencloudcms/schema';
import type { ReactElement, ReactNode } from 'react';
import { t } from '../i18n';
import { hasLegacyProps, migrateLegacyProps } from './style/migrate';
import { isContainer, uniqueRegionName } from './tree-puck';

export type PropKind =
  | 'color' | 'spacing' | 'select' | 'boolean' | 'text' | 'number' | 'allow' | 'tracks' | 'length' | 'responsiveSelect' | 'pattern' | 'action';
export interface PropDef {
  name: string;
  kind: PropKind;
  options?: readonly (string | number)[];
  /** `pattern` props: `name` (Region/overlay names) or `anchor` (`anchorId`, scroll targets). */
  pattern?: 'name' | 'anchor';
  /** Label key under `blockBuilder.props` when it differs from `name`. */
  labelKey?: string;
}

const spacing = (name: string): PropDef => ({ name, kind: 'spacing' });
const color = (name: string): PropDef => ({ name, kind: 'color' });
const select = (name: string, options: readonly (string | number)[]): PropDef => ({ name, kind: 'select', options });
const perBreakpoint = (name: string, options: readonly string[]): PropDef => ({ name, kind: 'responsiveSelect', options });
const ALIGN = ['start', 'center', 'end', 'stretch'] as const;

/**
 * The fixed (design-token and layout) props of each element, in panel order. Values match the `ui` primitives' lookup
 * tables. Box/Card `padding` and `background` are edited in the style panel; Columns `count` only shows while a node
 * still has it (it becomes `tracks` on the first change).
 */
export const ELEMENT_PROPS: Record<ComposedElement, readonly PropDef[]> = {
  Box: [],
  Stack: [
    perBreakpoint('direction', ['vertical', 'horizontal']), spacing('gap'), perBreakpoint('align', ALIGN),
    select('justify', ['start', 'center', 'end', 'between']), { name: 'wrap', kind: 'boolean' },
  ],
  Columns: [
    select('count', [2, 3, 4]), { name: 'tracks', kind: 'tracks' }, select('alignY', ALIGN), spacing('gap'),
    { name: 'gapX', kind: 'length' }, { name: 'gapY', kind: 'length' },
  ],
  Grid: [select('columns', [2, 3, 4, 5, 6]), spacing('gap')],
  Card: [{ name: 'bordered', kind: 'boolean' }],
  Slot: [{ name: 'allow', kind: 'allow' }, { name: 'max', kind: 'number' }],
  Heading: [select('level', [1, 2, 3, 4]), select('align', ['left', 'center', 'right'])],
  Text: [select('size', ['sm', 'base', 'lg']), color('color')],
  Image: [
    select('ratio', ['auto', 'square', 'video', 'wide']), { name: 'rounded', kind: 'boolean' }, select('fit', ['cover', 'contain']),
    perBreakpoint('aspect', ['auto', 'square', 'video', '3/2', '4/3', 'wide']),
  ],
  Button: [
    select('variant', ['default', 'secondary', 'outline', 'ghost', 'link']), select('size', ['sm', 'default', 'lg']), { name: 'action', kind: 'action' },
  ],
  Badge: [select('variant', ['default', 'secondary', 'outline', 'destructive'])],
  Price: [{ name: 'showCurrency', kind: 'boolean' }],
  Date: [select('format', ['short', 'long']), { name: 'timeZone', kind: 'text' }],
  Divider: [],
  Spacer: [spacing('size')],
  Region: [{ name: 'name', kind: 'pattern', pattern: 'name' }, { name: 'label', kind: 'text', labelKey: 'regionLabel' }, { name: 'allow', kind: 'allow' }],
  PageContent: [],
  Overlay: [
    { ...select('variant', ['modal', 'drawer']), labelKey: 'overlayVariant' }, select('side', ['left', 'right', 'top', 'bottom']),
    select('size', ['sm', 'md', 'lg', 'xl', 'full']), { name: 'closeOnBackdrop', kind: 'boolean' }, { name: 'showClose', kind: 'boolean' },
  ],
};

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
};

export type StyleSection = 'layout' | 'spacing' | 'margin' | 'size' | 'maxWidth' | 'colors' | 'textColor' | 'visibility' | 'span';

const BOX: StyleSection[] = ['spacing', 'size', 'maxWidth', 'colors', 'visibility', 'span'];
const TEXT: StyleSection[] = ['margin', 'maxWidth', 'textColor', 'visibility', 'span'];
const MEDIA: StyleSection[] = ['margin', 'size', 'visibility', 'span'];
const PLAIN: StyleSection[] = ['margin', 'visibility', 'span'];

/**
 * Style sections of each element (spec "Rendering" table). `layout` marks elements whose layout props (tracks,
 * direction, gaps…) are element fields shown above the style panel; `span` is shown when the parent is Columns or Grid.
 */
export const STYLE_SECTIONS: Record<ComposedElement, readonly StyleSection[]> = {
  Box: BOX, Card: BOX,
  Stack: ['layout', ...BOX], Columns: ['layout', ...BOX], Grid: ['layout', ...BOX],
  Image: MEDIA,
  Button: ['margin', 'size', 'colors', 'visibility', 'span'],
  Badge: ['margin', 'size', 'textColor', 'visibility', 'span'],
  Heading: TEXT, Text: TEXT, Price: TEXT, Date: TEXT,
  Divider: PLAIN, Spacer: PLAIN, Slot: PLAIN,
  // Regions render their page blocks only; the overlay frame has no visibility or span (size per variant/side).
  Region: [], PageContent: [], Overlay: ['spacing', 'size', 'colors'],
};

export const LAYOUT_ELEMENTS: readonly ComposedElement[] = ['Box', 'Stack', 'Columns', 'Grid', 'Card', 'Slot'];
/** Elements of layout blocks (base pages): offered unless the block is an overlay. */
export const REGION_ELEMENTS: readonly ComposedElement[] = ['Region', 'PageContent'];
export const CONTENT_ELEMENTS: readonly ComposedElement[] = COMPOSED_ELEMENTS.filter(
  (e) => !LAYOUT_ELEMENTS.includes(e) && !REGION_ELEMENTS.includes(e) && e !== 'Overlay',
);

/** Translated label, or `fallback` when the key is missing. */
export function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

export const elementLabel = (el: string) => tr(`blockBuilder.elements.${el}`, el);
export const propLabel = (name: string) => tr(`blockBuilder.props.${name}`, name);
const valueLabel = (v: string | number) => tr(`blockBuilder.values.${v}`, String(v));

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
      return { type: 'select', label, options: (p.options ?? []).map((v) => ({ label: valueLabel(v), value: v })) } as Field;
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
      return { type: 'custom', label, render: opts.responsiveSelect, metadata: { options: (p.options ?? []).map((v) => ({ label: valueLabel(v), value: String(v) })) } } as Field;
    case 'pattern':
      return { type: 'custom', label, render: opts.pattern, metadata: { pattern: p.pattern ?? 'anchor', required: p.pattern === 'name' } } as Field;
    case 'action':
      return { type: 'custom', label, render: opts.action } as Field;
  }
}

/** Puck `fields` of one element: sources first, then the token props, show-if, style and the children slot. */
export function elementFields(el: ComposedElement, opts: BuilderConfigOptions): Record<string, Field> {
  const out: Record<string, Field> = {};
  if (ELEMENT_BINDABLE[el].length) out.bind = { type: 'custom', label: t('blockBuilder.sources'), render: opts.sources, metadata: { el } } as Field;
  for (const p of ELEMENT_PROPS[el]) out[p.name] = propField(p, opts);
  if (!NO_ANCHOR.includes(el)) out.anchorId = propField({ name: 'anchorId', kind: 'pattern', pattern: 'anchor' }, opts);
  if (!NO_SHOW_IF.includes(el)) out.showIf = { type: 'custom', label: t('blockBuilder.showIf.label'), render: opts.showIf, metadata: { el } } as Field;
  if (STYLE_SECTIONS[el].length) out.style = { type: 'custom', label: t('blockBuilder.style.title'), render: opts.style, metadata: { el } } as Field;
  if (isContainer(el)) out.children = { type: 'slot', disallow: slotDisallow(el, opts.collection) } as Field;
  return out;
}

/**
 * Elements a container's slot refuses: `Overlay` everywhere (it is only ever the root), Slot and the layout regions
 * in a collection item template, and the layout regions inside the overlay frame.
 */
function slotDisallow(el: ComposedElement, collection: boolean): string[] {
  const out: string[] = collection ? ['Slot', ...REGION_ELEMENTS, 'Overlay'] : ['Overlay'];
  if (el === 'Overlay') for (const r of REGION_ELEMENTS) if (!out.includes(r)) out.push(r);
  return out;
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

/** The palette (Puck categories) for the block's current state. */
export function paletteCategories(s: PaletteState): Record<'layout' | 'content' | 'regions' | 'overlay', PaletteCategory> & { other: { visible: false } } {
  const layout = s.collection ? LAYOUT_ELEMENTS.filter((e) => e !== 'Slot') : LAYOUT_ELEMENTS;
  return {
    layout: { title: t('blockBuilder.categories.layout'), components: [...layout] },
    content: { title: t('blockBuilder.categories.content'), components: [...CONTENT_ELEMENTS] },
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
  return null;
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
  return {
    components,
    categories: paletteCategories({ collection: opts.collection, overlayRoot: false, emptyRoot: false, ...opts.palette }),
    root: { fields: {}, render: opts.root as never },
  } as Config;
}
