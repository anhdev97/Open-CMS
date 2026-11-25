import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUCK_FORMAT_VERSION, adminFetcher, b, defineBlock, defineBlocks, publicFetcher, resolvePage, type ContentFetcher, type Entry } from '../../blocks/src';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';

const Product = defineBlock({ name: 'Product', label: 'P', category: 'data', fields: { item: b.entry('product') }, render: () => null });
const Grid = defineBlock({
  name: 'Grid',
  label: 'G',
  category: 'data',
  fields: { items: b.entries('product'), items2: b.entries('post'), body: b.slot() },
  render: () => null,
});
const Links = defineBlock({
  name: 'Links',
  label: 'L',
  category: 'data',
  fields: { link: b.link(), rows: b.list({ to: b.link(), item: b.entry('product'), inner: b.slot() }) },
  render: () => null,
});
const reg = defineBlocks([Product, Grid, Links]);

const item = (type: string, props: Record<string, unknown>, id = type) => ({ type, props: { id, _v: 1, ...props } });
const page = (content: unknown[], zones?: Record<string, unknown[]>) => ({
  format: 'puck' as const,
  formatVersion: PUCK_FORMAT_VERSION,
  data: { root: { props: {} }, content, ...(zones ? { zones } : {}) } as never,
});
const ent = (documentId: string, extra: Record<string, unknown> = {}): Entry => ({ documentId, ...extra });
const O = { locale: 'vi-VN', defaultLocale: 'en-US' } as never;

function fake(over: Partial<ContentFetcher> = {}) {
  const calls = { byIds: [] as unknown[][], query: [] as unknown[][], pagePaths: [] as unknown[][] };
  const f: ContentFetcher = {
    byIds: async (apiId, ids, locale) => {
      calls.byIds.push([apiId, ids, locale]);
      return ids.filter((i) => i !== C).map((i) => ent(i, { n: i }));
    },
    query: async (apiId, q, locale) => {
      calls.query.push([apiId, q, locale]);
      return [ent('q1')];
    },
    pagePaths: async (ids, locale, d) => {
      calls.pagePaths.push([ids, locale, d]);
      return Object.fromEntries(ids.map((i) => [i, i === P1 ? '/vi' : null]));
    },
    ...over,
  };
  return { f, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('resolvePage', () => {
  it('batches entry + pick into one byIds per apiId and keeps pick order', async () => {
    const { f, calls } = fake();
    const out = await resolvePage(
      page([
        item('Product', { item: { documentId: A } }, 'p1'),
        item('Product', { item: { documentId: B } }, 'p2'),
        item('Grid', { items: { mode: 'pick', ids: [C, B, A] }, items2: { mode: 'pick', ids: [] }, body: [] }),
      ]),
      reg,
      f,
      O,
    );
    expect(calls.byIds).toEqual([['product', [A, B, C], 'vi-VN']]);
    expect(calls.query).toEqual([]);
    expect(calls.pagePaths).toEqual([]);
    const [p1, p2, g] = out.content as any[];
    expect(p1.props.item).toEqual(ent(A, { n: A }));
    expect(p2.props.item.documentId).toBe(B);
    // C missing -> dropped, order of the pick preserved
    expect(g.props.items.map((e: Entry) => e.documentId)).toEqual([B, A]);
  });

  it('missing entry resolves to null', async () => {
    const { f } = fake();
    const out = await resolvePage(page([item('Product', { item: { documentId: C } })]), reg, f, O);
    expect((out.content[0] as any).props.item).toBeNull();
    const none = await resolvePage(page([item('Product', { item: null })]), reg, f, O);
    expect((none.content[0] as any).props.item).toBeNull();
  });

  it('runs identical queries once; distinct queries separately', async () => {
    const { f, calls } = fake();
    const q = { mode: 'query', filter: { slug: 'x' }, sort: 'createdAt:desc', limit: 3 };
    const out = await resolvePage(
      page([
        item('Grid', { items: q, items2: { mode: 'query', limit: 5 } }, 'g1'),
        item('Grid', { items: { ...q }, items2: { mode: 'query', limit: 6 } }, 'g2'),
      ]),
      reg,
      f,
      O,
    );
    expect(calls.query).toHaveLength(3);
    expect(calls.query[0]).toEqual(['product', { filter: { slug: 'x' }, sort: 'createdAt:desc', limit: 3 }, 'vi-VN']);
    expect((out.content[1] as any).props.items).toEqual([ent('q1')]);
  });

  it('a rejected query yields [] and one warning per (apiId, filter)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f } = fake({ query: async () => Promise.reject(Object.assign(new Error('field not indexed'), { status: 400 })) });
    const out = await resolvePage(
      page([
        item('Grid', { items: { mode: 'query', filter: { sku: 'a' }, limit: 2 }, items2: { mode: 'query', filter: { sku: 'a' } } }, 'g1'),
        item('Grid', { items: { mode: 'query', filter: { sku: 'a' }, limit: 9 } }, 'g2'),
      ]),
      reg,
      f,
      O,
    );
    const [g1, g2] = out.content as any[];
    expect(g1.props.items).toEqual([]);
    expect(g1.props.items2).toEqual([]);
    expect(g2.props.items).toEqual([]);
    // product/sku:a (limit 2 and 9) -> one warning; post/sku:a -> another
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('"product"');
    expect(warn.mock.calls[0][0]).toContain('field not indexed');
  });

  it('a rejected byIds (404 / network) gives null and [] with one warning per apiId', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f } = fake({ byIds: async () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })) });
    const out = await resolvePage(
      page([
        item('Product', { item: { documentId: A } }, 'p1'),
        item('Product', { item: { documentId: B } }, 'p2'),
        item('Grid', { items: { mode: 'pick', ids: [A, B] }, items2: { mode: 'pick', ids: [C] } }),
      ]),
      reg,
      f,
      O,
    );
    const [p1, p2, g] = out.content as any[];
    expect(p1.props.item).toBeNull();
    expect(p2.props.item).toBeNull();
    expect(g.props.items).toEqual([]);
    expect(g.props.items2).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2); // product, post
    expect(warn.mock.calls[0][0]).toContain('"product"');
    expect(warn.mock.calls[0][0]).toContain('Not Found');
  });

  it('a rejected pagePaths gives href null with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f } = fake({ pagePaths: async () => Promise.reject(new Error('boom')) });
    const out = await resolvePage(
      page([item('Links', { link: { kind: 'page', documentId: P1 }, rows: [{ to: { kind: 'page', documentId: P2 } }] })]),
      reg,
      f,
      O,
    );
    const l = (out.content[0] as any).props;
    expect(l.link).toEqual({ href: null });
    expect(l.rows[0].to).toEqual({ href: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('boom');
  });

  it('resolves page links via one pagePaths call; url links pass through', async () => {
    const { f, calls } = fake({
      pagePaths: async (ids) => Object.fromEntries(ids.map((i) => [i, i === P1 ? '/vi' : i === P2 ? '/en' : null])),
    });
    const out = await resolvePage(
      page([
        item('Links', { link: { kind: 'page', documentId: P1 }, rows: [{ to: { kind: 'page', documentId: P2 }, item: null, inner: [] }, { to: { kind: 'page', documentId: C } }] }),
        item('Links', { link: { kind: 'url', href: 'https://x.dev' }, rows: [] }, 'l2'),
        item('Links', { link: null, rows: [] }, 'l3'),
      ]),
      reg,
      f,
      O,
    );
    const [l1, l2, l3] = out.content as any[];
    expect(l1.props.link).toEqual({ href: '/vi' });
    expect(l1.props.rows[0].to).toEqual({ href: '/en' });
    expect(l1.props.rows[1].to).toEqual({ href: null });
    expect(l2.props.link).toEqual({ href: 'https://x.dev' });
    expect(l3.props.link).toEqual({ href: null });
  });

  it('calls pagePaths once with locale and defaultLocale', async () => {
    const { f, calls } = fake();
    await resolvePage(
      page([item('Links', { link: { kind: 'page', documentId: P1 }, rows: [{ to: { kind: 'page', documentId: P2 } }] })]),
      reg,
      f,
      O,
    );
    expect(calls.pagePaths).toEqual([[[P1, P2], 'vi-VN', 'en-US']]);
  });

  it('resolves nested slots, zones, list rows (incl. slots in rows); passes unknown blocks through', async () => {
    const { f, calls } = fake();
    const unknown = { type: 'Gone', props: { id: 'x', item: { documentId: A }, nested: [item('Product', { item: { documentId: B } })] } };
    const out = await resolvePage(
      page(
        [
          item('Grid', {
            items: { mode: 'pick', ids: [] },
            items2: { mode: 'pick', ids: [] },
            body: [item('Product', { item: { documentId: A } }, 'in1')],
          }),
          item('Links', { link: null, rows: [{ to: null, item: { documentId: B }, inner: [item('Product', { item: { documentId: C } }, 'in2')] }] }, 'l'),
          unknown,
        ],
        { 'z:main': [item('Product', { item: { documentId: A } }, 'z1')] },
      ),
      reg,
      f,
      O,
    );
    expect(calls.byIds).toHaveLength(1);
    expect(calls.byIds[0][1]).toEqual([A, B, C]);
    const c = out.content as any[];
    expect(c[0].props.body[0].props.item.documentId).toBe(A);
    expect(c[1].props.rows[0].item.documentId).toBe(B);
    expect(c[1].props.rows[0].inner[0].props.item).toBeNull();
    expect((out.zones as any)['z:main'][0].props.item.documentId).toBe(A);
    expect(c[2]).toEqual(unknown);
  });

  it('a stored binding to a private type resolves to nothing, without fetching it', async () => {
    const privateApiIds = vi.fn(async () => new Set(['post']));
    const { f, calls } = fake({ privateApiIds });
    const out = await resolvePage(
      page([
        item('Product', { item: { documentId: A } }, 'p1'),
        item('Grid', { items: { mode: 'pick', ids: [B] }, items2: { mode: 'pick', ids: [A] }, body: [] }, 'g1'),
        item('Grid', { items: { mode: 'query', limit: 2 }, items2: { mode: 'query', limit: 3 }, body: [] }, 'g2'),
      ]),
      reg,
      f,
      O,
    );
    expect(privateApiIds).toHaveBeenCalledTimes(1);
    expect(calls.byIds).toEqual([['product', [A, B], 'vi-VN']]);
    expect(calls.query.map((c) => c[0])).toEqual(['product']);
    const [p1, g1, g2] = out.content as any[];
    expect(p1.props.item.documentId).toBe(A);
    expect(g1.props.items2).toEqual([]);
    expect(g2.props.items2).toEqual([]);
    expect(g2.props.items).toEqual([ent('q1')]);
  });

  it('an entry bound to a private type resolves to null; a failing private-type lookup fetches no entries', async () => {
    const { f, calls } = fake({ privateApiIds: async () => new Set(['product']) });
    const out = await resolvePage(page([item('Product', { item: { documentId: A } })]), reg, f, O);
    expect((out.content as any[])[0].props.item).toBeNull();
    expect(calls.byIds).toEqual([]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = fake({ privateApiIds: async () => Promise.reject(new Error('down')) });
    const out2 = await resolvePage(page([item('Product', { item: { documentId: A } })]), reg, failing.f, O);
    expect((out2.content as any[])[0].props.item).toBeNull();
    expect(failing.calls.byIds).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not ask for private types when nothing is data-bound', async () => {
    const privateApiIds = vi.fn(async () => new Set<string>());
    await resolvePage(page([item('Links', { link: { kind: 'url', href: '/x' } })]), reg, fake({ privateApiIds }).f, O);
    expect(privateApiIds).not.toHaveBeenCalled();
  });

  it('makes no requests for pages without data-bound fields and tolerates empty content', async () => {
    const { f, calls } = fake();
    const out = await resolvePage(null as never, reg, f, O);
    expect(out.content).toEqual([]);
    expect(calls.byIds.length + calls.query.length + calls.pagePaths.length).toBe(0);
  });
});

function mockFetch(responder: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const { status = 200, body = { data: [] } } = responder(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

describe('fetchers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('publicFetcher byIds / query build /api/content URLs', async () => {
    const calls = mockFetch(() => ({ body: { data: [{ documentId: A }] } }));
    const f = publicFetcher('http://h:4000/');
    expect(await f.byIds('product', [A, B], 'vi-VN')).toEqual([{ documentId: A }]);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe('http://h:4000/api/content/product');
    expect(u.searchParams.get('filter[documentId][in]')).toBe(`${A},${B}`);
    expect(u.searchParams.get('locale')).toBe('vi-VN');
    expect(u.searchParams.get('limit')).toBe('100');
    expect(u.searchParams.has('status')).toBe(false);

    await f.query('product', { filter: { slug: 'a b' }, sort: 'createdAt:desc', limit: 4 }, 'en-US');
    const q = new URL(calls[1].url);
    expect(q.searchParams.get('filter[slug]')).toBe('a b');
    expect(q.searchParams.get('sort')).toBe('createdAt:desc');
    expect(q.searchParams.get('limit')).toBe('4');
    expect((calls[1].init as RequestInit).credentials).toBeUndefined();
    expect((calls[1].init as RequestInit).cache).toBeUndefined();
  });

  it('byIds splits more than 100 ids into several requests', async () => {
    const calls = mockFetch(() => ({}));
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await publicFetcher('http://h').byIds('product', ids, 'en-US');
    expect(calls).toHaveLength(2);
  });

  it('adminFetcher: draft status, browser sends credentials, server forwards the cookie', async () => {
    const calls = mockFetch(() => ({}));
    await adminFetcher('http://h').byIds('product', [A], 'en-US');
    expect(new URL(calls[0].url).pathname).toBe('/api/admin/content/product');
    expect(new URL(calls[0].url).searchParams.get('status')).toBe('draft');
    expect((calls[0].init as RequestInit).credentials).toBe('include');

    await adminFetcher('http://h', { cookie: 'sid=1' }).byIds('product', [A], 'en-US');
    const init = calls[1].init as RequestInit;
    expect((init.headers as Record<string, string>).cookie).toBe('sid=1');
    expect(init.credentials).toBeUndefined();
    // Drafts are never cached (browser or Next fetch cache).
    expect(calls.map((c) => (c.init as RequestInit).cache)).toEqual(['no-store', 'no-store']);
  });

  it('adminFetcher.privateApiIds reads the admin type list once; publicFetcher has none (the API answers 404)', async () => {
    const calls = mockFetch(() => ({ body: { data: [{ apiId: 'order', private: true }, { apiId: 'product' }] } }));
    const f = adminFetcher('http://h');
    expect([...(await f.privateApiIds!())]).toEqual(['order']);
    await f.privateApiIds!();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/admin/content-types']);
    expect(publicFetcher('http://h').privateApiIds).toBeUndefined();
  });

  it('non-2xx throws an Error carrying status', async () => {
    mockFetch(() => ({ status: 400, body: { error: { message: 'not indexed' } } }));
    await expect(publicFetcher('http://h').query('product', { limit: 1 }, 'en-US')).rejects.toMatchObject({ message: 'not indexed', status: 400 });
  });

  it('pagePaths uses the locale path, then the defaultLocale path, else null', async () => {
    const calls = mockFetch((url) => {
      const u = new URL(url);
      const loc = u.searchParams.get('locale');
      if (loc === 'vi-VN') return { body: { data: [{ documentId: P1, path: '/vi' }] } };
      return { body: { data: [{ documentId: P2, path: '/en' }] } };
    });
    const out = await publicFetcher('http://h').pagePaths([P1, P2, C], 'vi-VN', 'en-US');
    expect(out).toEqual({ [P1]: '/vi', [P2]: '/en', [C]: null });
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe('/api/content/opencloudcmsPage');
    expect(new URL(calls[1].url).searchParams.get('filter[documentId][in]')).toBe(`${P2},${C}`);
  });

  it('pagePaths in the default locale makes one request', async () => {
    const calls = mockFetch(() => ({ body: { data: [] } }));
    expect(await adminFetcher('http://h').pagePaths([P1], 'en-US', 'en-US')).toEqual({ [P1]: null });
    expect(calls).toHaveLength(1);
  });
});
