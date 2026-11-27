// Slug fields in the entry write path (spec §2, decisions 4, 7, 8, 10, 11, 13): default = documentId (read-only),
// pattern generation with numeric suffixes, uniqueness per type and locale across other entries' draft and published
// rows, publish re-check, grandfathered old values.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { defineContentType, f } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { PrivateEntriesService } from '../../src';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tagDef = defineContentType({
  id: 'ct_sgtag', apiId: 'tag', displayName: 'Tag',
  fields: { name: f.text({ id: 'fld_sgtagn' }), slug: f.slug({ id: 'fld_sgtags' }) },
} as any);
const productDef = defineContentType({
  id: 'ct_sgprod', apiId: 'product', displayName: 'Product',
  fields: {
    name: f.text({ id: 'fld_sgprdn' }),
    note: f.text({ id: 'fld_sgprdo' }),
    slug: f.slug({ id: 'fld_sgprds', pattern: '{name}' }),
  },
} as any);
const postDef = defineContentType({
  id: 'ct_sgpost', apiId: 'post', displayName: 'Post',
  fields: { title: f.text({ id: 'fld_sgpstt' }), slug: f.slug({ id: 'fld_sgpsts', pattern: '{title}-{id6}' }) },
} as any);
const articleDef = defineContentType({
  id: 'ct_sgart', apiId: 'article', displayName: 'Article',
  fields: {
    title: f.text({ id: 'fld_sgartt', localizable: true }),
    slug: f.slug({ id: 'fld_sgarts', pattern: '{title}', localizable: true }),
  },
} as any);
const pageDef = defineContentType({
  id: 'ct_sgpage', apiId: 'landing', displayName: 'Landing',
  fields: {
    title: f.text({ id: 'fld_sglndt', localizable: true }),
    slug: f.slug({ id: 'fld_sglnds', from: 'title' }),
  },
} as any);
const noteDef = defineContentType({
  id: 'ct_sgnote', apiId: 'note', displayName: 'Note', private: true,
  fields: { title: f.text({ id: 'fld_sgnott' }), slug: f.slug({ id: 'fld_sgnots', pattern: '{title}' }) },
} as any);

describe('slug fields (spec §2)', () => {
  let t: CoreTestApp;
  let cookie = '';

  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { cookie, origin: t.url, 'content-type': 'application/json', ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const create = (apiId: string, body: unknown, locale?: string) =>
    call(`/api/admin/content/${apiId}${locale ? `?locale=${locale}` : ''}`, { method: 'POST', body: JSON.stringify(body) });
  const update = (apiId: string, id: string, body: unknown, locale?: string) =>
    call(`/api/admin/content/${apiId}/${id}${locale ? `?locale=${locale}` : ''}`, { method: 'PATCH', body: JSON.stringify(body) });
  const publish = (apiId: string, id: string) => call(`/api/admin/content/${apiId}/${id}/publish`, { method: 'POST' });
  const ok = async (p: Promise<{ status: number; body: any }>) => {
    const r = await p;
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    return r.body.data as Record<string, any>;
  };

  beforeAll(async () => {
    t = await createCoreTestApp({
      locales: ['en-US', 'vi-VN'],
      defaultLocale: 'en-US',
    });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, EMAIL, PW)).sessionCookie}`;
    for (const def of [tagDef, productDef, postDef, articleDef, pageDef, noteDef]) {
      const r = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  describe('no pattern: the slug is the documentId', () => {
    it('create stores the documentId; a typed value is 422 slug_readonly', async () => {
      const a = await ok(create('tag', { name: 'Red' }));
      expect(a.slug).toBe(a.documentId);
      const typed = await create('tag', { name: 'Blue', slug: 'blue' });
      expect(typed.status).toBe(422);
      expect(typed.body.error).toMatchObject({ code: 'slug_readonly', path: 'slug' });
      expect((await ok(create('tag', { name: 'Green', slug: null }))).slug).toMatch(UUID_RE);
    });

    it('update: sending the documentId (or nothing) is fine, another value is 422', async () => {
      const a = await ok(create('tag', { name: 'Red' }));
      expect((await ok(update('tag', a.documentId, { name: 'Rouge', slug: a.documentId }))).slug).toBe(a.documentId);
      const bad = await update('tag', a.documentId, { slug: 'rouge' });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('slug_readonly');
    });

    it('an old entry with an empty slug is filled on the next update', async () => {
      const a = await ok(create('tag', { name: 'Old' }));
      await sql`update ct_tag set slug = null where document_id = ${a.documentId}`.execute(t.db);
      expect((await ok(update('tag', a.documentId, { name: 'Old 2' }))).slug).toBe(a.documentId);
    });
  });

  describe('pattern {name}', () => {
    it('generates accent-free slugs with numeric suffixes for duplicates', async () => {
      const a = await ok(create('product', { name: 'Áo thun' }));
      expect(a.slug).toBe('ao-thun');
      const b = await ok(create('product', { name: 'Áo Thun' }));
      expect(b.slug).toBe('ao-thun-2');
      const c = await ok(create('product', { name: 'ao thun!' }));
      expect(c.slug).toBe('ao-thun-3');
    });

    it('two concurrent creates from the same title get distinct slugs', async () => {
      const [a, b] = await Promise.all([ok(create('product', { name: 'Race Shirt' })), ok(create('product', { name: 'Race Shirt' }))]);
      expect([a.slug, b.slug].sort()).toEqual(['race-shirt', 'race-shirt-2']);
    });

    it('a pattern that renders empty falls back to the documentId', async () => {
      const a = await ok(create('product', { name: '日本語' }));
      expect(a.slug).toBe(a.documentId);
      const b = await ok(create('product', {}));
      expect(b.slug).toBe(b.documentId);
    });

    it('follows the title while untouched (also with a suffix, also when the slug is sent back unchanged)', async () => {
      const a = await ok(create('product', { name: 'Follow Me' }));
      expect(a.slug).toBe('follow-me');
      expect((await ok(update('product', a.documentId, { name: 'Follow You' }))).slug).toBe('follow-you');
      expect((await ok(update('product', a.documentId, { name: 'Follow Them', slug: 'follow-you' }))).slug).toBe('follow-them');
      const b = await ok(create('product', { name: 'Follow Them' }));
      expect(b.slug).toBe('follow-them-2');
      expect((await ok(update('product', b.documentId, { name: 'Follow Us' }))).slug).toBe('follow-us');
      // Saving another field keeps a generated slug.
      expect((await ok(update('product', b.documentId, { note: 'x' }))).slug).toBe('follow-us');
    });

    it('keeps a slug edited by hand; an empty value regenerates it', async () => {
      const a = await ok(create('product', { name: 'Hand Made' }));
      expect((await ok(update('product', a.documentId, { slug: 'my-custom' }))).slug).toBe('my-custom');
      expect((await ok(update('product', a.documentId, { name: 'Hand Made 2' }))).slug).toBe('my-custom');
      expect((await ok(update('product', a.documentId, { slug: null }))).slug).toBe('hand-made-2');
      expect((await ok(update('product', a.documentId, { slug: '' }))).slug).toBe('hand-made-2');
    });

    it('a typed duplicate is 422 slug_taken with the path; a typed value on create is kept', async () => {
      const a = await ok(create('product', { name: 'Unique One', slug: 'typed-one' }));
      expect(a.slug).toBe('typed-one');
      const dup = await create('product', { name: 'Other', slug: 'typed-one' });
      expect(dup.status).toBe(422);
      expect(dup.body.error).toMatchObject({ code: 'slug_taken', path: 'slug' });
      const b = await ok(create('product', { name: 'Other' }));
      const dup2 = await update('product', b.documentId, { slug: 'typed-one' });
      expect(dup2.status).toBe(422);
      expect(dup2.body.error).toMatchObject({ code: 'slug_taken', path: 'slug' });
      // A typed value too long for the default maxLength (75) is refused.
      const long = await update('product', b.documentId, { slug: 'a'.repeat(76) });
      expect(long.status).toBe(400);
    });

    it("a draft taking another entry's published slug is 422; the same entry's rows never conflict", async () => {
      const b = await ok(create('product', { name: 'Published B' }));
      await ok(publish('product', b.documentId));
      expect((await ok(update('product', b.documentId, { slug: 'published-b-new' }))).slug).toBe('published-b-new');
      const a = await ok(create('product', { name: 'Taker A' }));
      const taken = await update('product', a.documentId, { slug: 'published-b' });
      expect(taken.status).toBe(422);
      expect(taken.body.error.code).toBe('slug_taken');
      // B can go back to its own published slug.
      expect((await ok(update('product', b.documentId, { slug: 'published-b' }))).slug).toBe('published-b');
      // A generated one skips slugs that only live in another entry's published row.
      await ok(update('product', b.documentId, { slug: 'published-b-again' }));
      expect((await ok(create('product', { name: 'Published B' }))).slug).toBe('published-b-2');
    });

    it('publish re-checks against other entries and fails with 409 slug_taken', async () => {
      const a = await ok(create('product', { name: 'Clash' }));
      const b = await ok(create('product', { name: 'Clash Other' }));
      await ok(publish('product', b.documentId));
      // Another entry took the slug meanwhile (e.g. outside the lock): its published row now has A's slug.
      await sql`update ct_product set slug = 'clash' where document_id = ${b.documentId} and status = 'published'`.execute(t.db);
      const r = await publish('product', a.documentId);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'slug_taken', path: 'slug' });
      // B's draft keeps its own slug, which nobody else published: fine.
      expect((await publish('product', b.documentId)).status).toBe(200);
    });

    it('publish: a duplicate already in both published rows (old data) does not block republishing', async () => {
      const a = await ok(create('product', { name: 'Dup Old A' }));
      const b = await ok(create('product', { name: 'Dup Old B' }));
      await ok(publish('product', a.documentId));
      await ok(publish('product', b.documentId));
      await sql`update ct_product set slug = 'dup-old' where document_id in (${a.documentId}, ${b.documentId})`.execute(t.db);
      expect((await publish('product', a.documentId)).status).toBe(200);
    });

    it('grandfathered: an old invalid slug saves another field; a changed value is validated', async () => {
      const a = await ok(create('product', { name: 'Old Thing' }));
      await sql`update ct_product set slug = 'Old Value' where document_id = ${a.documentId}`.execute(t.db);
      const saved = await ok(update('product', a.documentId, { note: 'n', slug: 'Old Value' }));
      expect(saved.slug).toBe('Old Value');
      expect((await ok(update('product', a.documentId, { note: 'n2' }))).slug).toBe('Old Value');
      expect((await update('product', a.documentId, { slug: 'Other Value' })).status).toBe(400);
    });

    it('an empty slug is filled on the next update', async () => {
      const a = await ok(create('product', { name: 'Empty Later' }));
      await sql`update ct_product set slug = null where document_id = ${a.documentId}`.execute(t.db);
      expect((await ok(update('product', a.documentId, { note: 'x' }))).slug).toBe('empty-later');
    });
  });

  describe('pattern {title}-{id6}', () => {
    it('appends the first 6 hex of the documentId and never suffixes', async () => {
      const a = await ok(create('post', { title: 'Hello World' }));
      expect(a.slug).toBe(`hello-world-${a.documentId.slice(0, 6)}`);
      const b = await ok(create('post', { title: 'Hello World' }));
      expect(b.slug).toBe(`hello-world-${b.documentId.slice(0, 6)}`);
      expect((await ok(update('post', a.documentId, { title: 'Bye' }))).slug).toBe(`bye-${a.documentId.slice(0, 6)}`);
    });

    it('uses 8 hex when another entry shares the 6-hex prefix', async () => {
      const a = await ok(create('post', { title: 'Twin' }));
      const b = await ok(create('post', { title: 'Twin' }));
      // Give B a documentId with A's 6-hex prefix, then let it regenerate.
      const twin = `${a.documentId.slice(0, 6)}${b.documentId.slice(6)}`;
      await sql`update ct_post set document_id = ${twin}, slug = null where document_id = ${b.documentId}`.execute(t.db);
      expect((await ok(update('post', twin, { title: 'Twin' }))).slug).toBe(`twin-${twin.replace(/-/g, '').slice(0, 8)}`);
    });
  });

  describe('localized slugs', () => {
    it('are generated per locale from that locale\'s title, unique per locale', async () => {
      const a = await ok(create('article', { title: 'Summer Sale' }, 'en-US'));
      expect(a.slug).toBe('summer-sale');
      const vi = await ok(update('article', a.documentId, { title: 'Khuyến mãi hè' }, 'vi-VN'));
      expect(vi.slug).toBe('khuyen-mai-he');
      expect((await ok(call(`/api/admin/content/article/${a.documentId}?locale=en-US`))).slug).toBe('summer-sale');
      // Same text in another locale of another entry: no conflict across locales.
      const b = await ok(create('article', { title: 'Khuyến mãi hè' }, 'en-US'));
      expect(b.slug).toBe('khuyen-mai-he');
      const c = await ok(create('article', { title: 'Khuyến mãi hè' }, 'vi-VN'));
      expect(c.slug).toBe('khuyen-mai-he-2');
    });

    it('a non-localized slug comes from the default locale\'s value', async () => {
      const a = await ok(create('landing', { title: 'Big Day' }, 'en-US'));
      expect(a.slug).toBe('big-day');
      const vi = await ok(update('landing', a.documentId, { title: 'Ngày lớn' }, 'vi-VN'));
      expect(vi.slug).toBe('big-day');
      expect((await ok(update('landing', a.documentId, { title: 'Bigger Day' }, 'en-US'))).slug).toBe('bigger-day');
    });
  });

  describe('PrivateEntriesService', () => {
    it('applies the same rules', async () => {
      const svc = t.app.get(PrivateEntriesService);
      const a = await svc.create('note', { title: 'Private Note' });
      expect(a.data.slug).toBe('private-note');
      const b = await svc.create('note', { title: 'Private Note' });
      expect(b.data.slug).toBe('private-note-2');
      await expect(svc.update('note', b.data.documentId as string, { slug: 'private-note' })).rejects.toMatchObject({ status: 422 });
    });
  });
});
