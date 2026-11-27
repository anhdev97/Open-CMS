// Puck config of the page editor: `toPuckConfig` plus editor-only fields. Relative imports only (root vitest).
import { createElement, Fragment, type ComponentType, type ReactElement, type ReactNode } from 'react';
import type { ComponentConfig, CustomFieldRender, Field } from '@puckeditor/core';
import type { Locale, PageKind } from '@opencloudcms/schema';
import { toPuckConfig, type BlockField, type BlockRegistry, type CustomFieldRenderers, type PuckConfig } from '@opencloudcms/core/blocks';
import { t } from '../i18n';
import { type PaletteCategory, type PaletteModel } from '../components/PaletteSearch';
import { BASE_FIELD, ROOT_ZONE, basePageField, layoutBlockNames, pageRootResolveFields, regionLabel, regionSlotField, registryRegionNames, type BaseOption } from './base-fields';
import { OverlayChip, PageContentPlaceholder } from './BaseFrame';
import { REGION_PREFIX } from './field-logic';

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
  /** `base`: a base page (root: one layout block, title only). Default `page`. */
  kind?: PageKind;
  /** Pages: the base pages offered by the `Base page` root field. */
  bases?: readonly BaseOption[];
  /** Pages: region names of a base page (null when it cannot frame pages), for the region mode fields. */
  regionsOf?: (baseId: string) => Promise<string[] | null>;
  /** Pages: the root render around the page's drop zone (`BaseFrame`). */
  baseFrame?: ComponentType<any>;
}

function editorFields(defs: Record<string, BlockField>, fields: Record<string, Field>, opts: EditorConfigOptions, layouts: readonly string[]): Record<string, Field> {
  const out: Record<string, Field> = { ...fields };
  for (const [k, f] of Object.entries(defs)) {
    const label = (fields[k] as { label?: string } | undefined)?.label;
    const base = label === undefined ? {} : { label };
    if (f.kind === 'slot' && layouts.length && fields[k] && !(fields[k] as { allow?: unknown }).allow) {
      // Layout blocks only ever go at the root of a base page.
      out[k] = { ...fields[k], disallow: [...layouts] } as Field;
    } else if (f.kind === 'color' || f.kind === 'spacing') {
      out[k] = { ...base, type: 'custom', render: opts.token, metadata: { blockField: f } } as Field;
    } else if (f.kind === 'list') {
      const arr = fields[k] as Field & { arrayFields?: Record<string, Field> };
      if (arr?.arrayFields) out[k] = { ...arr, arrayFields: editorFields(f.fields as Record<string, BlockField>, arr.arrayFields, opts, layouts) } as Field;
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

/**
 * Root (page) fields, shown when no block is selected: title, path, SEO, the `Base page` select and (data only, never
 * shown) a slot per region a layout block declares (`region__<name>`: Puck finds slots in the static fields). The
 * region mode fields come from `resolveFields`. A base page has its title only.
 */
function rootFields(kind: PageKind, registry: BlockRegistry, bases: readonly BaseOption[], layouts: readonly string[], locale: Locale): Record<string, Field> {
  if (kind === 'base') return { title: { type: 'text', label: t('pageEditor.root.title') } };
  const regions: Record<string, Field> = {};
  for (const r of registryRegionNames(registry)) regions[`${REGION_PREFIX}${r}`] = regionSlotField(layouts, regionLabel(registry, r, locale));
  return {
    title: { type: 'text', label: t('pageEditor.root.title') },
    // A detail template has no path of its own: it is served at the content type's detail path.
    ...(kind === 'detail' ? {} : { path: { type: 'text', label: t('pageEditor.root.path') } as Field }),
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
    [BASE_FIELD]: basePageField(bases),
    ...regions,
  };
}

/**
 * Editor config: every block of the registry (labels in `locale`, color/spacing as token pickers, the
 * `apiIdFrom` sibling as a content type select, renders wrapped), plus `unknownTypes` as delete-only
 * placeholders that the drawer never offers, and the page fields on the root.
 */
export function buildEditorConfig(registry: BlockRegistry, opts: EditorConfigOptions, unknownTypes: readonly string[]): PuckConfig {
  const kind = opts.kind ?? 'page';
  const layouts = layoutBlockNames(registry);
  const base = toPuckConfig(registry, { locale: opts.locale, customFields: opts.customFields });
  const components: Record<string, ComponentConfig> = {};
  for (const d of registry.list) {
    const c = base.components[d.name] as ComponentConfig;
    const fields = editorFields(d.fields as Record<string, BlockField>, (c.fields ?? {}) as Record<string, Field>, opts, layouts);
    let render = c.render as unknown as Render;
    if (d.kind === 'layout') {
      // Page content is never edited in a base page: a placeholder shows where it goes.
      delete fields.pageContent;
      const inner = render;
      render = (p) => inner({ ...p, pageContent: PageContentPlaceholder });
    } else if (d.kind === 'overlay') {
      // A closed dialog takes no space on the canvas: a chip with a Preview toggle instead (editor only).
      const inner = render;
      render = (p) => createElement(OverlayChip, { def: d, props: p, render: inner });
    }
    components[d.name] = { ...c, fields, render: opts.wrapRender(d.name, render) as never };
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
  // Puck lists uncategorized components (the unknown placeholders) under `other`: hide it unless a project category uses that name.
  const categories: NonNullable<PuckConfig['categories']> = { ...(base.categories ?? {}), ...(base.categories?.other ? {} : { other: { visible: false } }) };
  if (kind !== 'base' && layouts.length) {
    // Layout blocks are not offered on pages (only as the root of a base page).
    for (const [key, cat] of Object.entries(categories)) {
      if (!cat.components) continue;
      const rest = cat.components.filter((n) => !layouts.includes(n as string));
      if (rest.length === cat.components.length) continue;
      if (rest.length) categories[key] = { ...cat, components: rest };
      else delete categories[key];
    }
    categories.__layout = { title: '', components: layouts, visible: false } as never;
  }
  const dropZone = (p: { children?: ReactNode; puck?: { renderDropZone?: ComponentType<any> } }, rule: { allow?: string[]; disallow?: string[] }) =>
    p.puck?.renderDropZone ? createElement(p.puck.renderDropZone, { zone: ROOT_ZONE, ...rule }) : p.children;
  const root =
    kind === 'base'
      ? {
          fields: rootFields('base', registry, [], layouts, opts.locale),
          // Root of a base page: layout blocks only (one: enforced by the editor's onAction).
          render: (p: { children?: ReactNode; puck?: { renderDropZone?: ComponentType<any> } }) => createElement(Fragment, null, dropZone(p, { allow: layouts })),
        }
      : {
          fields: rootFields(kind, registry, opts.bases ?? [], layouts, opts.locale),
          resolveFields: pageRootResolveFields({ regionsOf: opts.regionsOf ?? (async () => null), registry, locale: opts.locale }),
          render: (p: Record<string, unknown> & { children?: ReactNode; puck?: { renderDropZone?: ComponentType<any> } }) => {
            const zone = dropZone(p, layouts.length ? { disallow: layouts } : {});
            return opts.baseFrame ? createElement(opts.baseFrame, { ...p, children: zone }) : createElement(Fragment, null, zone);
          },
        };
  return { components, categories, root: root as never } as PuckConfig;
}

/**
 * The palette search model of the Page builder block list: the config's categories, the translated labels and the
 * blocks' English labels; Enter adds the block at the end of the page content when the page root takes it (a base
 * page: layout blocks only; a page: no layout block).
 */
export function pageBuilderPalette(config: Pick<PuckConfig, 'components' | 'categories'>, registry: BlockRegistry, kind: PageKind = 'page'): PaletteModel {
  const layouts = layoutBlockNames(registry);
  return {
    categories: (config.categories ?? {}) as Record<string, PaletteCategory>,
    label: t('paletteSearch.labelPageBuilder'),
    describe: (name) => {
      const label = (config.components[name] as { label?: string } | undefined)?.label ?? name;
      const own = registry.has(name) ? registry.get(name)!.label : undefined;
      const english = typeof own === 'string' ? own : ((own as Record<string, string> | undefined)?.['en-US'] ?? name);
      return { label, english };
    },
    target: (name, get) => {
      if (!registry.has(name) || (kind === 'base') !== layouts.includes(name)) return null;
      const content = (get().appState.data as { content?: unknown[] }).content ?? [];
      return { zone: ROOT_ZONE, index: content.length };
    },
  };
}
