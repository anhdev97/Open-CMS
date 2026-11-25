import { createElement, Fragment, type ComponentType, type ReactElement } from 'react';
import type { ComponentConfig, Field } from '@puckeditor/core';
import { localizedText, type Locale } from '@opencloudcms/schema';
import { MAX_TRACKS } from './tracks';
import { fieldsDefaults, optionValue } from './fields';
import {
  COLOR_TOKENS,
  SPACING_TOKENS,
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

function toPuckField(f: BlockField, opts: ToPuckConfigOptions): Field {
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
      const arrayFields: Record<string, Field> = {};
      for (const [k, sub] of Object.entries(f.fields as Record<string, BlockField>)) arrayFields[k] = toPuckField(sub, opts);
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
  }
}

/** Puck passes each slot as a component; blocks receive it rendered (ReactNode). Same inside list rows. */
function toRenderProps(fields: Record<string, BlockField>, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    const v = props[k];
    if (f.kind === 'slot') {
      out[k] = typeof v === 'function' ? createElement(v as ComponentType) : null;
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
 * Reserved props of composed (and `usesLocale`) blocks: `_locale` stamped by `resolvePage`/the canvas (else the config's locale) and
 * `_editor` (canvas flag, or Puck's `isEditing`).
 */
function composedReserved(props: Record<string, unknown>, locale: Locale): Record<string, unknown> {
  const puck = props.puck as { isEditing?: unknown } | undefined;
  return {
    _locale: typeof props._locale === 'string' && props._locale ? props._locale : locale,
    _editor: props._editor === true || puck?.isEditing === true,
  };
}

/** Puck `Config` for the editor and renderer. Labels are resolved for `locale` (en-US fallback). */
export function toPuckConfig(r: BlockRegistry, opts: ToPuckConfigOptions): PuckConfig {
  const components: Record<string, ComponentConfig> = {};
  const categories: Record<string, { title: string; components: string[] }> = {};
  for (const d of r.list) {
    const fields: Record<string, Field> = {};
    for (const [k, f] of Object.entries(d.fields as Record<string, BlockField>)) fields[k] = toPuckField(f, opts);
    components[d.name] = {
      label: localizedText(d.label, opts.locale, d.name),
      fields,
      defaultProps: fieldsDefaults(d.fields),
      render: ((props: Record<string, unknown>): ReactElement =>
        createElement(
          Fragment,
          null,
          d.render((d.composed || d.usesLocale ? { ...toRenderProps(d.fields, props), ...composedReserved(props, opts.locale) } : toRenderProps(d.fields, props)) as never),
        )) as never,
    };
    (categories[d.category] ??= { title: d.category, components: [] }).components.push(d.name);
  }
  return { components, categories } as PuckConfig;
}
