// Pure helpers of the page editor (fields, preview values, tree checks). Relative imports only (root vitest).
import { localizedText, PAGE_API_ID, type Locale } from '@opencloudcms/schema';
import {
  COLOR_TOKENS,
  SPACING_TOKENS,
  writePageContent,
  type BlockField,
  type BlockRegistry,
  type EntriesBlockField,
  type PuckData,
  type StoredPageContent,
} from '@opencloudcms/core/blocks';
import type { ContentTypeDefinition, FieldDefinition } from '../lib/types';

type Props = Record<string, unknown>;
type Item = { type: string; props: Props };

const isObj = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
const isItem = (v: unknown): v is Item => isObj(v) && typeof v.type === 'string' && isObj(v.props);

/** Fields of `ct` the list API can filter on: `indexed` or `unique`, single-column (the server rejects the rest). */
export function filterableFields(ct: ContentTypeDefinition): FieldDefinition[] {
  return ct.fields.filter((f) => (f.indexed || f.unique) && !f.options?.multiple);
}

/** Which controls the page editor shows for a `b.entries` field (mirrors what `resolvePage` honours). */
export interface EntriesControls {
  /** Pick ⇄ query select (hidden only for `filterable: false`, as before). */
  modeSelect: boolean;
  /** "Add filter": hidden only for `filterable: false` (composed blocks always set it). */
  addFilter: boolean;
  /** Sort: hidden only for `sortable: false` (then `resolvePage` uses `defaultSort` when set). */
  sort: boolean;
  /** Editable limit; false when `lockLimit` (then `lockedLimit` is the limit shown read-only). */
  limit: boolean;
  lockedLimit: number | null;
  /** Fixed `baseFilter` conditions, shown read-only. */
  fixed: { field: string; value: string }[];
}

export function entriesFieldControls(f: EntriesBlockField): EntriesControls {
  return {
    modeSelect: f.filterable !== false,
    addFilter: f.filterable !== false,
    sort: f.sortable !== false,
    limit: f.lockLimit !== true,
    lockedLimit: f.lockLimit === true ? (f.limit ?? 10) : null,
    fixed: Object.entries(f.baseFilter ?? {}).map(([field, value]) => ({ field, value })),
  };
}

/** Fields an editor filter may use: filterable, minus those a fixed filter already decides (base wins). */
export function editorFilterFields(fields: readonly FieldDefinition[], f: EntriesBlockField): FieldDefinition[] {
  const fixed = f.baseFilter ?? {};
  return fields.filter((x) => !Object.hasOwn(fixed, x.name));
}

/** `Label = value` of a fixed condition (booleans through `t` as Yes/No). */
export function fixedConditionText(c: { field: string; value: string }, def: FieldDefinition | undefined, t: (key: string) => string): string {
  const label = def?.label || c.field;
  const value = def?.kind === 'boolean' ? t(c.value === 'true' ? 'pageEditor.root.yes' : 'pageEditor.root.no') : c.value;
  return `${label} = ${value}`;
}

/** Design-system tokens offered by `b.color` / `b.spacing` fields. */
export function tokenOptions(kind: 'color' | 'spacing'): string[] {
  return [...(kind === 'color' ? COLOR_TOKENS : SPACING_TOKENS)];
}

/** Content types a block may list (core-owned types hidden), labelled in `locale`. */
export function contentTypeOptions(types: readonly ContentTypeDefinition[], locale: Locale): { value: string; label: string }[] {
  return types
    .filter((t) => t.apiId !== PAGE_API_ID)
    .map((t) => ({ value: t.apiId, label: localizedText(t.displayName, locale, t.apiId) }));
}

/** Puck field name of `sibling` next to the field named `name` (`items[2].source` → `items[2].apiId`). */
export function siblingName(name: string, sibling: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? sibling : `${name.slice(0, i + 1)}${sibling}`;
}

/** Reads a Puck field path (`a.b[0].c`) from `obj`; undefined when any step is missing. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(/\.|\[(\d+)\]/).filter((k) => k !== undefined && k !== '')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Content type of an entries field: the sibling prop named by `apiIdFrom` (same list row), else `apiId`. */
export function entriesApiId(f: EntriesBlockField, itemProps: Props, name: string): string {
  if (!f.apiIdFrom) return f.apiId;
  const v = readPath(itemProps, siblingName(name, f.apiIdFrom));
  return typeof v === 'string' ? v : '';
}

const DATA_KINDS = new Set(['link', 'image', 'entry', 'entries']);

/** Render value of a stored data-field value before (or without) resolution: never the stored shape. */
function unresolved(kind: string, v: unknown): unknown {
  switch (kind) {
    case 'link':
      return isObj(v) && v.kind === 'url' && typeof v.href === 'string' ? { href: v.href } : { href: null };
    case 'image':
      return isObj(v) && typeof v.src === 'string' && v.src ? { src: v.src, alt: typeof v.alt === 'string' ? v.alt : '' } : null;
    case 'entry':
      return null;
    default:
      return [];
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Resolved props of one item together with the stored props they were resolved from. */
export interface ResolvedItem {
  source: Props;
  props: Props;
}

/**
 * Props for a block render in the canvas: live props, with each data field (link, image, entry, entries; also
 * inside list rows) taken from `resolved` while its stored value is unchanged, else a safe unresolved value.
 */
export function previewProps(fields: Record<string, BlockField>, live: Props, resolved?: ResolvedItem): Props {
  const out: Props = { ...live };
  for (const [k, f] of Object.entries(fields)) {
    const v = live[k];
    if (DATA_KINDS.has(f.kind)) {
      out[k] = resolved && k in resolved.props && same(resolved.source[k], v) ? resolved.props[k] : unresolved(f.kind, v);
    } else if (f.kind === 'list' && Array.isArray(v)) {
      const srcRows = Array.isArray(resolved?.source[k]) ? (resolved!.source[k] as unknown[]) : [];
      const resRows = Array.isArray(resolved?.props[k]) ? (resolved!.props[k] as unknown[]) : [];
      out[k] = v.map((row, i) => {
        if (!isObj(row)) return row;
        const r = isObj(srcRows[i]) && isObj(resRows[i]) ? { source: srcRows[i] as Props, props: resRows[i] as Props } : undefined;
        return previewProps(f.fields as Record<string, BlockField>, row, r);
      });
    }
  }
  return out;
}

/** Calls `visit` for every block item (content, zones, slots, slots in list rows; heuristically inside unknown blocks). */
export function walkItems(data: PuckData, registry: BlockRegistry, visit: (item: Item) => void): void {
  const walkProps = (fields: Record<string, BlockField>, props: Props) => {
    for (const [k, f] of Object.entries(fields)) {
      const v = props[k];
      if (f.kind === 'slot' && Array.isArray(v)) walkList(v);
      else if (f.kind === 'list' && Array.isArray(v)) for (const row of v) if (isObj(row)) walkProps(f.fields as Record<string, BlockField>, row);
    }
  };
  const walkList = (list: unknown[]) => {
    for (const it of list) {
      if (!isItem(it)) continue;
      visit(it);
      const def = registry.get(it.type);
      if (def) walkProps(def.fields as Record<string, BlockField>, it.props);
      else for (const v of Object.values(it.props)) if (Array.isArray(v) && v.length && v.every(isItem)) walkList(v);
    }
  };
  walkList(Array.isArray(data.content) ? data.content : []);
  for (const zone of Object.values(data.zones ?? {})) if (Array.isArray(zone)) walkList(zone);
}

/**
 * Key of everything `resolvePage` reads: data-field values (also in list rows) and `apiIdFrom` siblings, by block id.
 * Equal keys = the canvas needs no new resolution (text edits do not refetch).
 */
export function dataSignature(data: PuckData, registry: BlockRegistry): string {
  const parts: unknown[] = [];
  const collect = (fields: Record<string, BlockField>, props: Props, out: Props) => {
    for (const [k, f] of Object.entries(fields)) {
      if (DATA_KINDS.has(f.kind)) {
        out[k] = props[k] ?? null;
        if (f.kind === 'entries' && f.apiIdFrom) out[f.apiIdFrom] = props[f.apiIdFrom] ?? null;
      } else if (f.kind === 'list' && Array.isArray(props[k])) {
        out[k] = (props[k] as unknown[]).map((row) => {
          const r: Props = {};
          if (isObj(row)) collect(f.fields as Record<string, BlockField>, row, r);
          return r;
        });
      }
    }
  };
  walkItems(data, registry, (it) => {
    const def = registry.get(it.type);
    if (!def) return;
    const out: Props = {};
    collect(def.fields as Record<string, BlockField>, it.props, out);
    if (Object.keys(out).length) parts.push([it.props.id, out]);
  });
  return JSON.stringify(parts);
}

/** Pairs the props of each block in `source` (stored shape) with the same block in `resolved` (`resolvePage` output). */
export function indexResolved(source: PuckData, resolved: PuckData, registry: BlockRegistry): Map<string, ResolvedItem> {
  const byId = new Map<string, Props>();
  walkItems(resolved, registry, (it) => byId.set(String(it.props.id), it.props));
  const out = new Map<string, ResolvedItem>();
  walkItems(source, registry, (it) => {
    const id = String(it.props.id);
    const props = byId.get(id);
    if (props) out.set(id, { source: it.props, props });
  });
  return out;
}

export interface SlotOverflow {
  id: string;
  block: string;
  slot: string;
  max: number;
}

/** Slots holding more blocks than their `b.slot({ max })` (Puck 0.24 slots cannot enforce it themselves). */
export function slotOverflows(data: PuckData, registry: BlockRegistry): SlotOverflow[] {
  const out: SlotOverflow[] = [];
  walkItems(data, registry, (it) => {
    const def = registry.get(it.type);
    if (!def) return;
    for (const [k, f] of Object.entries(def.fields as Record<string, BlockField>)) {
      if (f.kind !== 'slot' || f.max === undefined) continue;
      const v = it.props[k];
      if (Array.isArray(v) && v.length > f.max) out.push({ id: String(it.props.id), block: it.type, slot: k, max: f.max });
    }
  });
  return out;
}

/** Block types in `data` that the registry does not define, in order of first appearance. */
export function unknownBlockTypes(data: PuckData, registry: BlockRegistry): string[] {
  const out = new Set<string>();
  walkItems(data, registry, (it) => {
    if (!registry.has(it.type)) out.add(it.type);
  });
  return [...out];
}

export interface PageSeo {
  title?: string;
  description?: string;
  noindex?: boolean;
  /** Other keys (e.g. `image`) are kept as stored; the editor does not edit them. */
  [key: string]: unknown;
}

/** Page fields edited in Puck's root panel. */
export const ROOT_KEYS = ['title', 'path', 'seoTitle', 'seoDescription', 'seoNoindex'] as const;

/** Puck data for the editor: the stored data with the page's title, path and SEO as root props. */
export function toEditorData(page: { title?: string | null; path?: string | null; seo?: PageSeo | null }, data: PuckData): PuckData {
  const root = (isObj(data.root) ? data.root : {}) as PuckData['root'] & { props?: Props };
  const seo = page.seo ?? {};
  return {
    ...data,
    root: {
      ...root,
      props: {
        ...(root.props ?? {}),
        title: page.title ?? '',
        path: page.path ?? '',
        seoTitle: seo.title ?? '',
        seoDescription: seo.description ?? '',
        seoNoindex: seo.noindex === true,
      },
    },
  } as PuckData;
}

/**
 * Request body for saving the page: title, path, SEO from the root props; the rest as stored content.
 * `storedSeo` is the page's current `seo`: keys the editor does not edit (e.g. `image`) are carried over.
 */
export function fromEditorData(
  data: PuckData,
  registry: BlockRegistry,
  storedSeo?: PageSeo | null,
): { title: string; path: string; seo: PageSeo; content: StoredPageContent } {
  const root = (data.root ?? {}) as { props?: Props };
  const props = root.props ?? {};
  const rest: Props = {};
  for (const [k, v] of Object.entries(props)) if (!(ROOT_KEYS as readonly string[]).includes(k)) rest[k] = v;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const seo: PageSeo = { ...(isObj(storedSeo) ? storedSeo : {}) };
  delete seo.title;
  delete seo.description;
  delete seo.noindex;
  if (str(props.seoTitle).trim()) seo.title = str(props.seoTitle).trim();
  if (str(props.seoDescription).trim()) seo.description = str(props.seoDescription).trim();
  if (props.seoNoindex === true) seo.noindex = true;
  return {
    title: str(props.title),
    path: str(props.path),
    seo,
    content: writePageContent({ ...data, root: { ...root, props: rest } } as PuckData, registry),
  };
}
