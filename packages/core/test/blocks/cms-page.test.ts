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
vi.mock('next/navigation', () => ({ notFound: () => notFound(), usePathname: () => '/' }));
// The watcher renders nothing; a marker shows where it is mounted.
vi.mock('../../blocks/src/next/overlay-route-watcher', async () => {
  const { createElement } = await import('react');
  return { OverlayRouteWatcher: () => createElement('i', { 'data-test-watcher': '' }) };
});
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));

import { defineBlocks, defineComposedBlock, coreBlocks, type ComposedBlockSpec } from '../../blocks/src';
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

describe('createCmsPage: base pages', () => {
  const spec = (over: Partial<ComposedBlockSpec>): ComposedBlockSpec => ({
    id: 'blk_test01',
    name: 'TestBlock',
    label: { 'en-US': 'Test block' },
    category: 'layout',
    version: 1,
    fields: {},
    tree: { el: 'Box' },
    ...over,
  });
  const frame = defineComposedBlock(
    spec({
      id: 'blk_frame01',
      name: 'SiteFrame',
      tree: {
        el: 'Stack',
        children: [{ el: 'Region', props: { name: 'header' } }, { el: 'PageContent' }, { el: 'Region', props: { name: 'footer' } }],
      },
    }),
  );
  const modal = defineComposedBlock(
    spec({ id: 'blk_modal01', name: 'LienHe', tree: { el: 'Overlay', children: [{ el: 'Text', props: { text: 'MODAL-BODY' } }] } }),
  );
  const site = createCmsPage({ blocks: defineBlocks([...coreBlocks, frame, modal]), baseUrl: BASE });
  const B1 = '11111111-1111-4111-8111-111111111111';
  const MISSING = '22222222-2222-4222-8222-222222222222';
  const linkButton = { type: 'Button', props: { id: 'bl', _v: 1, label: 'Home', link: { kind: 'page', documentId: 'p2' }, variant: 'default', size: 'default' } };
  const baseEntry = (header: string, extra: unknown[] = []) => ({
    documentId: B1,
    locale: 'en-US',
    kind: 'base',
    content: content({
      type: 'SiteFrame',
      props: { id: 'f1', _v: 1, region__header: [heading(header, 'bh'), linkButton, ...extra], pageContent: [], region__footer: [heading('BASE-FOOTER', 'bf')] },
    }),
  });
  const baseRoute = (prefix: string, bases: Record<string, unknown>, status?: number): Route => (url) =>
    url.pathname === `${prefix}/opencloudcmsPage/base`
      ? status
        ? json(status, { error: { message: 'boom' } })
        : bases[url.searchParams.get('id')!]
          ? json(200, { data: bases[url.searchParams.get('id')!] })
          : json(404, { error: { message: 'No base page' } })
      : undefined;
  const pagePaths = (prefix: string): Route => (url) =>
    url.pathname === `${prefix}/opencloudcmsPage` ? json(200, { data: [{ documentId: 'p2', locale: 'en-US', path: '/home-target' }] }) : undefined;
  const baseCalls = () => calls().filter((c) => c.url.pathname.endsWith('/opencloudcmsPage/base'));
  const order = (out: string, ...parts: string[]) => {
    const at = parts.map((p) => out.indexOf(p));
    expect(at.every((i) => i >= 0), `${parts} in ${out}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  };

  it('a page without layout is framed by the default base: regions around the page content, base data blocks resolved', async () => {
    routes(publicByPath({ '/about': page({}) }), baseRoute('/api/content', { default: baseEntry('BASE-HEADER') }), pagePaths('/api/content'));
    const out = await html(await site.Page(params('about')));
    order(out, 'BASE-HEADER', 'Published hello', 'BASE-FOOTER');
    expect(out).toContain('href="/home-target"');
    expect(out).not.toContain('data-test-watcher');
    const [c] = baseCalls();
    expect(c.url.searchParams.get('id')).toBe('default');
    expect(c.url.searchParams.get('locale')).toBe('en-US');
    expect((c.init.headers as Record<string, string>).cookie).toBeUndefined();
  });

  it('explicit base with region modes: replace uses the page root region blocks, hide renders nothing', async () => {
    const own = content(heading('Published hello'));
    (own.data.root.props as Record<string, unknown>).region__header = [heading('OWN-HEADER', 'oh')];
    routes(
      publicByPath({ '/about': page({ content: own, layout: { baseId: B1, regions: { header: 'replace', footer: 'hide' } } }) }),
      baseRoute('/api/content', { [B1]: baseEntry('BASE-HEADER') }),
    );
    const out = await html(await site.Page(params('about')));
    order(out, 'OWN-HEADER', 'Published hello');
    expect(out).not.toContain('BASE-HEADER');
    expect(out).not.toContain('BASE-FOOTER');
    expect(baseCalls()[0].url.searchParams.get('id')).toBe(B1);
  });

  it('baseId null renders the page without a frame and fetches no base', async () => {
    routes(publicByPath({ '/about': page({ layout: { baseId: null } }) }), baseRoute('/api/content', { default: baseEntry('BASE-HEADER') }));
    const out = await html(await site.Page(params('about')));
    expect(out).toContain('Published hello');
    expect(out).not.toContain('BASE-HEADER');
    expect(baseCalls()).toHaveLength(0);
  });

  it('the public site uses the published base even when a draft exists', async () => {
    routes(
      publicByPath({ '/about': page({}) }),
      baseRoute('/api/content', { default: baseEntry('PUBLISHED-HEADER') }),
      baseRoute('/api/admin/content', { default: baseEntry('DRAFT-HEADER') }),
    );
    const out = await html(await site.Page(params('about')));
    expect(out).toContain('PUBLISHED-HEADER');
    expect(out).not.toContain('DRAFT-HEADER');
    expect(calls().every((c) => !c.url.pathname.startsWith('/api/admin'))).toBe(true);
  });

  it('draft mode uses the draft base in the preview locale with the session, uncached', async () => {
    state.draft = true;
    state.cookies = { opencloudcms_preview_locale: 'vi-VN' };
    state.headers = { cookie: SESSION };
    routes(
      adminMeta(),
      adminByPath(200, page({ locale: 'vi-VN', content: content(heading('Draft hello')) })),
      baseRoute('/api/content', { default: baseEntry('PUBLISHED-HEADER') }),
      baseRoute('/api/admin/content', { default: baseEntry('DRAFT-HEADER') }),
      pagePaths('/api/admin/content'),
    );
    const out = await html(await site.Page(params('about')));
    order(out, 'DRAFT-HEADER', 'Draft hello');
    expect(out).not.toContain('PUBLISHED-HEADER');
    const [c] = baseCalls();
    expect(c.url.pathname).toBe('/api/admin/content/opencloudcmsPage/base');
    expect(c.url.searchParams.get('locale')).toBe('vi-VN');
    expect((c.init.headers as Record<string, string>).cookie).toBe(SESSION);
    expect(c.init.cache).toBe('no-store');
  });

  it('a missing explicit base renders the page alone and warns once per base id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    routes(publicByPath({ '/about': page({ layout: { baseId: MISSING } }) }), baseRoute('/api/content', {}));
    for (let i = 0; i < 2; i++) {
      const out = await html(await site.Page(params('about')));
      expect(out).toContain('Published hello');
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(MISSING))).toHaveLength(1);
  });

  it('no default base: the page renders alone without a warning; "no default" is remembered for 30 s (published)', async () => {
    const own = createCmsPage({ blocks: defineBlocks([...coreBlocks, frame, modal]), baseUrl: BASE });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    routes(publicByPath({ '/about': page({}) }), baseRoute('/api/content', {}));
    expect(await html(await own.Page(params('about')))).toContain('Published hello');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('base'))).toHaveLength(0);
    expect(baseCalls()).toHaveLength(1);
    now += 29_000;
    expect(await html(await own.Page(params('about')))).toContain('Published hello');
    expect(baseCalls()).toHaveLength(1);
    now += 2_000;
    routes(publicByPath({ '/about': page({}) }), baseRoute('/api/content', { default: baseEntry('LATER-HEADER') }), pagePaths('/api/content'));
    expect(await html(await own.Page(params('about')))).toContain('LATER-HEADER');
    expect(baseCalls()).toHaveLength(2);
  });

  it('draft mode never uses the remembered "no default base"', async () => {
    const own = createCmsPage({ blocks: defineBlocks([...coreBlocks, frame, modal]), baseUrl: BASE });
    routes(publicByPath({ '/about': page({}) }), baseRoute('/api/content', {}));
    await html(await own.Page(params('about')));
    state.draft = true;
    state.headers = { cookie: SESSION };
    routes(adminMeta(), adminByPath(200, page({})), baseRoute('/api/admin/content', { default: baseEntry('DRAFT-HEADER') }), pagePaths('/api/admin/content'));
    expect(await html(await own.Page(params('about')))).toContain('DRAFT-HEADER');
  });

  it('a failing base fetch or a base that is not one layout block renders the page alone with a warning, never a 500', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const B2 = '33333333-3333-4333-8333-333333333333';
    const B3 = '44444444-4444-4444-8444-444444444444';
    routes(publicByPath({ '/about': page({ layout: { baseId: B2 } }) }), baseRoute('/api/content', {}, 500));
    expect(await html(await site.Page(params('about')))).toContain('Published hello');
    routes(
      publicByPath({ '/about': page({ layout: { baseId: B3 } }) }),
      baseRoute('/api/content', { [B3]: { ...baseEntry('x'), content: content(heading('NOT-A-FRAME')) } }),
    );
    const out = await html(await site.Page(params('about')));
    expect(out).toContain('Published hello');
    expect(out).not.toContain('NOT-A-FRAME');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(B2))).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(B3))).toHaveLength(1);
  });

  it('mounts the overlay route watcher when the composed page has an overlay or an action button', async () => {
    routes(publicByPath({ '/about': page({}) }), baseRoute('/api/content', { default: baseEntry('BASE-HEADER', [{ type: 'LienHe', props: { id: 'm1', _v: 1, name: 'lien-he' } }]) }), pagePaths('/api/content'));
    const out = await html(await site.Page(params('about')));
    expect(out).toContain('data-ocms-overlay="lien-he"');
    expect(out).toContain('data-test-watcher');
    const action = { type: 'Button', props: { id: 'ba', _v: 1, label: 'Open', action: { type: 'overlay', op: 'open', target: 'lien-he' }, variant: 'default', size: 'default' } };
    routes(publicByPath({ '/about': page({ layout: { baseId: null }, content: content(action) }) }));
    expect(await html(await site.Page(params('about')))).toContain('data-test-watcher');
  });
});
