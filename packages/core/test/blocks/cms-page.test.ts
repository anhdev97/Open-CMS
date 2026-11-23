import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Puck's RSC entry logs a notice when it detects an AI agent environment (env-dependent); keep test output clean.
vi.hoisted(() => {
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (!String(a[0]).startsWith('[Puck] AI agent detected')) warn(...a);
  };
});
const state = vi.hoisted(() => ({
  draft: false,
  cookies: {} as Record<string, string>,
  headers: {} as Record<string, string>,
}));
vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: state.draft, enable: vi.fn(), disable: vi.fn() })),
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in state.cookies ? { name, value: state.cookies[name] } : undefined),
    set: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers(state.headers)),
}));
const NOT_FOUND = 'NEXT_NOT_FOUND';
const notFound = vi.fn(() => {
  throw new Error(NOT_FOUND);
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));

import { defineBlocks, coreBlocks } from '../../blocks/src';
import { createCmsPage } from '../../blocks/src/next/page';

const BASE = 'http://api.local:4100';
const SESSION = 'opencloudcms_session=s1; opencloudcms_preview_locale=vi-VN; __prerender_bypass=x';
const registry = defineBlocks(coreBlocks);
const cms = createCmsPage({ blocks: registry, baseUrl: BASE });

const heading = (text: string, id = 'h1') => ({ type: 'Heading', props: { id, _v: 1, text, level: 1, align: 'left' } });
const content = (...items: unknown[]) => ({ format: 'puck', formatVersion: 24, data: { root: { props: {} }, content: items } });
const page = (over: Record<string, unknown>) => ({
  documentId: 'p1',
  locale: 'en-US',
  title: 'About',
  path: '/about',
  seo: null,
  content: content(heading('Published hello')),
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Route = (url: URL, init: RequestInit) => Response | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
function routes(...rs: Route[]) {
  fetchMock.mockImplementation(async (u: string, init: RequestInit = {}) => {
    const url = new URL(u);
    for (const r of rs) {
      const hit = r(url, init);
      if (hit) return hit;
    }
    return json(404, { error: { message: `unmocked ${u}` } });
  });
}
const publicByPath = (byPath: Record<string, unknown>): Route => (url) =>
  url.pathname === '/api/content/opencloudcmsPage/by-path'
    ? byPath[url.searchParams.get('path')!]
      ? json(200, { data: byPath[url.searchParams.get('path')!] })
      : json(404, { error: { message: 'No page' } })
    : undefined;
const adminMeta = (status = 200): Route => (url) =>
  url.pathname === '/api/admin/meta'
    ? json(status, status === 200 ? { defaultLocale: 'en-US', locales: ['en-US', 'vi-VN'] } : { error: { message: 'no' } })
    : undefined;
const adminByPath = (status: number, data?: unknown): Route => (url) =>
  url.pathname === '/api/admin/content/opencloudcmsPage/by-path' ? json(status, status === 200 ? { data } : { error: { message: 'x' } }) : undefined;

const params = (...path: string[]) => ({ params: Promise.resolve(path.length ? { path } : {}) });
async function html(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node as never);
  return new Response(prelude).text();
}
const calls = () => fetchMock.mock.calls.map(([u, init]) => ({ url: new URL(u as string), init: (init ?? {}) as RequestInit }));

beforeEach(() => {
  state.draft = false;
  state.cookies = {};
  state.headers = {};
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  notFound.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createCmsPage: published (draft mode off)', () => {
  it('renders the published page from the public by-path API with the core blocks', async () => {
    routes(publicByPath({ '/about': page({}) }));
    const out = await html(await cms.Page(params('about')));
    expect(out).toContain('<h1');
    expect(out).toContain('Published hello');
    expect(out).toContain('data-opencloudcms-site');
    expect(out).not.toContain('data-opencloudcms-preview');
    const [c] = calls();
    expect(c.url.origin + c.url.pathname).toBe(`${BASE}/api/content/opencloudcmsPage/by-path`);
    expect(c.url.searchParams.get('path')).toBe('/about');
    // The public site serves the default locale: the API picks it when no locale is sent.
    expect(c.url.searchParams.has('locale')).toBe(false);
    expect(calls().every((x) => !x.url.pathname.startsWith('/api/admin'))).toBe(true);
    expect(calls().every((x) => !(x.init.headers as Record<string, string> | undefined)?.cookie)).toBe(true);
  });

  it('renders slots and rich text through Puck Render like the editor canvas', async () => {
    const section = {
      type: 'Section',
      props: { id: 's1', _v: 1, background: 'muted', paddingY: '12', children: [heading('Inside slot', 'h2')] },
    };
    const text = { type: 'Text', props: { id: 't1', _v: 1, content: '<p>Rich <strong>bold</strong></p>', align: 'left' } };
    routes(publicByPath({ '/about': page({ content: content(section, text) }) }));
    const out = await html(await cms.Page(params('about')));
    expect(out).toContain('bg-muted');
    expect(out).toContain('Inside slot');
    expect(out).toContain('<strong>bold</strong>');
  });

  it('rich text is sanitized and rendered synchronously (no raw stored HTML, even on first render)', async () => {
    const evil = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';
    const text = { type: 'Text', props: { id: 't1', _v: 1, content: evil, align: 'left' } };
    const list = { type: 'Text', props: { id: 't2', _v: 1, content: '<p>ok <strong>b</strong></p>', align: 'left' } };
    routes(publicByPath({ '/about': page({ content: content(text, list) }) }));
    const node = await cms.Page(params('about'));
    for (const out of [renderToString(node as never), await html(node)]) {
      expect(out).not.toContain('onerror');
      expect(out).not.toContain('javascript:');
      expect(out).not.toContain('<img');
      expect(out).not.toContain('<!--$'); // rendered in place: no Suspense boundary, no fallback
      expect(out).toContain('<p>x</p>');
      expect(out).toContain('<strong>b</strong>');
    }
  });

  it('no page at / shows the welcome page linking to /admin/pages', async () => {
    routes(publicByPath({}));
    const out = await html(await cms.Page(params()));
    expect(out).toContain('href="/admin/pages"');
    expect(notFound).not.toHaveBeenCalled();
    expect(calls()[0].url.searchParams.get('path')).toBe('/');
  });

  it('a missing page elsewhere calls notFound()', async () => {
    routes(publicByPath({}));
    await expect(cms.Page(params('x'))).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('a path that no page can have is notFound() without calling the API', async () => {
    routes(publicByPath({}));
    await expect(cms.Page(params('About'))).rejects.toThrow(NOT_FOUND);
    await expect(cms.Page(params('admin', 'x'))).rejects.toThrow(NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an API failure is an error, not a 404 or the welcome page', async () => {
    routes((url) => (url.pathname.endsWith('/by-path') ? json(500, { error: { message: 'boom' } }) : undefined));
    await expect(cms.Page(params())).rejects.toThrow(/500|boom/);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('an unknown stored block renders nothing and warns once per name across renders (§6.5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ghost = { type: 'Ghost', props: { id: 'g1', text: 'BOO-GHOST' } };
    routes(publicByPath({ '/about': page({ content: content(heading('Visible'), ghost) }) }));
    const first = await html(await cms.Page(params('about')));
    const second = await html(await cms.Page(params('about')));
    for (const out of [first, second]) {
      expect(out).toContain('Visible');
      expect(out).not.toContain('BOO-GHOST');
    }
    const ghostWarns = warn.mock.calls.filter((c) => String(c[0]).includes('Ghost'));
    expect(ghostWarns).toHaveLength(1);
  });

  it('content that needs migration (other formatVersion) renders no body and warns once per page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = { format: 'puck', formatVersion: 1, data: { root: { props: {} }, content: [heading('OLD-FORMAT')] } };
    routes(publicByPath({ '/old': page({ documentId: 'p-old', path: '/old', content: old }) }));
    for (let i = 0; i < 2; i++) {
      const out = await html(await cms.Page(params('old')));
      expect(out).not.toContain('OLD-FORMAT');
      expect(out).toContain('data-opencloudcms-site');
      expect(notFound).not.toHaveBeenCalled();
    }
    const migrationWarns = warn.mock.calls.filter((c) => String(c[0]).includes('p-old'));
    expect(migrationWarns).toHaveLength(1);
    expect(String(migrationWarns[0][0])).toMatch(/migrat/i);
    // Fetches only the page: nothing is resolved for content that is not rendered.
    expect(calls().every((c) => c.url.pathname.endsWith('/by-path'))).toBe(true);
  });
});

describe('createCmsPage: draft mode', () => {
  beforeEach(() => {
    state.draft = true;
    state.cookies = { opencloudcms_preview_locale: 'vi-VN' };
    state.headers = { cookie: SESSION };
  });

  it('renders the draft from the admin by-path API in the preview locale, forwarding the session, uncached, with the draft bar', async () => {
    const draft = page({
      locale: 'vi-VN',
      path: '/gioi-thieu',
      content: content(heading('Draft hello'), {
        type: 'Button',
        props: { id: 'b1', _v: 1, label: 'Go', link: { kind: 'page', documentId: 'p2' }, variant: 'default', size: 'default' },
      }),
    });
    routes(
      adminMeta(),
      adminByPath(200, draft),
      (url) =>
        url.pathname === '/api/admin/content/opencloudcmsPage'
          ? json(200, { data: [{ documentId: 'p2', locale: 'vi-VN', path: '/draft-target' }] })
          : undefined,
    );
    const out = await html(await cms.Page(params('gioi-thieu')));
    expect(out).toContain('Draft hello');
    expect(out).toContain('href="/draft-target"');
    expect(out).toContain('data-opencloudcms-preview="draft"');
    expect(out).toContain('href="/__opencloudcms/preview/exit?path=%2Fgioi-thieu"');
    expect(out).toContain('lang="vi-VN"');

    const byPath = calls().find((c) => c.url.pathname === '/api/admin/content/opencloudcmsPage/by-path')!;
    expect(byPath.url.searchParams.get('path')).toBe('/gioi-thieu');
    expect(byPath.url.searchParams.get('locale')).toBe('vi-VN');
    // Data-bound blocks resolve through the admin fetcher with the same session: drafts of linked entries.
    const linked = calls().find((c) => c.url.pathname === '/api/admin/content/opencloudcmsPage')!;
    expect(linked.url.searchParams.get('status')).toBe('draft');
    for (const c of calls()) {
      expect(c.url.pathname.startsWith('/api/admin/'), c.url.href).toBe(true);
      expect((c.init.headers as Record<string, string>).cookie).toBe(SESSION);
      expect(c.init.cache, c.url.href).toBe('no-store');
    }
  });

  it('a preview locale that is not enabled falls back to the default locale', async () => {
    state.cookies = { opencloudcms_preview_locale: 'fr-FR' };
    routes(adminMeta(), adminByPath(200, page({ content: content(heading('Default draft')) })));
    const out = await html(await cms.Page(params('about')));
    expect(out).toContain('Default draft');
    const byPath = calls().find((c) => c.url.pathname.endsWith('/by-path'))!;
    expect(byPath.url.searchParams.get('locale')).toBe('en-US');
  });

  it.each([
    ['admin by-path 403', [adminMeta(), adminByPath(403)]],
    ['admin by-path 401', [adminMeta(), adminByPath(401)]],
    ['admin meta 401', [adminMeta(401), adminByPath(200, page({ content: content(heading('Draft hello')) }))]],
  ] as [string, Route[]][])('%s: renders the published page with the expired bar, never the draft', async (_, admin) => {
    routes(...admin, publicByPath({ '/about': page({}) }));
    const out = await html(await cms.Page(params('about')));
    expect(out).toContain('Published hello');
    expect(out).not.toContain('Draft hello');
    expect(out).toContain('data-opencloudcms-preview="expired"');
    const pub = calls().filter((c) => c.url.pathname === '/api/content/opencloudcmsPage/by-path');
    expect(pub).toHaveLength(1);
    expect((pub[0].init.headers as Record<string, string> | undefined)?.cookie).toBeUndefined();
  });

  it('a draft missing at / shows the welcome page with the draft bar; elsewhere notFound()', async () => {
    routes(adminMeta(), adminByPath(404));
    const out = await html(await cms.Page(params()));
    expect(out).toContain('href="/admin/pages"');
    expect(out).toContain('data-opencloudcms-preview="draft"');
    await expect(cms.Page(params('nope'))).rejects.toThrow(NOT_FOUND);
  });

  it('draft metadata is never indexable', async () => {
    routes(adminMeta(), adminByPath(200, page({ title: 'Draft T', seo: { title: 'SEO T' } })));
    const meta = await cms.generateMetadata(params('about'));
    expect(meta.title).toBe('SEO T');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('createCmsPage: generateMetadata', () => {
  it('uses seo title/description and turns seo.noindex into robots noindex', async () => {
    routes(
      publicByPath({
        '/about': page({ seo: { title: 'About us', description: 'Who we are', noindex: true } }),
        '/plain': page({ title: 'Plain', path: '/plain', seo: null }),
      }),
    );
    const meta = await cms.generateMetadata(params('about'));
    expect(meta.title).toBe('About us');
    expect(meta.description).toBe('Who we are');
    expect(meta.robots).toEqual({ index: false });
    const plain = await cms.generateMetadata(params('plain'));
    expect(plain.title).toBe('Plain');
    expect(plain.robots).toBeUndefined();
  });

  it('returns empty metadata for a missing page (Page decides 404 / welcome)', async () => {
    routes(publicByPath({}));
    expect(await cms.generateMetadata(params('x'))).toEqual({});
    expect(notFound).not.toHaveBeenCalled();
  });
});
