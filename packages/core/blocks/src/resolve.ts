import type { Locale, StoredPageContent } from '@opencloudcms/schema';
import { isItem, isObj, mapData, mapSlots, readPageContent, type ItemFn } from './content';
import type { BlockField, BlockRegistry, PuckData, ResolvedEntry } from './types';

export type Entry = ResolvedEntry;

/** What `ContentFetcher.assets` returns per existing asset. */
export type AssetRef = { id: string; url: string; alt?: string; width?: number; height?: number };

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
  /**
   * Assets by id (unordered; missing ids are absent), for asset fields of entries rendered by blocks with
   * `entryAssetPaths`. Optional: without it those asset ids stay unresolved (images render nothing).
   */
  assets?(ids: string[]): Promise<AssetRef[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

type QuerySpec = { apiId: string; filter?: Record<string, string>; sort?: string; limit: number };
type DataField = Extract<BlockField, { kind: 'entry' | 'entries' | 'link' | 'image' | 'list' }>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

type EntriesField = Extract<BlockField, { kind: 'entries' }>;

/**
 * Query of a stored `{ mode: 'query' }` value. The field's `baseFilter` is merged over the stored filter (base wins),
 * `lockLimit` replaces the stored limit by the field's, `defaultSort` applies when nothing is stored or the field is
 * not `sortable`.
 */
function querySpec(apiId: string, v: Record<string, unknown>, field?: EntriesField): QuerySpec {
  const stored = isObj(v.filter) ? Object.fromEntries(Object.entries(v.filter).map(([k, x]) => [k, String(x)])) : {};
  const filter = { ...stored, ...(field?.baseFilter ?? {}) };
  const storedLimit = typeof v.limit === 'number' && Number.isFinite(v.limit) ? Math.floor(v.limit) : DEFAULT_LIMIT;
  const raw = field?.lockLimit ? (field.limit ?? DEFAULT_LIMIT) : storedLimit;
  const sort = field?.defaultSort && (field.sortable !== true || !str(v.sort)) ? field.defaultSort : str(v.sort);
  return {
    apiId,
    ...(Object.keys(filter).length ? { filter } : {}),
    ...(sort ? { sort } : {}),
    limit: Math.min(Math.max(raw, 1), MAX_LIMIT),
  };
}

/**
 * Whether `e` satisfies every `baseFilter` equality. Picked entries come from `byIds`, which cannot take the filter,
 * so this approximates the list API's SQL equality in JS: numbers and money amounts compare numerically, everything
 * else (booleans, text, dates, ids) by `String(value)`, and null/missing never matches. Datetimes compare as the ISO
 * strings the API returns, so a filter value in another ISO form would not match. Accepted for v1 (controller ruling).
 */
function matchesBase(e: Entry, base: Record<string, string>): boolean {
  return Object.entries(base).every(([k, want]) => {
    const got = e[k];
    if (got === null || got === undefined) return false;
    if (typeof got === 'number') return Number(want) === got;
    if (isObj(got) && 'amount' in got) return Number(want) === Number(got.amount);
    return String(got) === want;
  });
}

const queryKey = (q: QuerySpec) => JSON.stringify([q.apiId, q.filter ? Object.entries(q.filter).sort() : null, q.sort ?? null, q.limit]);
const filterKey = (q: QuerySpec) => JSON.stringify([q.apiId, q.filter ? Object.entries(q.filter).sort() : null]);

/** Applies `fn` to the value of every data-bound field (entry/entries/link/image), also inside list rows. */
function mapFieldValues(
  fields: Record<string, BlockField>,
  props: Record<string, unknown>,
  fn: (field: DataField, value: unknown, apiId: string | null) => unknown,
): Record<string, unknown> {
  const out = { ...props };
  for (const [k, f] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    const v = props[k];
    if (f.kind === 'list') {
      if (Array.isArray(v)) out[k] = v.map((row) => (isObj(row) ? mapFieldValues(f.fields, row, fn) : row));
    } else if (f.kind === 'entry' || f.kind === 'entries' || f.kind === 'link' || f.kind === 'image') {
      const apiId = f.kind === 'entries' && f.apiIdFrom ? str(props[f.apiIdFrom]) : 'apiId' in f ? str(f.apiId) : null;
      out[k] = fn(f, v, apiId);
    }
  }
  return out;
}

/**
 * Replaces the stored values of `entry`, `entries`, `link` and `image` fields by what the blocks render:
 * entries are fetched in batches (one `byIds` per apiId, one `query` per distinct query, one `pagePaths`).
 * Missing entries become `null` / are dropped; a failing `query` yields `[]` with a warning. Unknown blocks
 * are left untouched. Traversal (content, zones, slots, list rows) is shared with `readPageContent`.
 * `b.entries` `baseFilter`/`lockLimit`/`defaultSort` are enforced here (stored data cannot lift them), and items of
 * composed (and `usesLocale`) blocks get the reserved props `_locale` (= `o.locale`) and `_editor: false`.
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

  const walk = (fn: (field: DataField, value: unknown, apiId: string | null) => unknown, stamp = false): ItemFn => {
    const visit: ItemFn = (item) => {
      if (!isItem(item)) return item;
      const def = r.get(item.type);
      if (!def) return item;
      const props = mapFieldValues(def.fields, item.props, fn);
      // Reserved, never stored: composed blocks format prices/dates and pick texts for the rendered locale.
      // `_editor: false` overrides any stored value, so editor-only output never reaches the website.
      if (stamp && (def.composed || def.usesLocale)) {
        props._locale = o.locale;
        props._editor = false;
      }
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
  const collect = walk((field, v, apiId) => {
    if (field.kind === 'entry' && apiId && isObj(v) && str(v.documentId)) idSet(apiId).add(v.documentId as string);
    else if (field.kind === 'entries' && apiId && isObj(v)) {
      if (v.mode === 'pick' && Array.isArray(v.ids)) for (const id of v.ids) if (str(id)) idSet(apiId).add(id);
      if (v.mode === 'query') {
        const q = querySpec(apiId, v, field);
        queries.set(queryKey(q), q);
      }
    } else if (field.kind === 'link' && isObj(v) && v.kind === 'page' && str(v.documentId)) pageIds.add(v.documentId as string);
    return v;
  });
  mapData(data as unknown as Record<string, unknown>, collect);

  // Fetch in batches. Failures never break the page: they warn once per key and resolve to "nothing found".
  const warned = new Set<string>();
  const safe = async <T>(key: string, what: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[opencloudcms] ${what} failed, rendering without it: ${err instanceof Error ? err.message : String(err)}`);
      }
      return fallback;
    }
  };
  const [byId, queried, paths] = await Promise.all([
    Promise.all(
      [...ids].map(async ([apiId, set]) => {
        const rows = await safe(`byIds:${apiId}`, `loading "${apiId}" entries`, [] as Entry[], () => f.byIds(apiId, [...set], o.locale));
        return [apiId, new Map(rows.map((e) => [e.documentId, e] as const))] as const;
      }),
    ).then((x) => new Map(x)),
    Promise.all(
      [...queries].map(
        async ([key, q]) =>
          [
            key,
            await safe(`query:${filterKey(q)}`, `query on "${q.apiId}"`, [] as Entry[], () =>
              f.query(q.apiId, { filter: q.filter, sort: q.sort, limit: q.limit }, o.locale),
            ),
          ] as const,
      ),
    ).then((x) => new Map(x)),
    pageIds.size
      ? safe('pagePaths', 'resolving page links', {} as Record<string, string | null>, () => f.pagePaths([...pageIds], o.locale, o.defaultLocale))
      : Promise.resolve({} as Record<string, string | null>),
  ]);

  // Pass 2: substitute.
  const substitute = walk((field, v, apiId) => {
    switch (field.kind) {
      case 'entry': {
        const id = isObj(v) ? str(v.documentId) : null;
        return (id && apiId && byId.get(apiId)?.get(id)) || null;
      }
      case 'entries': {
        if (!isObj(v) || !apiId) return [];
        if (v.mode === 'pick') {
          const map = byId.get(apiId);
          const ordered = Array.isArray(v.ids) ? v.ids : [];
          let picked = ordered.flatMap((id) => (typeof id === 'string' && map?.get(id)) || []);
          if (field.baseFilter) picked = picked.filter((e) => matchesBase(e, field.baseFilter!));
          return field.lockLimit ? picked.slice(0, field.limit ?? DEFAULT_LIMIT) : picked;
        }
        if (v.mode === 'query') return queried.get(queryKey(querySpec(apiId, v, field))) ?? [];
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
  }, true);
  const resolved = mapData(data as unknown as Record<string, unknown>, substitute);

  // Pass 3: asset ids in entry fields listed by `entryAssetPaths` → one `assets` call → `{ id, url, alt, … }`.
  const onEntries = (fn: (e: Entry, paths: readonly string[]) => Entry): ItemFn => {
    const visit: ItemFn = (item) => {
      if (!isItem(item)) return item;
      const def = r.get(item.type);
      if (!def) return item;
      const paths = def.entryAssetPaths;
      const props = paths?.length
        ? mapFieldValues(def.fields, item.props, (field, v) => {
            if (field.kind === 'entry') return isObj(v) ? fn(v as Entry, paths) : v;
            if (field.kind === 'entries') return Array.isArray(v) ? v.map((e) => (isObj(e) ? fn(e as Entry, paths) : e)) : v;
            return v;
          })
        : item.props;
      return { ...item, props: mapSlots(def.fields, props, visit) };
    };
    return visit;
  };
  const assetIds = new Set<string>();
  const isAssetId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
  mapData(resolved as unknown as Record<string, unknown>, onEntries((e, paths) => {
    for (const p of paths) if (isAssetId(e[p])) assetIds.add(e[p] as string);
    return e;
  }));
  if (!assetIds.size || !f.assets) return resolved;
  const found = await safe('assets', 'loading assets', [] as AssetRef[], () => f.assets!([...assetIds]));
  const byAsset = new Map(found.map((a) => [a.id, a] as const));
  if (!byAsset.size) return resolved;
  return mapData(resolved as unknown as Record<string, unknown>, onEntries((e, paths) => {
    let out = e;
    for (const p of paths) {
      const a = isAssetId(e[p]) ? byAsset.get(e[p] as string) : undefined;
      if (a) out = { ...out, [p]: { ...a } }; // copy: fetched entries may be shared between blocks
    }
    return out;
  }));
}
