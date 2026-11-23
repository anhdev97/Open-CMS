import type { Locale, StoredPageContent } from '@opencloudcms/schema';
import { isItem, isObj, mapData, mapSlots, readPageContent, type ItemFn } from './content';
import type { BlockField, BlockRegistry, PuckData, ResolvedEntry } from './types';

export type Entry = ResolvedEntry;

export interface ContentFetcher {
  /** Entries by documentId (unordered; missing/unpublished ids are simply absent). */
  byIds(apiId: string, ids: string[], locale: Locale): Promise<Entry[]>;
  query(
    apiId: string,
    q: { filter?: Record<string, string>; sort?: string; limit: number },
    locale: Locale,
  ): Promise<Entry[]>;
  /** documentId -> page path in `locale`, else in `defaultLocale`, else null. */
  pagePaths(ids: string[], locale: Locale, defaultLocale: Locale): Promise<Record<string, string | null>>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

type QuerySpec = { apiId: string; filter?: Record<string, string>; sort?: string; limit: number };
type DataField = Extract<BlockField, { kind: 'entry' | 'entries' | 'link' | 'image' | 'list' }>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function querySpec(apiId: string, v: Record<string, unknown>): QuerySpec {
  const filter = isObj(v.filter)
    ? Object.fromEntries(Object.entries(v.filter).map(([k, x]) => [k, String(x)]))
    : undefined;
  const raw = typeof v.limit === 'number' && Number.isFinite(v.limit) ? Math.floor(v.limit) : DEFAULT_LIMIT;
  return {
    apiId,
    ...(filter && Object.keys(filter).length ? { filter } : {}),
    ...(str(v.sort) ? { sort: v.sort as string } : {}),
    limit: Math.min(Math.max(raw, 1), MAX_LIMIT),
  };
}

const queryKey = (q: QuerySpec) => JSON.stringify([q.apiId, q.filter ? Object.entries(q.filter).sort() : null, q.sort ?? null, q.limit]);
const filterKey = (q: QuerySpec) => JSON.stringify([q.apiId, q.filter ? Object.entries(q.filter).sort() : null]);

/** Applies `fn` to the value of every data-bound field (entry/entries/link/image), also inside list rows. */
function mapFieldValues(
  fields: Record<string, BlockField>,
  props: Record<string, unknown>,
  fn: (field: DataField, value: unknown) => unknown,
): Record<string, unknown> {
  const out = { ...props };
  for (const [k, f] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    const v = props[k];
    if (f.kind === 'list') {
      if (Array.isArray(v)) out[k] = v.map((row) => (isObj(row) ? mapFieldValues(f.fields, row, fn) : row));
    } else if (f.kind === 'entry' || f.kind === 'entries' || f.kind === 'link' || f.kind === 'image') {
      out[k] = fn(f, v);
    }
  }
  return out;
}

/**
 * Replaces the stored values of `entry`, `entries`, `link` and `image` fields by what the blocks render:
 * entries are fetched in batches (one `byIds` per apiId, one `query` per distinct query, one `pagePaths`).
 * Missing entries become `null` / are dropped; a failing `query` yields `[]` with a warning. Unknown blocks
 * are left untouched. Traversal (content, zones, slots, list rows) is shared with `readPageContent`.
 */
export async function resolvePage(
  content: StoredPageContent,
  r: BlockRegistry,
  f: ContentFetcher,
  o: { locale: Locale; defaultLocale: Locale },
): Promise<PuckData> {
  const data = readPageContent(content, r).data;
  const ids = new Map<string, Set<string>>();
  const queries = new Map<string, QuerySpec>();
  const pageIds = new Set<string>();

  const walk = (fn: (field: DataField, value: unknown) => unknown): ItemFn => {
    const visit: ItemFn = (item) => {
      if (!isItem(item)) return item;
      const def = r.get(item.type);
      if (!def) return item;
      const props = mapFieldValues(def.fields, item.props, fn);
      return { ...item, props: mapSlots(def.fields, props, visit) };
    };
    return visit;
  };
  const idSet = (apiId: string) => {
    let s = ids.get(apiId);
    if (!s) ids.set(apiId, (s = new Set()));
    return s;
  };

  // Pass 1: collect.
  const collect = walk((field, v) => {
    if (field.kind === 'entry' && isObj(v) && str(v.documentId)) idSet(field.apiId).add(v.documentId as string);
    else if (field.kind === 'entries' && isObj(v)) {
      if (v.mode === 'pick' && Array.isArray(v.ids)) for (const id of v.ids) if (str(id)) idSet(field.apiId).add(id);
      if (v.mode === 'query') {
        const q = querySpec(field.apiId, v);
        queries.set(queryKey(q), q);
      }
    } else if (field.kind === 'link' && isObj(v) && v.kind === 'page' && str(v.documentId)) pageIds.add(v.documentId as string);
    return v;
  });
  mapData(data as unknown as Record<string, unknown>, collect);

  // Fetch in batches.
  const warned = new Set<string>();
  const [byId, queried, paths] = await Promise.all([
    Promise.all(
      [...ids].map(async ([apiId, set]) => {
        const rows = await f.byIds(apiId, [...set], o.locale);
        return [apiId, new Map(rows.map((e) => [e.documentId, e] as const))] as const;
      }),
    ).then((x) => new Map(x)),
    Promise.all(
      [...queries].map(async ([key, q]) => {
        try {
          return [key, await f.query(q.apiId, { filter: q.filter, sort: q.sort, limit: q.limit }, o.locale)] as const;
        } catch (err) {
          const wk = filterKey(q);
          if (!warned.has(wk)) {
            warned.add(wk);
            console.warn(
              `[opencloudcms] query on "${q.apiId}" failed, rendering an empty list: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return [key, [] as Entry[]] as const;
        }
      }),
    ).then((x) => new Map(x)),
    pageIds.size ? f.pagePaths([...pageIds], o.locale, o.defaultLocale) : Promise.resolve({} as Record<string, string | null>),
  ]);

  // Pass 2: substitute.
  const substitute = walk((field, v) => {
    switch (field.kind) {
      case 'entry': {
        const id = isObj(v) ? str(v.documentId) : null;
        return (id && byId.get(field.apiId)?.get(id)) || null;
      }
      case 'entries': {
        if (!isObj(v)) return [];
        if (v.mode === 'pick') {
          const map = byId.get(field.apiId);
          const ordered = Array.isArray(v.ids) ? v.ids : [];
          return ordered.flatMap((id) => (typeof id === 'string' && map?.get(id)) || []);
        }
        if (v.mode === 'query') return queried.get(queryKey(querySpec(field.apiId, v))) ?? [];
        return [];
      }
      case 'link': {
        if (isObj(v) && v.kind === 'url') return { href: str(v.href) };
        if (isObj(v) && v.kind === 'page' && str(v.documentId)) return { href: paths[v.documentId as string] ?? null };
        return { href: null };
      }
      case 'image':
        return isObj(v) && typeof v.src === 'string' ? { src: v.src, alt: typeof v.alt === 'string' ? v.alt : '' } : null;
      default:
        return v;
    }
  });
  return mapData(data as unknown as Record<string, unknown>, substitute);
}
