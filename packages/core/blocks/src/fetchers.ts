import type { Locale } from '@opencloudcms/schema';
import type { ContentFetcher, Entry } from './resolve';

const MAX_IDS = 100;
const PAGE_API_ID = 'opencloudcmsPage';

export class FetchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FetchError';
  }
}

type Mode = { prefix: string; draft: boolean; cookie?: string; credentials: boolean };

function createFetcher(baseUrl: string, mode: Mode): ContentFetcher {
  const root = baseUrl.replace(/\/+$/, '');

  async function list(apiId: string, params: [string, string][]): Promise<Entry[]> {
    const qs = new URLSearchParams();
    if (mode.draft) qs.set('status', 'draft');
    for (const [k, v] of params) qs.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (mode.cookie) headers.cookie = mode.cookie;
    const res = await fetch(`${root}${mode.prefix}/${encodeURIComponent(apiId)}?${qs}`, {
      headers,
      ...(mode.credentials ? { credentials: 'include' as const } : {}),
      // Drafts are per session: never cached by the browser or by Next's fetch cache.
      ...(mode.draft ? { cache: 'no-store' as const } : {}),
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`.trim();
      try {
        const body = (await res.json()) as { error?: { message?: string }; message?: string };
        message = body?.error?.message ?? body?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new FetchError(message, res.status);
    }
    const body = (await res.json()) as { data?: Entry[] };
    return Array.isArray(body.data) ? body.data : [];
  }

  async function byIds(apiId: string, ids: string[], locale: Locale): Promise<Entry[]> {
    const unique = [...new Set(ids)];
    const out: Entry[] = [];
    for (let i = 0; i < unique.length; i += MAX_IDS) {
      const chunk = unique.slice(i, i + MAX_IDS);
      out.push(
        ...(await list(apiId, [
          ['filter[documentId][in]', chunk.join(',')],
          ['locale', locale],
          ['limit', String(MAX_IDS)],
        ])),
      );
    }
    return out;
  }

  return {
    byIds,
    query(apiId, q, locale) {
      const params: [string, string][] = [['locale', locale], ['limit', String(q.limit)]];
      if (q.sort) params.push(['sort', q.sort]);
      for (const [k, v] of Object.entries(q.filter ?? {})) params.push([`filter[${k}]`, v]);
      return list(apiId, params);
    },
    async pagePaths(ids, locale, defaultLocale) {
      const result: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
      const apply = (rows: Entry[]) => {
        for (const e of rows) if (e.documentId in result && result[e.documentId] === null && typeof e.path === 'string') result[e.documentId] = e.path;
      };
      apply(await byIds(PAGE_API_ID, ids, locale));
      const missing = ids.filter((id) => result[id] === null);
      if (missing.length && defaultLocale !== locale) apply(await byIds(PAGE_API_ID, missing, defaultLocale));
      return result;
    },
  };
}

/** Published content over `/api/content/**` (no auth). */
export function publicFetcher(baseUrl: string): ContentFetcher {
  return createFetcher(baseUrl, { prefix: '/api/content', draft: false, credentials: false });
}

/**
 * Draft content over `/api/admin/content/**` (`status=draft`). In the browser the session cookie is sent with
 * `credentials: 'include'`; on the server pass the incoming `cookie` header to forward it.
 */
export function adminFetcher(baseUrl: string, init: { cookie?: string } = {}): ContentFetcher {
  return createFetcher(baseUrl, { prefix: '/api/admin/content', draft: true, cookie: init.cookie, credentials: !init.cookie });
}
