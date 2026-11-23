import { draftMode, cookies } from 'next/headers';
import { PAGE_API_ID } from '@opencloudcms/schema';
import { NO_STORE, PREVIEW_LOCALE_COOKIE, asLocale, isPagePath, resolveBaseUrl } from './shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short static error page. Nothing from the request is echoed back. */
export function errorPage(status: number, title: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head><body><main style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem"><h1>${title}</h1><p><a href="/admin">OpenCloudCMS admin</a></p></main></body></html>`;
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_STORE },
  });
}

const redirect = (location: string): Response =>
  // Relative Location: always same-origin, independent of the Host the loopback request carried.
  new Response(null, { status: 307, headers: { location, 'cache-control': NO_STORE } });

/**
 * `GET /__opencloudcms/preview?page=<documentId>&locale=<Locale>` (spec §8.2 step 2). Loads the draft through the
 * admin API with the caller's session cookie; only when that succeeds is draft mode enabled. There is no token: a
 * forwarded link only works for someone with a valid admin session and `content.read`.
 * `baseUrl` (default `http://127.0.0.1:${PORT ?? 4000}`): the request cookies (the admin session) are forwarded to it,
 * so it must be this server itself (loopback or the site's own origin), never another host.
 */
export function createPreviewRoute(o: { baseUrl?: string } = {}): { GET(req: Request): Promise<Response> } {
  return {
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const page = url.searchParams.get('page');
      const rawLocale = url.searchParams.get('locale');
      if (!page || !UUID_RE.test(page)) return errorPage(400, 'Missing or invalid page');
      const locale = rawLocale ? asLocale(rawLocale) : undefined;
      if (rawLocale && !locale) return errorPage(400, 'Invalid locale');

      const qs = new URLSearchParams({ status: 'draft' });
      if (locale) qs.set('locale', locale);
      const headers: Record<string, string> = { accept: 'application/json' };
      const cookie = req.headers.get('cookie');
      if (cookie) headers.cookie = cookie;

      let res: Response;
      try {
        res = await fetch(`${resolveBaseUrl(o.baseUrl)}/api/admin/content/${PAGE_API_ID}/${encodeURIComponent(page)}?${qs}`, {
          headers,
          cache: 'no-store',
        });
      } catch {
        return errorPage(502, 'Preview unavailable');
      }
      if (res.status === 401) {
        return redirect(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      }
      if (res.status === 403) return errorPage(403, 'You do not have access to drafts');
      if (res.status === 404) return errorPage(404, 'Page not found');
      if (res.status === 400) return errorPage(400, 'Invalid preview request');
      if (!res.ok) return errorPage(502, 'Preview unavailable');

      let entry: { locale?: unknown; path?: unknown } | undefined;
      try {
        entry = ((await res.json()) as { data?: { locale?: unknown; path?: unknown } }).data;
      } catch {
        return errorPage(502, 'Preview unavailable');
      }
      const entryLocale = asLocale(entry?.locale);
      // The API falls back to the default locale; a draft that only exists there is not a draft of `locale`.
      if (!entryLocale || (locale && entryLocale !== locale)) return errorPage(404, 'No draft in this locale');
      if (!isPagePath(entry?.path)) return errorPage(404, 'Page not found');

      (await draftMode()).enable();
      (await cookies()).set(PREVIEW_LOCALE_COOKIE, entryLocale, { httpOnly: true, sameSite: 'lax', path: '/' });
      return redirect(entry.path);
    },
  };
}
