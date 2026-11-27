// Pure logic of the CollectionList element in the block builder: keys and default type of new lists, the list an
// item sits in (its bindings read that list's type), sample queries, detail paths and item-template rules.
// Relative imports only (root vitest).
import {
  COLLECTION_LIST_DEFAULT_LIMIT,
  COLLECTION_LIST_KEY_RE,
  composedFieldNameIssue,
  parseDetailPath,
  type CollectionListProps,
  type ComposedBinding,
  type ComposedNode,
} from '@opencloudcms/schema';
import type { DetailPaths } from '@opencloudcms/core/blocks';
import type { ContentTypeDefinition } from '../lib/types';
import { indexPuck, LIST_KEY_PROP, pathOf, type BuilderPuckData, type PuckItem } from './tree-puck';

/** Elements an item template refuses at any depth (spec §1: no Slot, Carousel, Overlay, regions or nested lists). */
export const IN_LIST_REFUSED: readonly string[] = ['Slot', 'Region', 'PageContent', 'Overlay', 'Carousel', 'CollectionList'];

/** Key names a list never takes (generated block fields and props of the page builder). */
const RESERVED_KEY_RE = /^(entry|entries|layout|slot\d*|region|name|pageContent)$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `list`, then `list2`, `list3`… : the first key not in `taken` and not a manual field, generated or reserved name. */
export function freeListKey(taken: Iterable<string>, fields: Record<string, unknown>): string {
  const used = new Set(taken);
  const ok = (k: string) =>
    !used.has(k) && !Object.prototype.hasOwnProperty.call(fields, k) && !RESERVED_KEY_RE.test(k) && composedFieldNameIssue(k) === null;
  if (ok('list')) return 'list';
  for (let i = 2; ; i++) if (ok(`list${i}`)) return `list${i}`;
}

/** Every CollectionList item of the Puck data, in tree order. */
export function puckLists(data: BuilderPuckData | null | undefined): PuckItem[] {
  const out: PuckItem[] = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const it of items as PuckItem[]) {
      if (!isObj(it) || !isObj(it.props)) continue;
      if (it.type === 'CollectionList') out.push(it);
      walk(it.props.children);
    }
  };
  walk(data?.content);
  return out;
}

/**
 * New CollectionLists (items not in `prev`, dropped from the palette or inside a template) get a free key and, when
 * they have none, the default content type. Lists that were already there are left alone (a key being typed never
 * moves). Returns the fixed data, or null when nothing changed.
 */
export function fillListDefaults(
  prev: BuilderPuckData | null | undefined,
  next: BuilderPuckData,
  fields: Record<string, unknown>,
  defaultApiId: string | undefined,
): BuilderPuckData | null {
  const before = new Set(puckLists(prev).map((it) => String(it.props.id)));
  const lists = puckLists(next);
  const fresh = lists.filter((it) => !before.has(String(it.props.id)));
  if (!fresh.length) return null;
  const taken = new Set(lists.filter((it) => before.has(String(it.props.id))).map((it) => String(it.props[LIST_KEY_PROP] ?? '')));
  const patch = new Map<string, Record<string, unknown>>();
  for (const it of fresh) {
    const key = it.props[LIST_KEY_PROP];
    const p: Record<string, unknown> = {};
    if (typeof key !== 'string' || !COLLECTION_LIST_KEY_RE.test(key) || taken.has(key) || Object.prototype.hasOwnProperty.call(fields, key)) {
      p[LIST_KEY_PROP] = freeListKey(taken, fields);
    }
    taken.add(String(p[LIST_KEY_PROP] ?? key));
    if ((typeof it.props.apiId !== 'string' || !it.props.apiId) && defaultApiId) p.apiId = defaultApiId;
    if (Object.keys(p).length) patch.set(String(it.props.id), p);
  }
  if (!patch.size) return null;
  const fix = (items: unknown): unknown => {
    if (!Array.isArray(items)) return items;
    return (items as PuckItem[]).map((it) => {
      if (!isObj(it) || !isObj(it.props)) return it;
      const own = patch.get(String(it.props.id));
      const kids = it.props.children;
      const nextKids = fix(kids);
      if (!own && nextKids === kids) return it;
      return { ...it, props: { ...it.props, ...(own ?? {}), ...(nextKids !== kids ? { children: nextKids } : {}) } };
    });
  };
  // `fix` returns new arrays all the way down; the untouched branches keep their items.
  return { ...next, content: fix(next.content) as PuckItem[] };
}

/** The CollectionList item `id` sits in (a strict ancestor), or null. */
export function enclosingList(data: BuilderPuckData | null | undefined, id: string | null | undefined): PuckItem | null {
  if (!id) return null;
  const index = indexPuck(data);
  for (const a of pathOf(index, id).slice(1)) {
    const it = index.get(a)!.item;
    if (it.type === 'CollectionList') return it;
  }
  return null;
}

/** What the bindings of an item read: the enclosing list's type, else the block binding's (spec §1). */
export interface BindScope {
  /** The item sits in a CollectionList's item template. */
  inList: boolean;
  apiId: string;
  type: ContentTypeDefinition | null;
  urlPattern?: string;
}

export function bindScope(
  data: BuilderPuckData | null | undefined,
  id: string | null | undefined,
  types: readonly ContentTypeDefinition[],
  binding: ComposedBinding | undefined,
  blockType: ContentTypeDefinition | null,
): BindScope {
  const list = enclosingList(data, id);
  if (list) {
    const apiId = typeof list.props.apiId === 'string' ? list.props.apiId : '';
    const urlPattern = typeof list.props.urlPattern === 'string' && list.props.urlPattern ? list.props.urlPattern : undefined;
    return { inList: true, apiId, type: types.find((t) => t.apiId === apiId) ?? null, ...(urlPattern ? { urlPattern } : {}) };
  }
  return { inList: false, apiId: binding?.apiId ?? '', type: blockType, ...(binding?.urlPattern ? { urlPattern: binding.urlPattern } : {}) };
}

/** Detail pages usable for links (non-private types with a valid path), as `resolvePage` stamps `_detailPaths`. */
export function detailPathsOf(types: readonly ContentTypeDefinition[]): DetailPaths {
  const out: DetailPaths = {};
  for (const t of types) {
    const d = t.detailPage;
    if (t.private || !d || !parseDetailPath(d.path)) continue;
    out[t.apiId] = { path: d.path, ...(d.slugField ? { slugField: d.slugField } : {}) };
  }
  return out;
}

/** apiIds with a detail page (`validateComposedSpec`'s `detailTypes`). */
export const detailTypesOf = (types: readonly ContentTypeDefinition[]): Set<string> => new Set(Object.keys(detailPathsOf(types)));

/** Lists of a spec tree (for the canvas samples): key and query props, in tree order. */
export function treeLists(tree: ComposedNode): CollectionListProps[] {
  const out: CollectionListProps[] = [];
  const walk = (n: ComposedNode) => {
    if (n.el === 'CollectionList' && isObj(n.props) && typeof n.props.key === 'string') out.push(n.props as unknown as CollectionListProps);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}

/** The list's query as a collection binding (what `loadSamples` takes). */
export function listSampleBinding(p: CollectionListProps): ComposedBinding {
  return {
    apiId: p.apiId,
    mode: 'collection',
    ...(p.filter?.length ? { filter: p.filter } : {}),
    ...(p.sort ? { sort: p.sort } : {}),
    limit: p.limit ?? COLLECTION_LIST_DEFAULT_LIMIT,
  };
}

/** The list's editor options as saved: only `true` switches, none → undefined. */
export function cleanListEditor(v: unknown): CollectionListProps['editor'] | undefined {
  if (!isObj(v)) return undefined;
  const out: NonNullable<CollectionListProps['editor']> = {};
  for (const k of ['filter', 'sort', 'limit', 'layout'] as const) if (v[k] === true) out[k] = true;
  return Object.keys(out).length ? out : undefined;
}
