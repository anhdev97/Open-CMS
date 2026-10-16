/**
 * Same-origin helpers for the public delivery API.
 *
 * Example (Server Component on another route):
 *
 *   import { getEntries } from './lib/cms';
 *   const { data } = await getEntries('product', { limit: 10 });
 *
 * The default homepage does not call this — keep it static until you need CMS content.
 */

export type GetEntriesOptions = {
  locale?: string;
  fallback?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Flat filters → `filter[field]=value` query params. */
  filter?: Record<string, string>;
  /** Absolute origin when calling from a context without a relative base. Defaults to same-origin. */
  origin?: string;
};

export async function getEntries(apiId: string, opts: GetEntriesOptions = {}) {
  const qs = new URLSearchParams();
  if (opts.locale) qs.set('locale', opts.locale);
  if (opts.fallback) qs.set('fallback', opts.fallback);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  if (opts.filter) {
    for (const [k, v] of Object.entries(opts.filter)) qs.set(`filter[${k}]`, v);
  }
  const q = qs.toString();
  const path = `/api/content/${encodeURIComponent(apiId)}${q ? `?${q}` : ''}`;
  const url = opts.origin ? new URL(path, opts.origin).toString() : path;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`getEntries(${apiId}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{ data: unknown[]; meta: { total: number; limit: number; offset: number } }>;
}
