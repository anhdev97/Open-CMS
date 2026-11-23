import { validateComposedSpec, type ComposedBlockSpec, type ComposedField, type ComposedIssue, type ComposedNode, type LocalizedText } from '@opencloudcms/schema';
import { formatIssuePath } from '../define';
import { b } from '../fields';
import type { BlockDefinition, BlockField } from '../types';
import { createComposedRender, layoutValue } from './render';

/** `defineComposedBlock` on an invalid spec. `issues` uses the same paths as `validateComposedSpec`. */
export class ComposedBlockError extends Error {
  constructor(
    readonly block: string,
    readonly issues: ComposedIssue[],
  ) {
    super(`Composed block "${block}" is invalid:\n- ${issues.map((i) => `${formatIssuePath(i.path)}: ${i.message}`).join('\n- ')}`);
    this.name = 'ComposedBlockError';
  }
}

export type ComposedBlockDefinition = BlockDefinition & { composed: true; spec: ComposedBlockSpec };

const L = (en: string, vi: string, fr: string, id: string): LocalizedText => ({ 'en-US': en, 'vi-VN': vi, 'fr-FR': fr, 'id-ID': id });

function manualField(f: ComposedField): BlockField {
  const o = { ...(f.label !== undefined ? { label: f.label } : {}), ...(f.default !== undefined ? { default: f.default as never } : {}) };
  switch (f.kind) {
    case 'text':
      return b.text(o);
    case 'longText':
      return b.longText(o);
    case 'richText':
      return b.richText(o);
    case 'number':
      return b.number(o);
    case 'boolean':
      return b.boolean(o);
    case 'select':
      return b.select({ ...o, options: f.options ?? [] });
    case 'image':
      return b.image(o);
    case 'link':
      return b.link(o);
  }
}

/** Entry paths bound to `Image.src`/`Image.alt` (asset ids there are resolved by `resolvePage`). */
function imageEntryPaths(n: ComposedNode, out = new Set<string>()): Set<string> {
  if (n.el === 'Image') {
    for (const k of ['src', 'alt']) {
      const s = n.bind?.[k];
      if (s?.from === 'entry') out.add(s.path);
    }
  }
  for (const c of n.children ?? []) imageEntryPaths(c, out);
  return out;
}

/** `Slot` nodes in tree order (depth first). */
function slotNodes(n: ComposedNode, out: ComposedNode[] = []): ComposedNode[] {
  if (n.el === 'Slot') out.push(n);
  for (const c of n.children ?? []) slotNodes(c, out);
  return out;
}

/**
 * A page-builder block from a composed block spec (data written by the block builder). Fields: the manual fields by
 * name, then `entry` (single) or `entries` (+ `layout` when `editorLayout`), then `slot`, `slot2`, … per `Slot` node
 * in tree order. The fixed filter, sort and (unless `editorLimit`) limit are enforced by `resolvePage`.
 * Throws `ComposedBlockError` listing every issue when the spec is invalid.
 */
export function defineComposedBlock(spec: ComposedBlockSpec): ComposedBlockDefinition {
  const name = spec && typeof spec === 'object' && typeof spec.name === 'string' && spec.name ? spec.name : '(unnamed)';
  const issues = validateComposedSpec(spec);
  if (issues.length) throw new ComposedBlockError(name, issues);

  const generated: Record<string, BlockField> = {};
  const binding = spec.binding;
  if (binding?.mode === 'single') {
    generated.entry = b.entry(binding.apiId, { label: L('Entry', 'Mục nội dung', 'Entrée', 'Entri') });
  } else if (binding?.mode === 'collection') {
    const o = binding.options ?? {};
    const limit = binding.limit ?? 12;
    const baseFilter = Object.fromEntries((binding.filter ?? []).map((f) => [f.field, String(f.value)]));
    const defaultSort = binding.sort ? `${binding.sort.field}:${binding.sort.direction}` : undefined;
    generated.entries = b.entries(binding.apiId, {
      label: L('Entries', 'Danh sách mục', 'Entrées', 'Entri'),
      limit,
      sortable: o.editorSort === true,
      filterable: o.editorFilter === true,
      ...(Object.keys(baseFilter).length ? { baseFilter } : {}),
      ...(defaultSort ? { defaultSort } : {}),
      lockLimit: o.editorLimit !== true,
      default: { mode: 'query', limit, ...(defaultSort ? { sort: defaultSort } : {}) },
    });
    if (o.editorLayout) {
      generated.layout = b.select({
        label: L('Layout', 'Bố cục', 'Disposition', 'Tata letak'),
        options: [
          { value: 'list', label: L('List', 'Danh sách', 'Liste', 'Daftar') },
          ...([2, 3, 4, 5, 6] as const).map((n) => ({ value: `grid-${n}`, label: L(`Grid · ${n}`, `Lưới · ${n}`, `Grille · ${n}`, `Kisi · ${n}`) })),
        ],
        default: layoutValue(binding.layout),
      });
    }
  }
  const slots = new WeakMap<ComposedNode, string>();
  slotNodes(spec.tree).forEach((n, i) => {
    const key = i === 0 ? 'slot' : `slot${i + 1}`;
    slots.set(n, key);
    const p = n.props ?? {};
    generated[key] = b.slot({
      label: L('Content', 'Nội dung', 'Contenu', 'Konten'),
      ...(Array.isArray(p.allow) ? { allow: p.allow as string[] } : {}),
      ...(typeof p.max === 'number' ? { max: p.max } : {}),
    });
  });

  const clash = Object.keys(spec.fields).filter((k) => Object.prototype.hasOwnProperty.call(generated, k));
  if (clash.length) {
    throw new ComposedBlockError(
      name,
      clash.map((k) => ({ path: ['fields', k], message: `"${k}" is reserved for a generated field of this block` })),
    );
  }

  const fields: Record<string, BlockField> = {};
  for (const [k, f] of Object.entries(spec.fields)) fields[k] = manualField(f);
  Object.assign(fields, generated);

  const assetPaths = [...imageEntryPaths(spec.tree)];
  return {
    name: spec.name,
    label: spec.label,
    category: spec.category,
    ...(spec.icon ? { icon: spec.icon } : {}),
    version: spec.version,
    fields,
    composed: true,
    ...(assetPaths.length ? { entryAssetPaths: assetPaths } : {}),
    spec,
    render: createComposedRender(spec, slots) as BlockDefinition['render'],
  };
}
