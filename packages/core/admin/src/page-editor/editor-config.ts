// Puck config of the page editor: `toPuckConfig` plus editor-only fields. Relative imports only (root vitest).
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import type { ComponentConfig, CustomFieldRender, Field } from '@puckeditor/core';
import type { Locale } from '@opencloudcms/schema';
import { toPuckConfig, type BlockField, type BlockRegistry, type CustomFieldRenderers, type PuckConfig } from '@opencloudcms/core/blocks';
import { t } from '../i18n';

type Render = (props: Record<string, unknown>) => ReactElement;

export interface EditorConfigOptions {
  locale: Locale;
  /** Renderers for link / image / entry / entries fields. */
  customFields: CustomFieldRenderers;
  /** Renderer for `b.color` / `b.spacing` (metadata.blockField has the kind). */
  token: CustomFieldRender<string>;
  /** Content type select for the sibling named by an entries field's `apiIdFrom` (metadata.contentTypeFor). */
  contentType: CustomFieldRender<string>;
  /** Canvas placeholder for a block that is no longer in the project. */
  unknown: (props: { name: string }) => ReactElement;
  /** Wraps each block's Puck render (the editor injects resolved data here). */
  wrapRender: (name: string, render: Render) => Render;
}

function editorFields(defs: Record<string, BlockField>, fields: Record<string, Field>, opts: EditorConfigOptions): Record<string, Field> {
  const out: Record<string, Field> = { ...fields };
  for (const [k, f] of Object.entries(defs)) {
    const label = (fields[k] as { label?: string } | undefined)?.label;
    const base = label === undefined ? {} : { label };
    if (f.kind === 'color' || f.kind === 'spacing') {
      out[k] = { ...base, type: 'custom', render: opts.token, metadata: { blockField: f } } as Field;
    } else if (f.kind === 'list') {
      const arr = fields[k] as Field & { arrayFields?: Record<string, Field> };
      if (arr?.arrayFields) out[k] = { ...arr, arrayFields: editorFields(f.fields as Record<string, BlockField>, arr.arrayFields, opts) } as Field;
    }
  }
  for (const [k, f] of Object.entries(defs)) {
    if (f.kind !== 'entries' || !f.apiIdFrom || defs[f.apiIdFrom]?.kind !== 'text') continue;
    const sibling = out[f.apiIdFrom] as { label?: string } | undefined;
    out[f.apiIdFrom] = {
      ...(sibling?.label === undefined ? {} : { label: sibling.label }),
      type: 'custom',
      render: opts.contentType,
      metadata: { blockField: defs[f.apiIdFrom], contentTypeFor: k },
    } as Field;
  }
  return out;
}

/** Root (page) fields: title, path and SEO, shown when no block is selected. */
function rootFields(): Record<string, Field> {
  return {
    title: { type: 'text', label: t('pageEditor.root.title') },
    path: { type: 'text', label: t('pageEditor.root.path') },
    seoTitle: { type: 'text', label: t('pageEditor.root.seoTitle') },
    seoDescription: { type: 'textarea', label: t('pageEditor.root.seoDescription') },
    seoNoindex: {
      type: 'radio',
      label: t('pageEditor.root.seoNoindex'),
      options: [
        { label: t('pageEditor.root.yes'), value: true },
        { label: t('pageEditor.root.no'), value: false },
      ],
    },
  };
}

/**
 * Editor config: every block of the registry (labels in `locale`, color/spacing as token pickers, the
 * `apiIdFrom` sibling as a content type select, renders wrapped), plus `unknownTypes` as delete-only
 * placeholders that the drawer never offers, and the page fields on the root.
 */
export function buildEditorConfig(registry: BlockRegistry, opts: EditorConfigOptions, unknownTypes: readonly string[]): PuckConfig {
  const base = toPuckConfig(registry, { locale: opts.locale, customFields: opts.customFields });
  const components: Record<string, ComponentConfig> = {};
  for (const d of registry.list) {
    const c = base.components[d.name] as ComponentConfig;
    components[d.name] = {
      ...c,
      fields: editorFields(d.fields as Record<string, BlockField>, (c.fields ?? {}) as Record<string, Field>, opts),
      render: opts.wrapRender(d.name, c.render as unknown as Render) as never,
    };
  }
  for (const name of unknownTypes) {
    if (registry.has(name)) continue;
    components[name] = {
      label: name,
      fields: {},
      permissions: { edit: false, duplicate: false, insert: false, delete: true, drag: true },
      render: (() => opts.unknown({ name })) as never,
    };
  }
  return {
    components,
    // Puck lists uncategorized components (the unknown placeholders) under `other`: hide it unless a project category uses that name.
    categories: { ...(base.categories ?? {}), ...(base.categories?.other ? {} : { other: { visible: false } }) },
    root: {
      fields: rootFields() as never,
      render: (({ children }: { children?: ReactNode }) => createElement(Fragment, null, children)) as never,
    },
  } as PuckConfig;
}
