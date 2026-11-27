// CollectionList (spec §1, §4, decision 9; plan Review Focus 5): generated `b.entries` fields per list, batched
// resolution, rendering in place, list links, server checks against content types, and an anonymous fetcher that
// never returns drafts for lists.
import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineContentType, f, validateComposedSpec, type ComposedNode, type ContentTypeDefinition } from '@opencloudcms/schema';
import {
  PUCK_FORMAT_VERSION,
  defineBlocks,
  defineComposedBlock,
  publicFetcher,
  resolvePage,
  type ComposedBlockSpec,
  type ContentFetcher,
  type Entry,
} from '../../blocks/src';
import { checkSpecAgainstTypes } from '../../src/block-builder/blocks-checks';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

afterEach(() => vi.restoreAllMocks());

const html = (node: unknown) => renderToString(node as never);
const count = (s: string, sub: string) => s.split(sub).length - 1;

const base = (over: Partial<ComposedBlockSpec>): ComposedBlockSpec => ({
  id: 'blk_test01',
  name: 'Questions',
  label: { 'en-US': 'Questions' },
  category: 'content',
  version: 1,
  fields: {},
  tree: { el: 'Box' },
  ...over,
});

const card = (): ComposedNode => ({
  el: 'Card',
  children: [
    { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'q' } } },
    { el: 'Text', bind: { text: { from: 'entry', path: 'a' } } },
  ],
});

const list = (props: Record<string, unknown>, children: ComposedNode[] = [card()]): ComposedNode => ({ el: 'CollectionList', props, children });

const questions = (listProps: Record<string, unknown> = {}) =>
  base({
    fields: { title: { kind: 'text', default: 'Frequently asked' } },
    tree: {
      el: 'Stack',
      children: [
        { el: 'Heading', bind: { text: { from: 'field', name: 'title' } } },
        list({ key: 'list', apiId: 'question', limit: 5, ...listProps }),
        { el: 'Button', bind: { label: { from: 'const', value: 'See all' }, href: { from: 'const', value: '/faq' } } },
      ],
    },
  });

const page = (...items: unknown[]) => ({
  format: 'puck' as const,
  formatVersion: PUCK_FORMAT_VERSION,
  data: { root: { props: {} }, content: items } as never,
});
const item = (type: string, props: Record<string, unknown>, id = type) => ({ type, props: { id, _v: 1, ...props } });
const O = { locale: 'en-US', defaultLocale: 'en-US' } as never;

const q = (n: number, extra: Record<string, unknown> = {}): Entry => ({ documentId: `q${n}`, q: `Question ${n}?`, a: `Answer ${n}.`, ...extra });

function fake(over: Partial<ContentFetcher> = {}) {
  const calls = { query: [] as unknown[][] };
  const f: ContentFetcher = {
    byIds: async () => [],
    query: async (apiId, qq, locale) => {
      calls.query.push([apiId, qq, locale]);
      const cat = qq.filter?.category;
      return Array.from({ length: Math.min(qq.limit, 3) }, (_, i) => q(i + 1, cat ? { q: `${cat} question ${i + 1}?` } : {}));
    },
    pagePaths: async () => ({}),
    ...over,
  };
  return { f, calls };
}

/** Rendered HTML of the first block of a resolved page. */
async function renderPage(def: ReturnType<typeof defineComposedBlock>, props: Record<string, unknown>, f: ContentFetcher, o: object = {}) {
  const reg = defineBlocks([def]);
  const out = await resolvePage(page(item(def.name, props)), reg, f, { ...(O as object), ...o } as never);
  const [it0] = out.content as { props: Record<string, unknown> }[];
  return { props: it0.props, html: html(def.render(it0.props as never)) };
}

describe('CollectionList: generated fields', () => {
  it('the Questions spec is valid', () => {
    expect(validateComposedSpec(questions())).toEqual([]);
  });

  it('one b.entries field per list (named after its key) with base filter/sort/limit locks and a query default', () => {
    const def = defineComposedBlock(
      questions({ filter: [{ field: 'category', value: 'shipping' }], sort: { field: 'order', direction: 'asc' } }),
    );
    expect(Object.keys(def.fields)).toEqual(['title', 'list']);
    expect(def.fields.list).toMatchObject({
      kind: 'entries',
      apiId: 'question',
      limit: 5,
      sortable: false,
      filterable: false,
      baseFilter: { category: 'shipping' },
      defaultSort: 'order:asc',
      lockLimit: true,
      default: { mode: 'query', limit: 5, sort: 'order:asc' },
    });
  });

  it('limit defaults to 12; editor options unlock sort/filter/limit and add a <key>__layout select', () => {
    const def = defineComposedBlock(
      questions({ limit: undefined, layout: { kind: 'carousel', columns: 2 }, editor: { filter: true, sort: true, limit: true, layout: true } }),
    );
    expect(def.fields.list).toMatchObject({ limit: 12, sortable: true, filterable: true, lockLimit: false, default: { mode: 'query', limit: 12 } });
    const layout = def.fields.list__layout as { kind: string; default: string; options: { value: string }[] };
    expect(layout.kind).toBe('select');
    expect(layout.default).toBe('carousel-2');
    expect(layout.options.map((o) => o.value)).toContain('carousel-6');
    // Labels say which list an option belongs to.
    expect((def.fields.list as { label: Record<string, string> }).label['en-US']).toBe('list · Entries');
    expect((layout as unknown as { label: Record<string, string> }).label['en-US']).toBe('list · Layout');
    // Valid for defineBlocks (the __layout suffix is a generated name no manual field can take).
    expect(() => defineBlocks([def])).not.toThrow();
  });
});

describe('CollectionList: resolve and render', () => {
  it('Questions: the Heading renders once and one card per entry', async () => {
    const { f, calls } = fake();
    const def = defineComposedBlock(questions());
    const r = await renderPage(def, { title: 'Frequently asked', list: { mode: 'query', limit: 5 } }, f);
    expect(calls.query).toEqual([['question', { filter: undefined, sort: undefined, limit: 5 }, 'en-US']]);
    expect(count(r.html, 'Frequently asked')).toBe(1);
    expect(count(r.html, 'See all')).toBe(1);
    expect(count(r.html, 'data-slot="card"')).toBe(3);
    for (const n of [1, 2, 3]) expect(r.html).toContain(`Question ${n}?`);
    // Default layout: a 3 column grid placed between the heading and the button.
    expect(r.html.indexOf('Frequently asked')).toBeLessThan(r.html.indexOf('Question 1?'));
    expect(r.html.indexOf('Question 3?')).toBeLessThan(r.html.indexOf('See all'));
  });

  it('a page saved before the list existed resolves the list with its default query', async () => {
    const { f, calls } = fake();
    const def = defineComposedBlock(questions());
    const r = await renderPage(def, { title: 'T' }, f);
    expect(calls.query).toHaveLength(1);
    expect(count(r.html, 'data-slot="card"')).toBe(3);
  });

  it('two lists of one type with different filters resolve separately; editor limit on list2 only changes list2', async () => {
    const spec = base({
      tree: {
        el: 'Stack',
        children: [
          list({ key: 'list', apiId: 'question', limit: 3, filter: [{ field: 'category', value: 'a' }] }),
          list({ key: 'list2', apiId: 'question', limit: 4, filter: [{ field: 'category', value: 'b' }], editor: { limit: true } }),
        ],
      },
    });
    expect(validateComposedSpec(spec)).toEqual([]);
    const def = defineComposedBlock(spec);
    const { f, calls } = fake();
    // Stored limits: list is locked (its 9 is ignored), list2 is editable.
    const r = await renderPage(def, { list: { mode: 'query', limit: 9 }, list2: { mode: 'query', limit: 2 } }, f);
    expect(calls.query).toEqual([
      ['question', { filter: { category: 'a' }, sort: undefined, limit: 3 }, 'en-US'],
      ['question', { filter: { category: 'b' }, sort: undefined, limit: 2 }, 'en-US'],
    ]);
    expect((r.props.list as Entry[]).map((e) => e.q)).toEqual(['a question 1?', 'a question 2?', 'a question 3?']);
    expect((r.props.list2 as Entry[]).map((e) => e.q)).toEqual(['b question 1?', 'b question 2?']);
    expect(count(r.html, 'a question')).toBe(3);
    expect(count(r.html, 'b question')).toBe(2);
    expect(r.html.indexOf('a question 3?')).toBeLessThan(r.html.indexOf('b question 1?'));
  });

  it('an unlocked list limit is clamped to 50 (CollectionList max); block-level collections keep 100', async () => {
    const def = defineComposedBlock(questions({ editor: { limit: true } }));
    expect(def.fields.list).toMatchObject({ maxLimit: 50 });
    const { f, calls } = fake();
    await renderPage(def, { list: { mode: 'query', limit: 80 } }, f);
    expect((calls.query[0][1] as { limit: number }).limit).toBe(50);
    const block = defineComposedBlock(
      base({ name: 'Coll', binding: { apiId: 'question', mode: 'collection', options: { editorLimit: true } }, tree: card() }),
    );
    expect((block.fields.entries as { maxLimit?: number }).maxLimit).toBeUndefined();
    const other = fake();
    await renderPage(block, { entries: { mode: 'query', limit: 80 } }, other.f);
    expect((other.calls.query[0][1] as { limit: number }).limit).toBe(80);
  });

  it('an empty list shows emptyText in _locale; without emptyText nothing (editor: a placeholder)', async () => {
    const empty = fake({ query: async () => [] }).f;
    const withText = defineComposedBlock(questions({ emptyText: { 'en-US': 'No questions yet', 'vi-VN': 'Chưa có câu hỏi' } }));
    const r = await renderPage(withText, { title: 'T', list: { mode: 'query' } }, empty);
    expect(r.html).toContain('No questions yet');
    expect(r.html).toContain('T');
    const vi = await renderPage(withText, { title: 'T', list: { mode: 'query' } }, empty, { locale: 'vi-VN' });
    expect(vi.html).toContain('Chưa có câu hỏi');
    const plain = defineComposedBlock(questions());
    const none = await renderPage(plain, { title: 'T', list: { mode: 'query' } }, empty);
    expect(none.html).not.toContain('data-composed-placeholder');
    expect(html(plain.render({ title: 'T', list: [], _editor: true, _locale: 'en-US' } as never))).toContain('data-composed-placeholder');
  });

  it('layouts reuse the collection markup; the editor layout field wins when editor.layout is on', () => {
    const entries = [q(1), q(2)];
    const grid = defineComposedBlock(questions({ layout: { kind: 'grid', columns: 4 } }));
    expect(html(grid.render({ list: entries } as never))).toContain('lg:grid-cols-4');
    const ls = defineComposedBlock(questions({ layout: { kind: 'list' } }));
    expect(html(ls.render({ list: entries } as never))).not.toContain('grid-cols');
    const car = defineComposedBlock(questions({ layout: { kind: 'carousel', columns: 2 } }));
    expect(html(car.render({ list: entries } as never))).toContain('data-ocms-carousel-track');
    const ed = defineComposedBlock(questions({ layout: { kind: 'grid', columns: 4 }, editor: { layout: true } }));
    const listed = html(ed.render({ list: entries, list__layout: 'list' } as never));
    expect(listed).not.toContain('grid-cols');
    // Without editor.layout a stored value is ignored.
    expect(html(grid.render({ list: entries, list__layout: 'list' } as never))).toContain('lg:grid-cols-4');
  });

  it('anchorId and style of the list apply to its container', () => {
    const def = defineComposedBlock(questions({ anchorId: 'faq' }));
    expect(html(def.render({ list: [q(1)] } as never))).toContain('id="faq"');
  });
});

describe('CollectionList: entry links (spec §4, decision 9)', () => {
  const linked = (listProps: Record<string, unknown>, binding?: ComposedBlockSpec['binding']) =>
    base({
      ...(binding ? { binding } : {}),
      tree: {
        el: 'Stack',
        children: [
          list({ key: 'list', apiId: 'question', ...listProps }, [
            { el: 'Button', bind: { label: { from: 'entry', path: 'q' }, href: { from: 'entryUrl' } } },
          ]),
        ],
      },
    });
  const DP = { question: { path: '/faq/{slug}', slugField: 'slug' } };

  it('the list urlPattern wins', () => {
    const def = defineComposedBlock(linked({ urlPattern: '/q/{slug}' }));
    expect(html(def.render({ list: [q(1, { slug: 'one' })], _detailPaths: DP } as never))).toContain('href="/q/one"');
  });

  it('without a list urlPattern: the type detail path; the block single-binding urlPattern never applies', () => {
    const def = defineComposedBlock(linked({}, { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' }));
    const out = html(def.render({ entry: { documentId: 'p', slug: 'shirt' }, list: [q(1, { slug: 'one' })], _detailPaths: DP } as never));
    expect(out).toContain('href="/faq/one"');
    expect(out).not.toContain('/products/');
  });

  it('no urlPattern and no detail path: no link', () => {
    const def = defineComposedBlock(linked({}));
    const out = html(def.render({ list: [q(1, { slug: 'one' })] } as never));
    expect(out).not.toContain('<a');
    expect(out).toContain('Question 1?');
  });

  it('resolvePage stamps _detailPaths for blocks that link through detail paths (fetched once when not given)', async () => {
    const def = defineComposedBlock(linked({}));
    const detailPaths = vi.fn(async () => DP);
    const { f } = fake({ detailPaths, query: async () => [q(1, { slug: 'one' })] });
    const r = await renderPage(def, { list: { mode: 'query' } }, f);
    expect(detailPaths).toHaveBeenCalledTimes(1);
    expect(r.props._detailPaths).toEqual(DP);
    expect(r.html).toContain('href="/faq/one"');
    // Given in the options: no fetch.
    const given = vi.fn(async () => ({}));
    const r2 = await renderPage(def, { list: { mode: 'query' } }, fake({ detailPaths: given, query: async () => [q(1, { slug: 'two' })] }).f, { detailPaths: DP });
    expect(given).not.toHaveBeenCalled();
    expect(r2.html).toContain('href="/faq/two"');
  });

  it('no block needs detail paths: they are not fetched', async () => {
    const detailPaths = vi.fn(async () => DP);
    const def = defineComposedBlock(linked({ urlPattern: '/q/{slug}' }));
    await renderPage(def, { list: { mode: 'query' } }, fake({ detailPaths }).f);
    expect(detailPaths).not.toHaveBeenCalled();
  });

  it('a failing detail-paths fetch renders without links (warning), never breaks the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const def = defineComposedBlock(linked({}));
    const r = await renderPage(def, { list: { mode: 'query' } }, fake({ detailPaths: async () => Promise.reject(new Error('down')), query: async () => [q(1, { slug: 'one' })] }).f);
    expect(r.html).toContain('Question 1?');
    expect(r.html).not.toContain('<a');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionList: server checks against content types', () => {
  const question = defineContentType({
    id: 'ct_quest01', apiId: 'question', displayName: 'Question',
    fields: { q: f.text({ id: 'fld_qq0001' }), a: f.longText({ id: 'fld_qa0001' }), category: f.text({ id: 'fld_qc0001', indexed: true }), color: f.text({ id: 'fld_qk0001' }) },
  } as never);
  const secret = defineContentType({ id: 'ct_secr01', apiId: 'secret', displayName: 'Secret', private: true, fields: { q: f.text({ id: 'fld_sq0001' }) } } as never);
  const types = [question, secret] as ContentTypeDefinition[];

  it('a list of an unknown or private type is an issue on its apiId', () => {
    expect(checkSpecAgainstTypes(questions({ apiId: 'nope' }), types)).toEqual([
      { path: ['tree', 'children', 1, 'props', 'apiId'], message: 'unknown content type "nope"' },
    ]);
    expect(checkSpecAgainstTypes(questions({ apiId: 'secret' }), types)).toEqual([
      { path: ['tree', 'children', 1, 'props', 'apiId'], message: 'content type "secret" is private and cannot be listed' },
    ]);
  });

  it('entry paths, filter and sort inside a list are checked against the list type', () => {
    expect(checkSpecAgainstTypes(questions(), types)).toEqual([]);
    const issues = checkSpecAgainstTypes(questions({ filter: [{ field: 'color', value: 'red' }], sort: { field: 'nope', direction: 'asc' } }), types);
    expect(issues).toEqual([
      { path: ['tree', 'children', 1, 'props', 'filter', 0, 'field'], message: 'field "color" is not indexed; filters need an indexed or unique field' },
      { path: ['tree', 'children', 1, 'props', 'sort', 'field'], message: 'field "nope" does not exist on "question"' },
    ]);
    const bad = questions();
    (bad.tree.children![1].children![0].children![0].bind!.text as { path: string }).path = 'missing';
    expect(checkSpecAgainstTypes(bad, types)).toEqual([
      { path: ['tree', 'children', 1, 'children', 0, 'children', 0, 'bind', 'text', 'path'], message: 'field "missing" does not exist on "question"' },
    ]);
  });
});

describe('CollectionList: the anonymous fetcher never returns drafts (Postgres)', () => {
  let t: CoreTestApp;
  let call: (p: string, init?: RequestInit) => Promise<{ status: number; body: any }>;
  const type = defineContentType({
    id: 'ct_clq001', apiId: 'question', displayName: 'Question',
    fields: { q: f.text({ id: 'fld_clqq01' }), a: f.longText({ id: 'fld_clqa01' }) },
  } as never);

  beforeAll(async () => {
    t = await createCoreTestApp({ locales: ['en-US'], defaultLocale: 'en-US' });
    const PW = 'correct horse battery';
    await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    const cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    call = async (p, init = {}) => {
      const res = await fetch(`${t.baseUrl}${p}`, { ...init, headers: { cookie, origin: t.url, 'content-type': 'application/json' } });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    expect((await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: type }) })).status).toBe(200);
  }, 180_000);
  afterAll(async () => {
    await t?.close();
  });

  it('published values only: draft edits, draft-only and unpublished entries never reach a list', async () => {
    const mk = async (body: unknown) => (await call('/api/admin/content/question?locale=en-US', { method: 'POST', body: JSON.stringify(body) })).body.data.documentId as string;
    const pub = (id: string) => call(`/api/admin/content/question/${id}/publish`, { method: 'POST' });
    const a = await mk({ q: 'Published A', a: 'x' });
    expect((await pub(a)).status).toBeLessThan(300);
    expect((await call(`/api/admin/content/question/${a}?locale=en-US`, { method: 'PATCH', body: JSON.stringify({ q: 'Draft edit A' }) })).status).toBe(200);
    await mk({ q: 'Draft only B', a: 'x' });
    const c = await mk({ q: 'Gone C', a: 'x' });
    await pub(c);
    expect((await call(`/api/admin/content/question/${c}/unpublish`, { method: 'POST' })).status).toBeLessThan(300);

    const def = defineComposedBlock(questions());
    const r = await renderPage(def, { title: 'T', list: { mode: 'query', limit: 50 } }, publicFetcher(t.baseUrl));
    expect(r.html).toContain('Published A');
    expect(r.html).not.toContain('Draft edit A');
    expect(r.html).not.toContain('Draft only B');
    expect(r.html).not.toContain('Gone C');
    expect(count(r.html, 'data-slot="card"')).toBe(1);
  });
});
