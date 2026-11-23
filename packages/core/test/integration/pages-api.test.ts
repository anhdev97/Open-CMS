import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserService } from '@opencloudcms/oauth2';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const ADMIN = '/api/admin/content/opencloudcmsPage';
const PUBLIC = '/api/content/opencloudcmsPage';
const UUID_A = '00000000-0000-4000-8000-00000000000a';

const puck = (...types: string[]) => ({
  format: 'puck',
  formatVersion: 1,
  data: { root: {}, content: types.map((type, i) => ({ type, props: { id: `${type}-${i}`, _v: 1 } })) },
});

describe('pages API', () => {
  let t: CoreTestApp;
  let cookie: string;
  let nobodyCookie: string;

  const call = async (p: string, init: RequestInit = {}, ck = cookie) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { ...(ck ? { cookie: ck } : {}), 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const create = (body: unknown, locale = 'en-US') => call(`${ADMIN}?locale=${locale}`, { method: 'POST', body: JSON.stringify(body) });
  const publish = (id: string, body?: unknown) => call(`${ADMIN}/${id}/publish`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

  beforeAll(async () => {
    t = await createCoreTestApp({ locales: ['en-US', 'vi-VN'], pages: { blocks: [{ name: 'Heading', version: 1 }, { name: 'Text', version: 1, richText: ['content'] }] } });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    const u = await t.app.get(UserService).create({ email: 'nobody@example.com', name: 'nobody', password: PW });
    await t.db.deleteFrom('auth_user_groups' as any).where('user_id', '=', u.id).execute();
    nobodyCookie = `oc_session=${(await loginAs(t, 'nobody@example.com', PW)).sessionCookie}`;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  describe('by-path', () => {
    let id: string;
    beforeAll(async () => {
      id = (await create({ title: 'About', path: '/about', content: puck('Heading') })).body.data.documentId;
      expect((await publish(id)).status).toBe(200);
      expect((await call(`${ADMIN}/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'About (draft)' }) })).status).toBe(200);
    });

    it('public returns the published row only', async () => {
      const r = await call(`${PUBLIC}/by-path?path=/about&locale=en-US`, {}, '');
      expect(r.status).toBe(200);
      expect(r.body.data.documentId).toBe(id);
      expect(r.body.data.status).toBe('published');
      expect(r.body.data.title).toBe('About');
    });

    it('admin returns the draft with no-store', async () => {
      const r = await call(`${ADMIN}/by-path?path=/about&locale=en-US`);
      expect(r.status).toBe(200);
      expect(r.body.data.status).toBe('draft');
      expect(r.body.data.title).toBe('About (draft)');
      expect(r.headers.get('cache-control')).toBe('no-store');
    });

    it('a draft-only page is 404 on public and found on admin', async () => {
      await create({ title: 'Secret', path: '/secret' });
      const pub = await call(`${PUBLIC}/by-path?path=/secret`, {}, '');
      expect(pub.status).toBe(404);
      expect(pub.body.error).toBeTruthy();
      expect((await call(`${ADMIN}/by-path?path=/secret`)).status).toBe(200);
    });

    it('unknown path is 404 JSON; missing path is 400; locale is exact', async () => {
      expect((await call(`${PUBLIC}/by-path?path=/nope`, {}, '')).status).toBe(404);
      expect((await call(`${PUBLIC}/by-path`, {}, '')).status).toBe(400);
      expect((await call(`${PUBLIC}/by-path?path=/about&locale=vi-VN`, {}, '')).status).toBe(404);
    });

    it('admin by-path: 401 without a session, 403 without content.read', async () => {
      expect((await call(`${ADMIN}/by-path?path=/about`, {}, '')).status).toBe(401);
      const r = await call(`${ADMIN}/by-path?path=/about`, {}, nobodyCookie);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
    });
  });

  describe('filter[documentId][in]', () => {
    const ids: string[] = [];
    beforeAll(async () => {
      for (const n of ['in-a', 'in-b', 'in-c']) ids.push((await create({ title: n, path: `/${n}` })).body.data.documentId);
    });

    it('returns exactly those ids (admin and public)', async () => {
      const q = `filter[documentId][in]=${ids[2]},${ids[0]}`;
      const r = await call(`${ADMIN}?${q}`);
      expect(r.status).toBe(200);
      expect(r.body.data.map((d: any) => d.documentId).sort()).toEqual([ids[0], ids[2]].sort());
      expect(r.body.meta.total).toBe(2);
      expect((await publish(ids[1])).status).toBe(200);
      const pub = await call(`${PUBLIC}?filter[documentId][in]=${ids.join(',')}`, {}, '');
      expect(pub.body.data.map((d: any) => d.documentId)).toEqual([ids[1]]);
    });

    it('rejects 101 ids and non-uuid values with 400', async () => {
      const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
      expect((await call(`${ADMIN}?filter[documentId][in]=${many}`)).status).toBe(400);
      expect((await call(`${ADMIN}?filter[documentId][in]=${ids[0]},nope`)).status).toBe(400);
      expect((await call(`${ADMIN}?filter[documentId][in]=`)).status).toBe(400);
      const hundred = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
      expect((await call(`${ADMIN}?filter[documentId][in]=${hundred}`)).status).toBe(200);
      expect((await call(`${ADMIN}?filter[documentId][in]=${UUID_A}`)).body.data).toEqual([]);
    });
  });

  describe('publish keeps the draft version', () => {
    it('save -> publish -> save with the last-seen updatedAt is 200; no unpublished changes right after publish', async () => {
      const c = await create({ title: 'Pub', path: '/pub-save' });
      const id = c.body.data.documentId as string;
      const patch = (body: unknown, ifMatch: string) =>
        call(`${ADMIN}/${id}?locale=en-US`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'if-match': `"${ifMatch}"` } });

      const saved = await patch({ title: 'Pub 1' }, c.body.data.updatedAt);
      expect(saved.status).toBe(200);
      const seen = saved.body.data.updatedAt as string;

      expect((await publish(id)).status).toBe(200);
      const draft = await call(`${ADMIN}/${id}?locale=en-US&status=draft`);
      expect(draft.body.data.updatedAt).toBe(seen);
      expect(draft.body.data.hasUnpublishedChanges).toBe(false);
      const listed = (await call(`${ADMIN}?locale=en-US&filter[documentId][in]=${id}`)).body.data[0];
      expect(listed.hasUnpublishedChanges).toBe(false);

      const after = await patch({ title: 'Pub 2' }, seen);
      expect(after.status).toBe(200);
      const changed = await call(`${ADMIN}/${id}?locale=en-US&status=draft`);
      expect(changed.body.data.hasUnpublishedChanges).toBe(true);
    });
  });

  describe('rich text', () => {
    const evil = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';
    const textPage = (html: string) => ({
      format: 'puck',
      formatVersion: 24,
      data: { root: {}, content: [{ type: 'Text', props: { id: 't1', _v: 1, content: html, align: 'left' } }] },
    });

    it('is normalized on create and update (no event handlers, no javascript: links)', async () => {
      const c = await create({ title: 'Rich', path: '/rich', content: textPage(evil) });
      expect(c.status).toBe(201);
      const stored = c.body.data.content.data.content[0].props.content;
      expect(stored).toBe('<p>x</p>');
      const id = c.body.data.documentId;
      const u = await call(`${ADMIN}/${id}?locale=en-US`, { method: 'PATCH', body: JSON.stringify({ content: textPage(`<p>ok</p>${evil}`) }) });
      expect(u.status).toBe(200);
      const row = await call(`${ADMIN}/${id}?locale=en-US`);
      expect(JSON.stringify(row.body.data.content)).not.toMatch(/onerror|javascript:|<img/);
      expect(row.body.data.content.data.content[0].props.content).toBe('<p>ok</p><p>x</p>');
    });
  });

  describe('unknown blocks', () => {
    let ghostId: string;
    it('publish with a block missing from the manifest -> 422 unknown_block', async () => {
      ghostId = (await create({ title: 'Ghosts', path: '/ghosts', content: puck('Heading', 'Ghost', 'Ghost') })).body.data.documentId;
      const r = await publish(ghostId);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('unknown_block');
      expect(r.body.error.issues).toEqual([{ path: ['Ghost'], message: '2' }]);
      expect((await call(`${PUBLIC}/by-path?path=/ghosts`, {}, '')).status).toBe(404);
    });

    it('force: true bypasses; blocks-check then lists the page', async () => {
      expect((await publish(ghostId, { force: true })).status).toBe(200);
      const r = await call('/api/admin/pages/blocks-check');
      expect(r.status).toBe(200);
      expect(r.body.manifest).toEqual([{ name: 'Heading', version: 1 }, { name: 'Text', version: 1, richText: ['content'] }]);
      expect(r.body.data).toEqual([{ documentId: ghostId, locale: 'en-US', title: 'Ghosts', unknown: ['Ghost'] }]);
    });

    it('blocks-check needs content.read', async () => {
      expect((await call('/api/admin/pages/blocks-check', {}, '')).status).toBe(401);
      expect((await call('/api/admin/pages/blocks-check', {}, nobodyCookie)).status).toBe(403);
    });

    it('known blocks (incl. nested slots) publish without force', async () => {
      const content = { format: 'puck', formatVersion: 1, data: { root: {}, content: [{ type: 'Heading', props: { slot: [{ type: 'Text', props: {} }] } }] } };
      const id = (await create({ title: 'Fine', path: '/fine', content })).body.data.documentId;
      expect((await publish(id)).status).toBe(200);
    });
  });

  describe('without a manifest option', () => {
    let t2: CoreTestApp;
    let c2: string;
    beforeAll(async () => {
      t2 = await createCoreTestApp();
      await fetch(`${t2.baseUrl}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: t2.url },
        body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
      });
      c2 = `oc_session=${(await loginAs(t2, 'admin@example.com', PW)).sessionCookie}`;
    }, 120_000);
    afterAll(async () => {
      await t2?.close();
    });

    it('publishes unknown blocks, blocks-check returns manifest null', async () => {
      const h = { cookie: c2, 'content-type': 'application/json', origin: t2.url };
      const c = await fetch(`${t2.baseUrl}${ADMIN}`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'G', path: '/g', content: puck('Ghost') }) });
      const id = (await c.json()).data.documentId;
      expect((await fetch(`${t2.baseUrl}${ADMIN}/${id}/publish`, { method: 'POST', headers: h })).status).toBe(200);
      const r = await fetch(`${t2.baseUrl}/api/admin/pages/blocks-check`, { headers: h });
      expect(await r.json()).toEqual({ data: [], manifest: null });
    });
  });
});
