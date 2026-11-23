import { cookies, draftMode } from 'next/headers';
import { NO_STORE, PREVIEW_LOCALE_COOKIE, isPagePath } from './shared';

/** `GET /__opencloudcms/preview/exit?path=<page path>`: draft mode off, locale cookie cleared, back to the published page. */
export function createPreviewExitRoute(): { GET(req: Request): Promise<Response> } {
  return {
    async GET(req: Request): Promise<Response> {
      const path = new URL(req.url).searchParams.get('path');
      (await draftMode()).disable();
      (await cookies()).set(PREVIEW_LOCALE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
      return new Response(null, {
        status: 307,
        headers: { location: isPagePath(path) ? path : '/', 'cache-control': NO_STORE },
      });
    },
  };
}
