// Detail templates on the website (spec §3, §4, decisions 1, 6): the route entry fills empty single-entry blocks,
// automatic entry links from the type's detail path, and `createCmsPage` rendering detail responses (404, SEO, cache).
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (!String(a[0]).startsWith('[Puck] AI agent detected')) warn(...a);
  };
});
const state = vi.hoisted(() => ({ draft: false, cookies: {} as Record<string, string>, headers: {} as Record<string, string> }));
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
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));

import {
  PUCK_FORMAT_VERSION,
  b,
  coreBlocks,
  defineBlock,
  defineBlocks,
  defineComposedBlock,
  resolvePage,
  type ComposedBlockSpec,
  type ContentFetcher,
  type Entry,
} from '../../blocks/src';
import { createCmsPage } from '../../blocks/src/next/page';

const html = (node: unknown) => renderToString(node as never);
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';

const spec = (over: Partial<ComposedBlockSpec>): ComposedBlockSpec => ({
  id: 'blk_detail1',
  name: 'ProductHero',
  label: { 'en-US': 'Product hero' },
  category: 'commerce',
  version: 1,
  binding: { apiId: 'product', mode: 'single' },
  fields: {},
  tree: {
    el: 'Card',
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Button', bind: { label: { from: 'const', value: 'Open' }, href: { from: 'entryUrl' } } },
    ],
  },
  ...over,
});
const hero = defineComposedBlock(spec({}));
const eventCard = defineComposedBlock(spec({ id: 'blk_detail2', name: 'EventCard', binding: { apiId: 'event', mode: 'single' } }));
const patterned = defineComposedBlock(spec({ id: 'blk_detail3', name: 'Patterned', binding: { apiId: 'product', mode: 'single', urlPattern: '/shop/{slug}' } }));
// Hand-written: two `b.entry` fields of the route type. The route entry is only for composed single bindings.
const handPicked = defineBlock({
  name: 'HandPicked',
  label: 'Hand picked',
  category: 'data',
  fields: { first: b.entry('product'), second: b.entry('product') },
  render: (p) => `${(p.first as Entry | null)?.name ?? 'none'}/${(p.second as Entry | null)?.name ?? 'none'}`,
});
const reg = defineBlocks([...coreBlocks, hero, eventCard, patterned, handPicked]);

const DP = { product: { path: '/products/{slug}', slugField: 'slug' }, event: { path: '/events/{id}' } };
const product = (id: string, name: string, extra: Record<string, unknown> = {}): Entry => ({ documentId: id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), ...extra });

const content = (...items: unknown[]) => ({ format: 'puck' as const, formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content: items } as never });
const item = (type: string, props: Record<string, unknown>, id = type) => ({ type, props: { id, _v: 1, ...props } });
const O = { locale: 'en-US', defaultLocale: 'en-US' } as const;

function fake(over: Partial<ContentFetcher> = {}): ContentFetcher {
  return {
    byIds: async (_apiId, ids) => ids.map((i) => product(i, `Picked ${i.slice(0, 2)}`)),
    query: async () => [],
    pagePaths: async () => ({}),
    detailPaths: async () => DP,
    ...over,
  };
}

async function resolved(items: unknown[], o: Record<string, unknown> = {}, f = fake()) {
  const out = await resolvePage(content(...items), reg, f, { ...O, ...o } as never);
  return out.content as { type: string; props: Record<string, unknown> }[];
}
const renderItem = (it0: { type: string; props: Record<string, unknown> }) => html(reg.get(it0.type)!.render(it0.props as never));

describe('resolvePage: route entry', () => {
  const route = { apiId: 'product', entry: product(P1, 'Route Shirt') };

  it('an empty single-entry block of the route type gets the route entry', async () => {
    const [a, b] = await resolved([item('ProductHero', { entry: null }, 'a'), item('ProductHero', {}, 'b')], { routeEntry: route });
    expect((a.props.entry as Entry).documentId).toBe(P1);
    expect((b.props.entry as Entry).documentId).toBe(P1);
    expect(renderItem(a)).toContain('Route Shirt');
  });

  it('a picked entry wins; a block of another type is not filled', async () => {
    const [a, b] = await resolved([item('ProductHero', { entry: { documentId: P2 } }, 'a'), item('EventCard', { entry: null }, 'b')], { routeEntry: route });
    expect((a.props.entry as Entry).documentId).toBe(P2);
    expect(b.props.entry).toBeNull();
  });

  it('hand-written blocks with empty b.entry fields of the route type stay empty', async () => {
    const [a, c] = await resolved([item('HandPicked', { first: null }, 'a'), item('HandPicked', { first: { documentId: P2 } }, 'c')], { routeEntry: route });
    expect(a.props.first).toBeNull();
    expect(a.props.second).toBeUndefined();
    expect(renderItem(a)).toBe('none/none');
    expect((c.props.first as Entry).documentId).toBe(P2);
  });

  it('without a route entry an empty block stays empty (pages render as before)', async () => {
    const [a] = await resolved([item('ProductHero', { entry: null })]);
    expect(a.props.entry).toBeNull();
    expect(renderItem(a)).toBe('');
  });

  it('a private route type (hidden by the fetcher) is never used', async () => {
    const [a] = await resolved([item('ProductHero', { entry: null })], { routeEntry: route }, fake({ privateApiIds: async () => new Set(['product']) }));
    expect(a.props.entry).toBeNull();
  });
});

describe('entryUrl: urlPattern, then the type detail path, else no link (spec §4)', () => {
  it('no urlPattern: /products/{slug} from the slug field', async () => {
    const [a] = await resolved([item('ProductHero', { entry: { documentId: P1 } })], {}, fake({ byIds: async () => [product(P1, 'Blue Shirt')] }));
    expect(a.props._detailPaths).toEqual(DP);
    expect(renderItem(a)).toContain('href="/products/blue-shirt"');
  });

  it('{id} paths use the documentId', async () => {
    const [a] = await resolved([item('EventCard', { entry: { documentId: E1 } })], {}, fake({ byIds: async () => [{ documentId: E1, name: 'Launch' }] }));
    expect(renderItem(a)).toContain(`href="/events/${E1}"`);
  });

  it('urlPattern wins over the detail path', async () => {
    const [a] = await resolved([item('Patterned', { entry: { documentId: P1 } })], {}, fake({ byIds: async () => [product(P1, 'Blue Shirt')] }));
    expect(renderItem(a)).toContain('href="/shop/blue-shirt"');
  });

  it('no detail path (or an unusable slug): no link', async () => {
    const none = fake({ detailPaths: async () => ({}), byIds: async () => [product(P1, 'Blue Shirt')] });
    const [a] = await resolved([item('ProductHero', { entry: { documentId: P1 } })], {}, none);
    expect(renderItem(a)).not.toContain('<a');
    const [b] = await resolved([item('ProductHero', { entry: { documentId: P1 } })], {}, fake({ byIds: async () => [product(P1, 'x', { slug: 'Not A Slug' })] }));
    expect(renderItem(b)).not.toContain('<a');
    const [c] = await resolved([item('ProductHero', { entry: { documentId: P1 } })], {}, fake({ byIds: async () => [product(P1, 'x', { slug: '' })] }));
    expect(renderItem(c)).not.toContain('<a');
  });
});

// ---- createCmsPage ----

const BASE = 'http://api.local:4100';
const cms = createCmsPage({ blocks: reg, baseUrl: BASE });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
const calls = () => fetchMock.mock.calls.map(([u, init]) => ({ url: new URL(u as string), init: (init ?? {}) as RequestInit }));
const params = (...path: string[]) => ({ params: Promise.resolve(path.length ? { path } : {}) });
async function page(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node as never);
  return new Response(prelude).text();
}

const template = (over: Record<string, unknown> = {}) => ({
  documentId: 'tpl1',
  locale: 'en-US',
  title: 'Product template',
  path: null,
  kind: 'detail',
  detailApiId: 'product',
  seo: null,
  layout: { baseId: null },
  content: content(item('ProductHero', { entry: null })),
  ...over,
});
const routeEntry = product(P1, 'Route Shirt', { summary: 'A soft cotton shirt.', price: { amount: 10, currency: 'USD' } });
const byPath = (prefix: string, map: Record<string, unknown>): Route => (url) =>
  url.pathname === `${prefix}/opencloudcmsPage/by-path`
    ? map[url.searchParams.get('path')!]
      ? json(200, map[url.searchParams.get('path')!])
      : json(404, { error: { message: 'No page' } })
    : undefined;
const detailPathsRoute: Route = (url) => (url.pathname === '/api/content/opencloudcmsPage/detail-paths' ? json(200, { data: DP }) : undefined);

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

describe('createCmsPage: detail responses', () => {
  it('renders the template with the route entry; links use the detail path; fetched like pages (cacheable)', async () => {
    routes(byPath('/api/content', { '/products/route-shirt': { data: template(), routeEntry, detail: { apiId: 'product' } } }), detailPathsRoute);
    const out = await page(await cms.Page(params('products', 'route-shirt')));
    expect(out).toContain('Route Shirt');
    expect(out).toContain('href="/products/route-shirt"');
    expect(calls().every((c) => !c.url.pathname.startsWith('/api/admin'))).toBe(true);
    // Same cache rules as pages: the public fetches are not no-store.
    expect(calls().every((c) => c.init.cache !== 'no-store')).toBe(true);
  });

  it('a missing entry (404) is notFound()', async () => {
    routes(byPath('/api/content', {}), detailPathsRoute);
    await expect(cms.Page(params('products', 'nope'))).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalled();
  });

  it('a detail response without a usable route entry is notFound(), never the bare template', async () => {
    routes(byPath('/api/content', { '/products/x': { data: template(), routeEntry: null, detail: { apiId: 'product' } } }), detailPathsRoute);
    await expect(cms.Page(params('products', 'x'))).rejects.toThrow(NOT_FOUND);
  });

  it('SEO: title and description default to the entry (title field, first text field), not the template title', async () => {
    routes(byPath('/api/content', { '/products/route-shirt': { data: template(), routeEntry, detail: { apiId: 'product' } } }), detailPathsRoute);
    const meta = await cms.generateMetadata(params('products', 'route-shirt'));
    expect(meta.title).toBe('Route Shirt');
    expect(meta.description).toBe('A soft cotton shirt.');
  });

  it('SEO: the template SEO settings override with {field} placeholders', async () => {
    const seo = { title: '{name} | Shop', description: 'Buy {name} now. {missing}' };
    routes(byPath('/api/content', { '/products/route-shirt': { data: template({ seo }), routeEntry, detail: { apiId: 'product' } } }), detailPathsRoute);
    const meta = await cms.generateMetadata(params('products', 'route-shirt'));
    expect(meta.title).toBe('Route Shirt | Shop');
    expect(meta.description).toBe('Buy Route Shirt now.');
  });

  it('draft mode: the admin by-path detail response (draft route entry) with the session, uncached', async () => {
    state.draft = true;
    state.headers = { cookie: 'opencloudcms_session=s1' };
    routes(
      (url) => (url.pathname === '/api/admin/meta' ? json(200, { defaultLocale: 'en-US', locales: ['en-US'] }) : undefined),
      // The admin fetcher reads the private types before using any entry (the route entry included).
      (url) => (url.pathname === '/api/admin/content-types' ? json(200, { data: [{ apiId: 'product', private: false }] }) : undefined),
      byPath('/api/admin/content', { '/products/route-shirt': { data: template(), routeEntry: product(P1, 'Draft Shirt'), detail: { apiId: 'product' } } }),
      detailPathsRoute,
    );
    const out = await page(await cms.Page(params('products', 'route-shirt')));
    expect(out).toContain('Draft Shirt');
    const admin = calls().filter((c) => c.url.pathname.startsWith('/api/admin'));
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((c) => c.init.cache === 'no-store')).toBe(true);
  });

  it('ordinary pages are unchanged: no route entry, an empty single block stays empty', async () => {
    routes(byPath('/api/content', { '/about': { data: template({ kind: 'page', path: '/about', title: 'About', detailApiId: null }) } }), detailPathsRoute);
    const out = await page(await cms.Page(params('about')));
    expect(out).not.toContain('Route Shirt');
    expect((await cms.generateMetadata(params('about'))).title).toBe('About');
  });
});
