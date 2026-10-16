/**
 * Helpers for the public delivery API.
 *
 * Example (Server Component on another route):
 *
 *   import { getEntries } from './lib/cms';
 *   const { data } = await getEntries('product', { limit: 10 });
 *   // In browser code, pass { origin: window.location.origin } for same-origin requests.
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
  /** Explicit origin, such as window.location.origin in browser code. */
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
  const publicOrigin = process.env.OPENCMS_PUBLIC_URL?.trim().replace(/\/+$/, '');
  const origin = opts.origin ?? (publicOrigin || `http://127.0.0.1:${process.env.PORT || 4000}`);
  const url = new URL(path, origin).toString();
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`getEntries(${apiId}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{ data: unknown[]; meta: { total: number; limit: number; offset: number } }>;
}
