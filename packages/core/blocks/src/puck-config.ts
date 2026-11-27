import { createElement, Fragment, isValidElement, type ComponentType, type ReactElement } from 'react';
import type { ComponentConfig, Field } from '@puckeditor/core';
import { localizedText, type Locale } from '@opencloudcms/schema';
import { MAX_TRACKS } from './tracks';
import { fieldsDefaults, optionValue } from './fields';
import {
  COLOR_TOKENS,
  SPACING_TOKENS,
  type BlockDefinition,
  type BlockField,
  type BlockRegistry,
  type CustomFieldRenderers,
  type Label,
  type OptionValue,
  type PuckConfig,
  type SelectOption,
} from './types';

/**
 * Puck data format stored in `content.formatVersion`: the minor of the pinned `@puckeditor/core` 0.x
 * (0.24.1 → 24). Bump together with the dependency (and ship a data migration if the format changed).
 */
export const PUCK_FORMAT_VERSION = 24;

const BOOLEAN_LABELS: Record<Locale, [string, string]> = {
  'en-US': ['Yes', 'No'],
  'vi-VN': ['Có', 'Không'],
  'fr-FR': ['Oui', 'Non'],
  'id-ID': ['Ya', 'Tidak'],
};

export type ToPuckConfigOptions = { locale: Locale; customFields: CustomFieldRenderers };

function toOptions(options: readonly SelectOption<OptionValue>[], locale: Locale) {
  return options.map((o) => {
    const value = optionValue(o);
    const label = typeof o === 'object' && o !== null ? localizedText(o.label, locale, String(value)) : String(value);
    return { label, value };
  });
}

/** Presets of the plain `b.tracks` fallback select: [label, ...fr per column]; stored as `{ base: ['1fr'], md: [...] }`. */
const TRACK_PRESETS: readonly [string, ...number[]][] = [
  ['1:1', 1, 1], ['1:2', 1, 2], ['2:1', 2, 1], ['1:1:1', 1, 1, 1], ['1:2:1', 1, 2, 1], ['1:1:1:1', 1, 1, 1, 1],
];

const tokens = (list: readonly string[]) => list.map((t) => ({ label: t, value: t }));

function toPuckField(f: BlockField, opts: ToPuckConfigOptions): Field | null {
  const { locale, customFields } = opts;
  const label = f.label === undefined ? undefined : localizedText(f.label as Label, locale);
  const base = label === undefined ? {} : { label };
  switch (f.kind) {
    case 'text':
      return { ...base, type: 'text', ...(f.placeholder ? { placeholder: f.placeholder } : {}) };
    case 'longText':
      return { ...base, type: 'textarea', ...(f.placeholder ? { placeholder: f.placeholder } : {}) };
    case 'richText':
      return { ...base, type: 'richtext' };
    case 'number': {
      const { min, max, step } = f;
      return {
        ...base,
        type: 'number',
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
      };
    }
    case 'boolean': {
      const [yes, no] = BOOLEAN_LABELS[locale] ?? BOOLEAN_LABELS['en-US'];
      return { ...base, type: 'radio', options: [{ label: yes, value: true }, { label: no, value: false }] };
    }
    case 'select':
    case 'radio':
      return { ...base, type: f.kind, options: toOptions(f.options, locale) };
    case 'color':
      return { ...base, type: 'select', options: tokens(COLOR_TOKENS) };
    case 'spacing':
      return { ...base, type: 'select', options: tokens(SPACING_TOKENS) };
    case 'tracks':
      if (customFields.tracks) return { ...base, type: 'custom', render: customFields.tracks as never, metadata: { blockField: f } };
      return {
        ...base,
        type: 'select',
        options: [
          { label: 'Default', value: null },
          ...TRACK_PRESETS.map(([label, ...fr]) => ({
            label,
            value: { base: ['1fr'], md: fr.map((n) => `${n}fr`) },
          })),
        ].filter((o) => o.value === null || (o.value.md.length <= (f.max ?? MAX_TRACKS))) as never,
      };
    case 'link':
    case 'image':
    case 'entry':
    case 'entries':
      return { ...base, type: 'custom', render: customFields[f.kind] as never, metadata: { blockField: f } };
    case 'list': {
      const arrayFields = toPuckFields(f.fields as Record<string, BlockField>, opts);
      const firstText = Object.entries(f.fields as Record<string, BlockField>).find(([, s]) => s.kind === 'text')?.[0];
      return {
        ...base,
        type: 'array',
        arrayFields,
        defaultItemProps: fieldsDefaults(f.fields),
        getItemSummary: (item: Record<string, unknown>, index?: number) =>
          (firstText && typeof item?.[firstText] === 'string' && (item[firstText] as string)) || `#${(index ?? 0) + 1}`,
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
      };
    }
    case 'slot':
      return { ...base, type: 'slot', ...(f.allow ? { allow: f.allow } : {}), metadata: { blockField: f } };
    case 'action':
      return customFields.action ? { ...base, type: 'custom', render: customFields.action as never, metadata: { blockField: f } } : null;
  }
}

/** Puck fields of `fields`; fields with no editor (`b.action` without its renderer) are left out. */
function toPuckFields(fields: Record<string, BlockField>, opts: ToPuckConfigOptions): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const [k, f] of Object.entries(fields)) {
    const pf = toPuckField(f, opts);
    if (pf) out[k] = pf;
  }
  return out;
}

/**
 * Puck passes each slot as a component; blocks receive it rendered (ReactNode). Same inside list rows. A slot value that
 * is already a React element (a caller rendering the block outside Puck, e.g. the editor's base frame) is kept.
 */
function toRenderProps(fields: Record<string, BlockField>, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    const v = props[k];
    if (f.kind === 'slot') {
      out[k] = typeof v === 'function' ? createElement(v as ComponentType) : isValidElement(v) ? v : null;
    } else if (f.kind === 'list' && Array.isArray(v)) {
      out[k] = v.map((row) =>
        row && typeof row === 'object' ? toRenderProps(f.fields, row as Record<string, unknown>) : row,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Reserved props of composed (and `usesLocale`) blocks: `_locale` stamped by `resolvePage`/the canvas (else the config's locale),
 * `_editor` (canvas flag, or Puck's `isEditing`) and, when stamped, `_detailPaths`.
 */
function composedReserved(props: Record<string, unknown>, locale: Locale): Record<string, unknown> {
  const puck = props.puck as { isEditing?: unknown } | undefined;
  const detailPaths = props._detailPaths;
  return {
    _locale: typeof props._locale === 'string' && props._locale ? props._locale : locale,
    _editor: props._editor === true || puck?.isEditing === true,
    // Stamped by `resolvePage` for blocks with `detailLinks` (entry links through detail pages).
    ...(detailPaths && typeof detailPaths === 'object' && !Array.isArray(detailPaths) ? { _detailPaths: detailPaths } : {}),
  };
}

/**
 * Props `d.render` receives for the Puck props `props`, exactly as the Puck config's render builds them: slots rendered
 * (functions as components, React elements kept), list rows mapped, and for composed / `usesLocale` blocks the reserved
 * `_locale` / `_editor` props (`locale` when `_locale` is not stamped).
 */
export function blockRenderProps(d: Pick<BlockDefinition<any>, 'fields' | 'composed' | 'usesLocale'>, props: Record<string, unknown>, locale: Locale): Record<string, unknown> {
  return d.composed || d.usesLocale ? { ...toRenderProps(d.fields, props), ...composedReserved(props, locale) } : toRenderProps(d.fields, props);
}

/** Puck `Config` for the editor and renderer. Labels are resolved for `locale` (en-US fallback). */
export function toPuckConfig(r: BlockRegistry, opts: ToPuckConfigOptions): PuckConfig {
  const components: Record<string, ComponentConfig> = {};
  const categories: Record<string, { title: string; components: string[] }> = {};
  for (const d of r.list) {
    const fields = toPuckFields(d.fields as Record<string, BlockField>, opts);
    components[d.name] = {
      label: localizedText(d.label, opts.locale, d.name),
      fields,
      defaultProps: fieldsDefaults(d.fields),
      render: ((props: Record<string, unknown>): ReactElement =>
        createElement(
          Fragment,
          null,
          d.render(blockRenderProps(d, props, opts.locale) as never),
        )) as never,
    };
    (categories[d.category] ??= { title: d.category, components: [] }).components.push(d.name);
  }
  return { components, categories } as PuckConfig;
}
