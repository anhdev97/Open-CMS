// Entry detail pages (spec §3, decisions 2, 3, 5, 12): `kind: 'detail'` template pages, by-path routing to entries
// after exact page paths, the public detail-paths map and the admin warnings.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coreMigrations } from '@opencloudcms/db';
import { defineContentType, f, type ContentTypeDefinition } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { ContentRegistry } from '../../src/registry.service';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';
const ADMIN = '/api/admin/content/opencloudcmsPage';
const PUBLIC = '/api/content/opencloudcmsPage';

const productDef = defineContentType({
  id: 'ct_dpprod', apiId: 'product', displayName: 'Product',
  fields: { name: f.text({ id: 'fld_dpprdn', localizable: true }), slug: f.slug({ id: 'fld_dpprds', pattern: '{name}', localizable: true }) },
  detailPage: { path: '/products/{slug}', slugField: 'slug' },
} as any);
const postDef = defineContentType({
  id: 'ct_dppost', apiId: 'post', displayName: 'Post',
  fields: { title: f.text({ id: 'fld_dppstt' }), slug: f.slug({ id: 'fld_dppsts', pattern: '{title}-{id6}' }) },
  detailPage: { path: '/posts/{slug}', slugField: 'slug' },
} as any);
const eventDef = defineContentType({
  id: 'ct_dpevt', apiId: 'event', displayName: 'Event',
  fields: { title: f.text({ id: 'fld_dpevtt' }) },
  detailPage: { path: '/events/{id}' },
} as any);
const categoryDef = defineContentType({
  id: 'ct_dpcat', apiId: 'category', displayName: 'Category',
  fields: { name: f.text({ id: 'fld_dpcatn' }), slug: f.slug({ id: 'fld_dpcats', pattern: '{name}' }) },
} as any);
const noteDef = defineContentType({
  id: 'ct_dpnote', apiId: 'note', displayName: 'Note', private: true,
  fields: { title: f.text({ id: 'fld_dpnott' }), slug: f.slug({ id: 'fld_dpnots', pattern: '{title}' }) },
} as any);

describe('entry detail pages (spec §3)', () => {
  let t: CoreTestApp;
  let cookie = '';
  let defs: ContentTypeDefinition[] = [];
  let productTemplate = '';

  const call = async (p: string, init: RequestInit = {}, ck: string | null = cookie) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { ...(ck ? { cookie: ck } : {}), origin: t.url, 'content-type': 'application/json', ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const create = (apiId: string, body: unknown, locale = 'en-US') =>
    call(`/api/admin/content/${apiId}?locale=${locale}`, { method: 'POST', body: JSON.stringify(body) });
  const update = (apiId: string, id: string, body: unknown, locale = 'en-US') =>
    call(`/api/admin/content/${apiId}/${id}?locale=${locale}`, { method: 'PATCH', body: JSON.stringify(body) });
  const publish = (apiId: string, id: string) => call(`/api/admin/content/${apiId}/${id}/publish`, { method: 'POST' });
  const unpublish = (apiId: string, id: string) => call(`/api/admin/content/${apiId}/${id}/unpublish`, { method: 'POST' });
  const ok = async (p: Promise<{ status: number; body: any }>) => {
    const r = await p;
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    return r.body.data as Record<string, any>;
  };
  const published = async (apiId: string, body: unknown, locale = 'en-US') => {
    const d = await ok(create(apiId, body, locale));
    await ok(publish(apiId, d.documentId));
    return d;
  };
  const pub = (path: string, locale?: string) => call(`${PUBLIC}/by-path?path=${encodeURIComponent(path)}${locale ? `&locale=${locale}` : ''}`, {}, null);
  const adm = (path: string, locale?: string) => call(`${ADMIN}/by-path?path=${encodeURIComponent(path)}${locale ? `&locale=${locale}` : ''}`);
  const status = (apiId: string) => call(`/api/admin/content-types/${apiId}/status`);
  const withDefs = async (next: ContentTypeDefinition[], fn: () => Promise<void>) => {
    const registry = t.app.get(ContentRegistry);
    registry.reload(next);
    try {
      await fn();
    } finally {
      registry.reload(defs);
    }
  };

  beforeAll(async () => {
    t = await createCoreTestApp({ locales: ['en-US', 'vi-VN'], defaultLocale: 'en-US' });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, EMAIL, PW)).sessionCookie}`;
    for (const def of [productDef, postDef, eventDef, categoryDef, noteDef]) {
      const r = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    // The Builder creates the tables; `detailPage` comes from code (the schema printer learns it in a later task).
    defs = [productDef, postDef, eventDef, categoryDef, noteDef];
    t.app.get(ContentRegistry).reload(defs);
    productTemplate = (await published('opencloudcmsPage', { kind: 'detail', detailApiId: 'product', title: 'Product template' })).documentId;
    await published('opencloudcmsPage', { kind: 'detail', detailApiId: 'post', title: 'Post template' });
    await published('opencloudcmsPage', { kind: 'detail', detailApiId: 'event', title: 'Event template' });
  }, 180_000);
  afterAll(async () => {
    await t?.close();
  });

  describe('templates', () => {
    it('a template has kind detail, detailApiId and no path', async () => {
      const r = await call(`${ADMIN}/${productTemplate}`);
      expect(r.body.data).toMatchObject({ kind: 'detail', detailApiId: 'product', path: null });
    });

    it('a second template of a type -> 409 detail_template_exists', async () => {
      const r = await create('opencloudcmsPage', { kind: 'detail', detailApiId: 'product', title: 'Again' });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('detail_template_exists');
    });

    it('a type without detailPage, a private type or an unknown type -> 422 detail_not_enabled', async () => {
      for (const apiId of ['category', 'note', 'nope', undefined]) {
        const r = await create('opencloudcmsPage', { kind: 'detail', ...(apiId ? { detailApiId: apiId } : {}), title: 'T' });
        expect(r.status, String(apiId)).toBe(422);
        expect(r.body.error.code).toBe('detail_not_enabled');
      }
    });

    it('a template cannot have a path; detailApiId only on templates and never changes', async () => {
      const withPath = await create('opencloudcmsPage', { kind: 'detail', detailApiId: 'category', title: 'T', path: '/x' });
      expect(withPath.status).toBe(422);
      expect(withPath.body.error.code).toBe('detail_has_path');
      const patchPath = await update('opencloudcmsPage', productTemplate, { path: '/products' });
      expect(patchPath.status).toBe(422);
      expect(patchPath.body.error.code).toBe('detail_has_path');
      const retarget = await update('opencloudcmsPage', productTemplate, { detailApiId: 'post' });
      expect(retarget.status).toBe(422);
      expect(retarget.body.error.code).toBe('detail_immutable');
      expect((await update('opencloudcmsPage', productTemplate, { detailApiId: 'product', title: 'Product template' })).status).toBe(200);
      const onPage = await create('opencloudcmsPage', { title: 'P', path: '/p-detail', detailApiId: 'product' });
      expect(onPage.status).toBe(422);
      expect(onPage.body.error.code).toBe('detail_not_allowed');
    });

    it('templates are absent from public lists and single reads, present in admin lists', async () => {
      const list = await call(`${PUBLIC}?limit=100`, {}, null);
      expect(list.status).toBe(200);
      expect(list.body.data.map((d: any) => d.kind)).not.toContain('detail');
      expect((await call(`${PUBLIC}/${productTemplate}`, {}, null)).status).toBe(404);
      const admin = await call(`${ADMIN}?limit=100`);
      expect(admin.body.data.map((d: any) => d.documentId)).toContain(productTemplate);
    });

    it('a private type cannot enable a detail page', async () => {
      const def = { ...noteDef, detailPage: { path: '/notes/{slug}', slugField: 'slug' } };
      const r = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('a private type cannot have a detail page');
    });
  });

  describe('routing', () => {
    let shirt: Record<string, any>;
    let draftOnly: Record<string, any>;
    let salePage = '';

    beforeAll(async () => {
      shirt = await published('product', { name: 'Áo thun' });
      expect(shirt.slug).toBe('ao-thun');
      draftOnly = await ok(create('product', { name: 'Secret' }));
      salePage = (await published('opencloudcmsPage', { title: 'Sale', path: '/products/sale' })).documentId;
      await published('product', { name: 'Sale' });
    });

    it('an exact page path wins over the pattern (/products/sale)', async () => {
      for (const r of [await pub('/products/sale'), await adm('/products/sale')]) {
        expect(r.status).toBe(200);
        expect(r.body.data.documentId).toBe(salePage);
        expect(r.body.routeEntry).toBeUndefined();
        expect(r.body.detail).toBeUndefined();
      }
    });

    it('/products/ao-thun returns the template and the entry', async () => {
      const r = await pub('/products/ao-thun');
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ documentId: productTemplate, kind: 'detail', status: 'published', locale: 'en-US' });
      expect(r.body.routeEntry).toMatchObject({ documentId: shirt.documentId, status: 'published', slug: 'ao-thun', name: 'Áo thun' });
      expect(r.body.detail).toEqual({ apiId: 'product' });
    });

    it('unknown slug, malformed slug and an unknown prefix -> 404', async () => {
      expect((await pub('/products/nope')).status).toBe(404);
      expect((await pub('/products/Ao_Thun')).status).toBe(404);
      expect((await pub('/products/a/b')).status).toBe(404);
      expect((await pub('/nothing/ao-thun')).status).toBe(404);
    });

    it('a localized slug is looked up in the requested locale only', async () => {
      expect((await pub('/products/ao-thun', 'vi-VN')).status).toBe(404);
    });

    it('a draft-only entry: 404 anonymously, 200 with a session in draft mode', async () => {
      const path = `/products/${draftOnly.slug}`;
      expect((await pub(path)).status).toBe(404);
      const r = await adm(path);
      expect(r.status).toBe(200);
      expect(r.body.routeEntry).toMatchObject({ documentId: draftOnly.documentId, status: 'draft' });
      expect(r.body.data).toMatchObject({ documentId: productTemplate, status: 'draft' });
      expect((await call(`${ADMIN}/by-path?path=${path}`, {}, null)).status).toBe(401);
    });

    it('unpublishing the entry -> 404, never the draft', async () => {
      const e = await published('product', { name: 'Gone soon' });
      expect((await pub(`/products/${e.slug}`)).status).toBe(200);
      await ok(update('product', e.documentId, { name: 'Gone soon (draft edit)', slug: e.slug }));
      expect((await pub(`/products/${e.slug}`)).body.routeEntry.name).toBe('Gone soon');
      expect((await unpublish('product', e.documentId)).status).toBe(200);
      expect((await pub(`/products/${e.slug}`)).status).toBe(404);
    });

    it('no published template -> 404 publicly, the draft template is used in draft mode', async () => {
      const cat = { ...categoryDef, detailPage: { path: '/categories/{slug}', slugField: 'slug' } } as ContentTypeDefinition;
      await withDefs([...defs.filter((d) => d.apiId !== 'category'), cat], async () => {
        const c = await published('category', { name: 'Shoes' });
        expect((await pub('/categories/shoes')).status).toBe(404);
        expect((await adm('/categories/shoes')).status).toBe(404);
        const tpl = await ok(create('opencloudcmsPage', { kind: 'detail', detailApiId: 'category', title: 'Category template' }));
        expect((await pub('/categories/shoes')).status).toBe(404);
        const r = await adm('/categories/shoes');
        expect(r.status).toBe(200);
        expect(r.body.routeEntry.documentId).toBe(c.documentId);
        expect(r.body.data.documentId).toBe(tpl.documentId);
        expect((await status('category')).body.data).toMatchObject({ detailTemplate: true });
        expect((await call(`${ADMIN}/${tpl.documentId}`, { method: 'DELETE' })).status).toBe(200);
        await ok(call(`/api/admin/content/category/${c.documentId}`, { method: 'DELETE' }).then((r) => ({ ...r, body: { data: r.body } })));
      });
    });

    it('{id} detail paths match the documentId', async () => {
      const e = await published('event', { title: 'Launch' });
      const r = await pub(`/events/${e.documentId}`);
      expect(r.status).toBe(200);
      expect(r.body.routeEntry.documentId).toBe(e.documentId);
      expect(r.body.detail).toEqual({ apiId: 'event' });
      expect((await pub('/events/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await pub('/events/launch')).status).toBe(404);
    });

    it('{title}-{id6}: exact slug first, then the trailing id part', async () => {
      const p = await published('post', { title: 'Hello world' });
      const id6 = p.documentId.slice(0, 6);
      expect(p.slug).toBe(`hello-world-${id6}`);
      expect((await pub(`/posts/${p.slug}`)).body.routeEntry.documentId).toBe(p.documentId);
      // An old title in the URL still resolves through the id part.
      const old = await pub(`/posts/old-title-${id6}`);
      expect(old.status).toBe(200);
      expect(old.body.routeEntry.documentId).toBe(p.documentId);
      expect((await pub(`/posts/${id6}`)).status).toBe(200);
      expect((await pub(`/posts/old-title-${p.documentId.slice(0, 5)}`)).status).toBe(404);
      expect((await pub(`/posts/old-title-ffffff`)).status).toBe(p.documentId.startsWith('ffffff') ? 200 : 404);
      // An exact slug wins over another entry's id part.
      const q = await published('post', { title: 'Second' });
      await ok(update('post', q.documentId, { slug: `x-${id6}` }));
      await ok(publish('post', q.documentId));
      expect((await pub(`/posts/x-${id6}`)).body.routeEntry.documentId).toBe(q.documentId);
    });

    it('slug field removed in code -> 404 and misconfigured, nothing crashes', async () => {
      const broken = { ...productDef, fields: productDef.fields.filter((x) => x.name !== 'slug') } as ContentTypeDefinition;
      await withDefs([...defs.filter((d) => d.apiId !== 'product'), broken], async () => {
        expect((await pub('/products/ao-thun')).status).toBe(404);
        expect((await adm('/products/ao-thun')).status).toBe(404);
        const s = await status('product');
        expect(s.status).toBe(200);
        expect(s.body.data).toMatchObject({ misconfigured: true, detailTemplate: true });
        expect((await call(`${PUBLIC}/detail-paths`, {}, null)).body.data.product).toBeUndefined();
      });
      const retyped = { ...productDef, fields: productDef.fields.map((x) => (x.name === 'slug' ? { ...x, kind: 'text', options: {} } : x)) } as ContentTypeDefinition;
      await withDefs([...defs.filter((d) => d.apiId !== 'product'), retyped], async () => {
        expect((await pub('/products/ao-thun')).status).toBe(404);
        expect((await status('product')).body.data.misconfigured).toBe(true);
      });
      expect((await pub('/products/ao-thun')).status).toBe(200);
    });

    it('a type made private in code -> 404', async () => {
      const priv = { ...productDef, private: true } as ContentTypeDefinition;
      await withDefs([...defs.filter((d) => d.apiId !== 'product'), priv], async () => {
        expect((await pub('/products/ao-thun')).status).toBe(404);
        expect((await adm('/products/ao-thun')).status).toBe(404);
      });
    });
  });

  describe('detail-paths and admin warnings', () => {
    it('detail-paths lists enabled non-private types (public, no session)', async () => {
      const r = await call(`${PUBLIC}/detail-paths`, {}, null);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({
        product: { path: '/products/{slug}', slugField: 'slug' },
        post: { path: '/posts/{slug}', slugField: 'slug' },
        event: { path: '/events/{id}' },
      });
    });

    it('content type status: detailTemplate, misconfigured, duplicateSlugs', async () => {
      expect((await status('product')).body.data).toEqual({
        detailPage: { path: '/products/{slug}', slugField: 'slug' },
        detailTemplate: true,
        templateId: productTemplate,
        misconfigured: false,
        duplicateSlugs: 0,
      });
      expect((await status('category')).body.data).toEqual({ detailPage: null, detailTemplate: false, templateId: null, misconfigured: false, duplicateSlugs: 0 });
      expect((await status('nope')).status).toBe(404);
      expect((await call('/api/admin/content-types/product/status', {}, null)).status).toBe(401);
    });

    it('duplicateSlugs counts published slug values held by more than one entry', async () => {
      const a = await published('product', { name: 'Twin' });
      const b = await published('product', { name: 'Twin other' });
      // Written outside the API (old data): two published rows with the same slug.
      await t.db.updateTable('ct_product_l10n').set({ slug: a.slug }).where('entry_id', 'in', t.db.selectFrom('ct_product').select('id').where('document_id', '=', b.documentId)).execute();
      expect((await status('product')).body.data.duplicateSlugs).toBe(1);
    });

    it('0009_detail_pages: down drops only the column and index (rows stay), up adds them back', async () => {
      const cols = async () =>
        (await sql<{ column_name: string }>`select column_name from information_schema.columns where table_name = 'ct_opencloudcms_page' and column_name = 'detail_api_id'`.execute(t.db)).rows.length;
      const count = async () => Number((await sql<{ n: string }>`select count(*) as n from ct_opencloudcms_page`.execute(t.db)).rows[0].n);
      const before = await count();
      const templates = (await sql<{ id: string; detail_api_id: string }>`select id, detail_api_id from ct_opencloudcms_page where kind = 'detail'`.execute(t.db)).rows;
      expect(templates.length).toBeGreaterThan(0);
      const m = coreMigrations['0009_detail_pages'];
      await m.down!(t.db);
      expect(await cols()).toBe(0);
      expect(await count()).toBe(before);
      await m.up(t.db);
      expect(await cols()).toBe(1);
      for (const r of templates) await sql`update ct_opencloudcms_page set detail_api_id = ${r.detail_api_id} where id = ${r.id}`.execute(t.db);
      expect((await pub('/products/ao-thun')).status).toBe(200);
    });

    it('saving an ordinary page whose path matches a pattern warns', async () => {
      const r = await create('opencloudcmsPage', { title: 'Hides', path: '/products/hidden' });
      expect(r.status).toBe(201);
      expect(r.body.warnings).toEqual([
        { code: 'page_hides_detail', message: 'This page hides /products/{slug} for slug "hidden"', apiId: 'product', path: '/products/{slug}', value: 'hidden' },
      ]);
      const u = await update('opencloudcmsPage', r.body.data.documentId, { title: 'Hides 2' });
      expect(u.body.warnings?.[0]?.code).toBe('page_hides_detail');
      const plain = await create('opencloudcmsPage', { title: 'Plain', path: '/plain-detail' });
      expect(plain.body.warnings).toBeUndefined();
      const entry = await create('product', { name: 'No warnings' });
      expect(entry.body.warnings).toBeUndefined();
    });
  });
});
