// Puck config of the block builder: one component per design-system element (spec §5.3), its design-token props,
// a sources field for the bindable props, a show-if field and, for containers, a `children` slot.
// Relative imports only (root vitest).
import type { ComponentConfig, Config, CustomFieldRender, Field } from '@puckeditor/core';
import { COLOR_TOKENS, SPACING_TOKENS } from '@opencloudcms/core/blocks';
import { COMPOSED_ELEMENTS, ELEMENT_BINDABLE, type ComposedElement } from '@opencloudcms/schema';
import type { ReactElement, ReactNode } from 'react';
import { t } from '../i18n';
import { isContainer } from './tree-puck';

export type PropKind = 'color' | 'spacing' | 'select' | 'boolean' | 'text' | 'number' | 'allow';
export interface PropDef {
  name: string;
  kind: PropKind;
  options?: readonly (string | number)[];
}

const spacing = (name: string): PropDef => ({ name, kind: 'spacing' });
const color = (name: string): PropDef => ({ name, kind: 'color' });
const select = (name: string, options: readonly (string | number)[]): PropDef => ({ name, kind: 'select', options });

/** The fixed (design-token) props of each element, in panel order. Values match the `ui` primitives' lookup tables. */
export const ELEMENT_PROPS: Record<ComposedElement, readonly PropDef[]> = {
  Box: [spacing('padding'), color('background')],
  Stack: [select('direction', ['vertical', 'horizontal']), spacing('gap'), select('align', ['start', 'center', 'end', 'stretch'])],
  Columns: [select('count', [2, 3, 4]), spacing('gap')],
  Grid: [select('columns', [2, 3, 4, 5, 6]), spacing('gap')],
  Card: [spacing('padding'), color('background'), { name: 'bordered', kind: 'boolean' }],
  Slot: [{ name: 'allow', kind: 'allow' }, { name: 'max', kind: 'number' }],
  Heading: [select('level', [1, 2, 3, 4]), select('align', ['left', 'center', 'right'])],
  Text: [select('size', ['sm', 'base', 'lg']), color('color')],
  Image: [select('ratio', ['auto', 'square', 'video', 'wide']), { name: 'rounded', kind: 'boolean' }],
  Button: [select('variant', ['default', 'secondary', 'outline', 'ghost', 'link']), select('size', ['sm', 'default', 'lg'])],
  Badge: [select('variant', ['default', 'secondary', 'outline', 'destructive'])],
  Price: [{ name: 'showCurrency', kind: 'boolean' }],
  Date: [select('format', ['short', 'long']), { name: 'timeZone', kind: 'text' }],
  Divider: [],
  Spacer: [spacing('size')],
};

/** Props of a freshly dropped element (what its render needs, plus visible placeholder text). */
export const ELEMENT_DEFAULTS: Partial<Record<ComposedElement, Record<string, unknown>>> = {
  Stack: { direction: 'vertical' },
  Columns: { count: 2 },
  Grid: { columns: 3 },
  Heading: { level: 2, bind: { text: { from: 'const', value: 'Heading' } } },
  Text: { bind: { text: { from: 'const', value: 'Text' } } },
  Button: { bind: { label: { from: 'const', value: 'Button' } } },
  Badge: { bind: { text: { from: 'const', value: 'Badge' } } },
  Date: { timeZone: 'UTC' },
  Spacer: { size: '8' },
};

export const LAYOUT_ELEMENTS: readonly ComposedElement[] = ['Box', 'Stack', 'Columns', 'Grid', 'Card', 'Slot'];
export const CONTENT_ELEMENTS: readonly ComposedElement[] = COMPOSED_ELEMENTS.filter((e) => !LAYOUT_ELEMENTS.includes(e));

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
  /** Canvas render of an element. */
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
  const label = propLabel(p.name);
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
  }
}

/** Puck `fields` of one element: sources first, then the token props, show-if and the children slot. */
export function elementFields(el: ComposedElement, opts: BuilderConfigOptions): Record<string, Field> {
  const out: Record<string, Field> = {};
  if (ELEMENT_BINDABLE[el].length) out.bind = { type: 'custom', label: t('blockBuilder.sources'), render: opts.sources, metadata: { el } } as Field;
  for (const p of ELEMENT_PROPS[el]) out[p.name] = propField(p, opts);
  if (el !== 'Slot') out.showIf = { type: 'custom', label: t('blockBuilder.showIf.label'), render: opts.showIf, metadata: { el } } as Field;
  if (isContainer(el)) out.children = { type: 'slot', ...(opts.collection ? { disallow: ['Slot'] } : {}) } as Field;
  return out;
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
      ...(opts.onPropsChange
        ? {
            resolveData: (data: { props: Record<string, unknown> }, params: { lastData: { props: Record<string, unknown> } | null; trigger: string }) => {
              const extra = opts.onPropsChange!(el, data.props, params.lastData?.props, params.trigger);
              return extra ? { ...data, props: { ...data.props, ...extra } } : data;
            },
          }
        : {}),
    } as ComponentConfig;
  }
  const layout = opts.collection ? LAYOUT_ELEMENTS.filter((e) => e !== 'Slot') : LAYOUT_ELEMENTS;
  return {
    components,
    categories: {
      layout: { title: t('blockBuilder.categories.layout'), components: [...layout] },
      content: { title: t('blockBuilder.categories.content'), components: [...CONTENT_ELEMENTS] },
      other: { visible: false },
    },
    root: { fields: {}, render: opts.root as never },
  } as Config;
}
