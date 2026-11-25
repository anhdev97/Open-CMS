import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const ADMIN = '/api/admin/content/opencloudcmsPage';
const PUBLIC = '/api/content/opencloudcmsPage';
const PAGES = '/api/admin/pages';
const MISSING = '00000000-0000-4000-8000-0000000000ff';

const item = (type: string, props: Record<string, unknown> = {}) => ({ type, props: { id: `${type}-1`, ...props } });
const puck = (...content: unknown[]) => ({ format: 'puck', formatVersion: 1, data: { root: { props: {} }, content } });
const frame = () => puck(item('Frame', { region__header: [item('Heading')] }));

describe('base pages', () => {
  let t: CoreTestApp;
  let cookie: string;

  const call = async (p: string, init: RequestInit = {}, ck: string | null = cookie) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { ...(ck ? { cookie: ck } : {}), 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const create = async (body: unknown, locale = 'en-US') => {
    const r = await call(`${ADMIN}?locale=${locale}`, { method: 'POST', body: JSON.stringify(body) });
    return r;
  };
  const createId = async (body: unknown) => {
    const r = await create(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.documentId as string;
  };
  const patch = (id: string, body: unknown, locale = 'en-US') => call(`${ADMIN}/${id}?locale=${locale}`, { method: 'PATCH', body: JSON.stringify(body) });
  const publish = (id: string) => call(`${ADMIN}/${id}/publish`, { method: 'POST' });
  const unpublish = (id: string, q = '') => call(`${ADMIN}/${id}/unpublish${q}`, { method: 'POST' });
  const remove = (id: string) => call(`${ADMIN}/${id}`, { method: 'DELETE' });
  const setDefault = (documentId: string | null) => call(`${PAGES}/bases/default`, { method: 'PUT', body: JSON.stringify({ documentId }) });
  const usage = (id: string) => call(`${PAGES}/bases/${id}/usage`);
  const publishedBase = async (title: string) => {
    const id = await createId({ kind: 'base', title, content: frame() });
    expect((await publish(id)).status).toBe(200);
    return id;
  };

  beforeAll(async () => {
    t = await createCoreTestApp({
      locales: ['en-US', 'vi-VN'],
      pages: { blocks: [{ name: 'Frame', version: 1, kind: 'layout' }, { name: 'Heading', version: 1 }, { name: 'Modal', version: 1, kind: 'overlay' }] },
    });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  describe('kind, isDefault and layout fields', () => {
    it('a page defaults to kind page, isDefault false, layout null', async () => {
      const r = await create({ title: 'Plain', path: '/plain' });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ kind: 'page', isDefault: false, layout: null });
    });

    it('a base is created without a path', async () => {
      const r = await create({ kind: 'base', title: 'Base' });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ kind: 'base', isDefault: false, path: null });
    });

    it('kind cannot change after create; sending the same kind is fine', async () => {
      const id = await createId({ kind: 'base', title: 'K' });
      const r = await patch(id, { kind: 'page' });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('kind_immutable');
      expect((await patch(id, { kind: 'base', title: 'K2' })).status).toBe(200);
      expect((await create({ kind: 'frame', title: 'x' })).body.error.code).toBe('invalid_kind');
    });

    it('isDefault is managed: writes through the content API -> 422 managed_field', async () => {
      const c = await create({ kind: 'base', title: 'M', isDefault: true });
      expect(c.status).toBe(422);
      expect(c.body.error.code).toBe('managed_field');
      const id = await createId({ kind: 'base', title: 'M' });
      const u = await patch(id, { isDefault: true });
      expect(u.status).toBe(422);
      expect(u.body.error.code).toBe('managed_field');
      // The unchanged value (an editor echoing the document back) is ignored.
      expect((await patch(id, { isDefault: false, title: 'M2' })).status).toBe(200);
    });

    it('layout is validated on save; baseId must name an existing base document', async () => {
      const base = await createId({ kind: 'base', title: 'Draft base' });
      const page = await createId({ title: 'P', path: '/layout-p' });
      expect((await create({ title: 'x', layout: { baseId: 'nope' } })).body.error.code).toBe('invalid_layout');
      expect((await create({ title: 'x', layout: { baseId: null, regions: { Header: 'hide' } } })).body.error.code).toBe('invalid_layout');
      const unknown = await create({ title: 'x', layout: { baseId: MISSING } });
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.code).toBe('unknown_base');
      expect((await patch(page, { layout: { baseId: page } })).body.error.code).toBe('unknown_base');
      const ok = await patch(page, { layout: { baseId: base, regions: { header: 'replace' } } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.layout).toEqual({ baseId: base, regions: { header: 'replace' } });
      // A base page has no layout of its own.
      const onBase = await patch(base, { layout: { baseId: null } });
      expect(onBase.status).toBe(422);
      expect(onBase.body.error.code).toBe('invalid_layout');
    });
  });

  describe('publish checks', () => {
    it('a base publishes with one layout block at root; a normal block root -> 422', async () => {
      await publishedBase('Root ok');
      const bad = await createId({ kind: 'base', title: 'Bad root', content: puck(item('Heading')) });
      const r = await publish(bad);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('invalid_base_root');
    });

    it('a base with a path -> 422 base_has_path', async () => {
      const id = await createId({ kind: 'base', title: 'Pathy', path: '/pathy-base', content: frame() });
      const r = await publish(id);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('base_has_path');
    });

    it('a page without a path -> 422 path_required', async () => {
      const id = await createId({ title: 'No path', content: puck(item('Heading')) });
      const r = await publish(id);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('path_required');
    });

    it('a page with a layout block -> 422 layout_block_misplaced', async () => {
      const id = await createId({ title: 'Misplaced', path: '/misplaced', content: puck(item('Frame')) });
      const r = await publish(id);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('layout_block_misplaced');
    });
  });

  describe('default base, usage and guards', () => {
    let b1: string;
    let b2: string;
    let explicit1: string;
    let implicit: string;

    beforeAll(async () => {
      // Clean slate for the default and usage counts.
      await setDefault(null);
      b1 = await publishedBase('B1');
      b2 = await publishedBase('B2');
      explicit1 = await createId({ title: 'Uses B1', path: '/uses-b1', layout: { baseId: b1 } });
      await createId({ title: 'Uses B2', path: '/uses-b2', layout: { baseId: b2 } });
      await createId({ title: 'No frame', path: '/no-frame', layout: { baseId: null } });
      implicit = await createId({ title: 'Implicit', path: '/implicit' });
    });

    it('setDefault on a draft base -> 409 base_not_published; on a page -> 422 unknown_base', async () => {
      const draft = await createId({ kind: 'base', title: 'Draft only' });
      const r = await setDefault(draft);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('base_not_published');
      expect((await setDefault(implicit)).body.error.code).toBe('unknown_base');
      expect((await call(`${PAGES}/bases/default`, { method: 'PUT', body: JSON.stringify({ documentId: 'x' }) })).status).toBe(400);
    });

    it('setDefault moves the flag; bases lists bases only', async () => {
      expect((await setDefault(b2)).status).toBe(200);
      expect((await setDefault(b1)).status).toBe(200);
      const r = await call(`${PAGES}/bases`);
      expect(r.status).toBe(200);
      expect(r.body.data.every((d: any) => d.kind === 'base')).toBe(true);
      const flags = Object.fromEntries(r.body.data.map((d: any) => [d.documentId, d.isDefault]));
      expect(flags[b1]).toBe(true);
      expect(flags[b2]).toBe(false);
      expect(r.body.data.filter((d: any) => d.isDefault)).toHaveLength(1);
      // Both rows of the default document carry the flag.
      const rows = await sql<{ status: string; is_default: boolean }>`select status, is_default from ct_opencloudcms_page where document_id = ${b1} order by status`.execute(t.db);
      expect(rows.rows).toEqual([{ status: 'draft', is_default: true }, { status: 'published', is_default: true }]);
    });

    it('concurrent setDefault calls leave exactly one default document', async () => {
      const extra = [await publishedBase('C1'), await publishedBase('C2'), await publishedBase('C3')];
      const all = [b1, b2, ...extra];
      const results = await Promise.all([...all, ...all].map((id) => setDefault(id)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const rows = await sql<{ document_id: string }>`select distinct document_id from ct_opencloudcms_page where is_default`.execute(t.db);
      expect(rows.rows).toHaveLength(1);
      // Both rows of that document carry the flag.
      const n = await sql<{ n: number }>`select count(*)::int as n from ct_opencloudcms_page where is_default`.execute(t.db);
      expect(n.rows[0].n).toBe(2);
      // setDefault racing an unpublish of the same base: never an unpublished default.
      const racer = await publishedBase('Racer');
      await Promise.all([setDefault(racer), unpublish(racer, '?force=true')]);
      const state = await sql<{ status: string; is_default: boolean }>`select status, is_default from ct_opencloudcms_page where document_id = ${racer}`.execute(t.db);
      const published = state.rows.some((r) => r.status === 'published');
      const isDefault = state.rows.some((r) => r.is_default);
      expect(isDefault && !published).toBe(false);
      expect((await setDefault(b1)).status).toBe(200);
      for (const id of [...extra, racer]) expect((await remove(id)).status).toBe(200);
    });

    it('usage counts explicit pages and, for the default, pages with no layout', async () => {
      const u1 = await usage(b1);
      expect(u1.status).toBe(200);
      const ids = u1.body.pages.map((p: any) => p.documentId);
      expect(ids).toContain(explicit1);
      expect(ids).toContain(implicit);
      expect(u1.body.count).toBe(ids.length);
      // Base pages themselves (layout null) never count; published + draft rows count once.
      expect(ids).not.toContain(b2);
      expect(new Set(ids).size).toBe(ids.length);
      const p = u1.body.pages.find((x: any) => x.documentId === explicit1);
      expect(p).toEqual({ documentId: explicit1, title: 'Uses B1', path: '/uses-b1' });
      expect((await publish(explicit1)).status).toBe(200);
      expect((await usage(b1)).body.count).toBe(u1.body.count);
      const u2 = await usage(b2);
      expect(u2.body.count).toBe(1);
      expect(u2.body.pages[0].title).toBe('Uses B2');
    });

    it('delete of a used base -> 409 base_in_use with the pages; unpublish -> 409 unless forced', async () => {
      const d = await remove(b2);
      expect(d.status).toBe(409);
      expect(d.body.error.code).toBe('base_in_use');
      expect(d.body.error.issues).toHaveLength(1);
      expect(d.body.error.issues[0].path).toEqual([expect.any(String)]);
      const u = await unpublish(b2);
      expect(u.status).toBe(409);
      expect(u.body.error.code).toBe('base_in_use');
      expect((await unpublish(b2, '?force=true')).status).toBe(200);
      // Forced or not, delete stays refused.
      expect((await remove(b2)).status).toBe(409);
    });

    it('an unused base can be unpublished and deleted', async () => {
      const b3 = await publishedBase('B3');
      expect((await unpublish(b3)).status).toBe(200);
      expect((await remove(b3)).status).toBe(200);
    });

    it('unpublish or delete of the default base -> 409 base_is_default', async () => {
      const u = await unpublish(b1, '?force=true');
      expect(u.status).toBe(409);
      expect(u.body.error.code).toBe('base_is_default');
      const d = await remove(b1);
      expect(d.status).toBe(409);
      expect(d.body.error.code).toBe('base_is_default');
    });
  });

  describe('public reads', () => {
    let def: string;
    beforeAll(async () => {
      def = await publishedBase('Live title');
      expect((await setDefault(def)).status).toBe(200);
      expect((await patch(def, { title: 'Draft title' })).status).toBe(200);
    });

    it('by-path never returns a base', async () => {
      const id = await createId({ kind: 'base', title: 'At path', path: '/base-at-path', content: frame() });
      expect((await call(`${ADMIN}/by-path?path=/base-at-path&locale=en-US`)).status).toBe(404);
      // Even a published row with a path (written outside the API).
      await sql`update ct_opencloudcms_page_l10n set path = null where entry_id in (select id from ct_opencloudcms_page where document_id = ${id})`.execute(t.db);
      expect((await publish(id)).status).toBe(200);
      await sql`update ct_opencloudcms_page_l10n set path = '/base-at-path' where entry_id in (select id from ct_opencloudcms_page where document_id = ${id})`.execute(t.db);
      expect((await call(`${PUBLIC}/by-path?path=/base-at-path&locale=en-US`, {}, null)).status).toBe(404);
    });

    it('the public list and get by id never return a base; admin still does', async () => {
      const list = await call(`${PUBLIC}?limit=100`, {}, null);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      expect(list.body.data.every((d: any) => d.kind === 'page')).toBe(true);
      expect(list.body.meta.total).toBe(list.body.data.length);
      expect((await call(`${PUBLIC}/${def}`, {}, null)).status).toBe(404);
      expect((await call(`${ADMIN}/${def}?status=published`)).status).toBe(200);
      const adminList = await call(`${ADMIN}?status=published&limit=100`);
      expect(adminList.body.data.some((d: any) => d.kind === 'base')).toBe(true);
    });

    it('public base?id=default returns the published default, never the draft', async () => {
      const r = await call(`${PUBLIC}/base?id=default&locale=en-US`, {}, null);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ documentId: def, status: 'published', title: 'Live title', kind: 'base' });
      const admin = await call(`${ADMIN}/base?id=default&locale=en-US`);
      expect(admin.status).toBe(200);
      expect(admin.body.data).toMatchObject({ documentId: def, status: 'draft', title: 'Draft title' });
    });

    it('public base?id=<uuid> falls back to the default locale; pages, drafts and unknown ids -> 404', async () => {
      const r = await call(`${PUBLIC}/base?id=${def}&locale=vi-VN`, {}, null);
      expect(r.status).toBe(200);
      expect(r.body.data.locale).toBe('en-US');
      const draft = await createId({ kind: 'base', title: 'Never published' });
      expect((await call(`${PUBLIC}/base?id=${draft}`, {}, null)).status).toBe(404);
      expect((await call(`${ADMIN}/base?id=${draft}`)).status).toBe(200);
      const page = await createId({ title: 'Pg', path: '/pg-not-base' });
      expect((await call(`${ADMIN}/base?id=${page}`)).status).toBe(404);
      expect((await call(`${PUBLIC}/base?id=${MISSING}`, {}, null)).status).toBe(404);
      expect((await call(`${PUBLIC}/base?id=nope`, {}, null)).status).toBe(400);
      expect((await call(`${PUBLIC}/base`, {}, null)).status).toBe(400);
    });

    it('public and admin by-path return the page layout (explicit base with regions, and baseId null)', async () => {
      const framed = await createId({ title: 'Framed', path: '/framed-layout', layout: { baseId: def, regions: { header: 'replace' } } });
      const bare = await createId({ title: 'Bare', path: '/bare-layout', layout: { baseId: null } });
      for (const id of [framed, bare]) expect((await publish(id)).status).toBe(200);
      const cases: [string, unknown][] = [
        ['/framed-layout', { baseId: def, regions: { header: 'replace' } }],
        ['/bare-layout', { baseId: null }],
      ];
      for (const [path, layout] of cases) {
        const pub = await call(`${PUBLIC}/by-path?path=${path}`, {}, null);
        expect(pub.status).toBe(200);
        expect(pub.body.data.layout).toEqual(layout);
        const adm = await call(`${ADMIN}/by-path?path=${path}&locale=en-US`);
        expect(adm.status).toBe(200);
        expect(adm.body.data.layout).toEqual(layout);
      }
    });

    it('no default base -> 404 for id=default', async () => {
      expect((await setDefault(null)).status).toBe(200);
      expect((await call(`${PUBLIC}/base?id=default`, {}, null)).status).toBe(404);
    });
  });
});
