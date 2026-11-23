import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enable = vi.fn();
const disable = vi.fn();
const setCookie = vi.fn();
vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: false, enable, disable })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: setCookie })),
  headers: vi.fn(async () => new Headers()),
}));

import { createPreviewExitRoute } from '../../blocks/src/next/exit-route';
import { createPreviewRoute } from '../../blocks/src/next/preview-route';

const ID = '7d5c1a8e-3f0b-4c1e-9a43-2a6f1d0b9c11';
const SESSION = 'opencloudcms_session=abc; other=1';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const req = (qs: string, cookie: string | null = SESSION) =>
  new Request(`http://site.test/__opencloudcms/preview${qs}`, { headers: cookie ? { cookie } : {} });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  enable.mockReset();
  disable.mockReset();
  setCookie.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('createPreviewRoute', () => {
  const route = createPreviewRoute({ baseUrl: 'http://api.local:4100/' });

  it('200: loads the draft with the forwarded session, enables draft mode, sets the locale cookie and redirects to its path', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { documentId: ID, locale: 'vi-VN', path: '/gioi-thieu' } }));
    const res = await route.GET(req(`?page=${ID}&locale=vi-VN`));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.local:4100/api/admin/content/opencloudcmsPage/${ID}?status=draft&locale=vi-VN`);
    expect((init.headers as Record<string, string>).cookie).toBe(SESSION);
    expect(init.cache).toBe('no-store');

    expect(enable).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith('opencloudcms_preview_locale', 'vi-VN', { httpOnly: true, sameSite: 'lax', path: '/' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/gioi-thieu');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('without a locale uses the locale of the returned draft (the default locale)', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { documentId: ID, locale: 'en-US', path: '/' } }));
    const res = await route.GET(req(`?page=${ID}`));
    expect(fetchMock.mock.calls[0][0]).toBe(`http://api.local:4100/api/admin/content/opencloudcmsPage/${ID}?status=draft`);
    expect(setCookie).toHaveBeenCalledWith('opencloudcms_preview_locale', 'en-US', { httpOnly: true, sameSite: 'lax', path: '/' });
    expect(res.headers.get('location')).toBe('/');
  });

  it('401: redirects to the admin login with the preview URL as next, draft mode stays off', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'unauthorized', message: 'no session' } }));
    const res = await route.GET(req(`?page=${ID}&locale=en-US`, null));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      `/admin/login?next=${encodeURIComponent(`/__opencloudcms/preview?page=${ID}&locale=en-US`)}`,
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('cookie');
    expect(enable).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it.each([
    [403, 403],
    [404, 404],
    [400, 400],
    [500, 502],
  ])('API %i: answers a short HTML error page (%i) and never enables draft mode', async (api, status) => {
    fetchMock.mockResolvedValue(json(api, { error: { message: 'x' } }));
    const res = await route.GET(req(`?page=${ID}&locale=en-US`));
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toContain('<html');
    expect(enable).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('a network failure is a 502, not a draft', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await route.GET(req(`?page=${ID}`));
    expect(res.status).toBe(502);
    expect(enable).not.toHaveBeenCalled();
  });

  it.each([
    ['missing page', ''],
    ['empty page', '?page='],
    ['page not a uuid', '?page=../../users'],
    ['unsupported locale', `?page=${ID}&locale=xx-YY`],
  ])('%s: 400 without calling the API', async (_, qs) => {
    const res = await route.GET(req(qs));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('a draft that exists only in another locale (API fallback) is a 404', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { documentId: ID, locale: 'en-US', path: '/about' } }));
    const res = await route.GET(req(`?page=${ID}&locale=vi-VN`));
    expect(res.status).toBe(404);
    expect(enable).not.toHaveBeenCalled();
  });

  it.each(['//evil.example', 'https://evil.example', '/admin/x', '/About', '', null])(
    'never redirects to a path outside the page rules (%s)',
    async (path) => {
      fetchMock.mockResolvedValue(json(200, { data: { documentId: ID, locale: 'en-US', path } }));
      const res = await route.GET(req(`?page=${ID}&locale=en-US`));
      expect(res.status).toBe(404);
      expect(res.headers.get('location')).toBeNull();
      expect(enable).not.toHaveBeenCalled();
    },
  );

  it('defaults baseUrl to 127.0.0.1 and PORT (4000 when unset)', async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    const prev = process.env.PORT;
    try {
      process.env.PORT = '4317';
      await createPreviewRoute({}).GET(req(`?page=${ID}`));
      delete process.env.PORT;
      await createPreviewRoute().GET(req(`?page=${ID}`));
    } finally {
      if (prev === undefined) delete process.env.PORT;
      else process.env.PORT = prev;
    }
    expect(fetchMock.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:4317\/api\/admin\//);
    expect(fetchMock.mock.calls[1][0]).toMatch(/^http:\/\/127\.0\.0\.1:4000\/api\/admin\//);
  });
});

describe('createPreviewExitRoute', () => {
  const exit = createPreviewExitRoute();
  const at = (qs: string) => new Request(`http://site.test/__opencloudcms/preview/exit${qs}`);

  it('disables draft mode, clears the locale cookie and goes back to the published page', async () => {
    const res = await exit.GET(at('?path=%2Fabout'));
    expect(disable).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith('opencloudcms_preview_locale', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/about');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['', '?path=', '?path=%2F%2Fevil.example', '?path=https%3A%2F%2Fevil.example', '?path=%2Fapi%2Fx'])(
    'redirects to / unless path is a page path (%s)',
    async (qs) => {
      const res = await exit.GET(at(qs));
      expect(res.headers.get('location')).toBe('/');
      expect(disable).toHaveBeenCalled();
    },
  );
});
