import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencms/schema';
import { UserService } from '@opencms/oauth2';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';

const noteDef = defineContentType({ id: 'ct_noteaa', apiId: 'note', displayName: 'Note', fields: { title: f.text({ id: 'fld_noteaa', required: true }) } } as any);
const articleDef = defineContentType({ id: 'ct_artcle', apiId: 'article', displayName: 'Article', review: true, fields: { title: f.text({ id: 'fld_artcle', required: true }) } } as any);

describe('permission mapping (spec B §4.2) and the review flag', () => {
  let t: CoreTestApp;
  const cookies: Record<string, string> = {};

  const as = (who: string) => async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { cookie: cookies[who], 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const admin = as('admin');
  const contenter = as('contenter');
  const reviewer = as('reviewer');
  const nobody = as('nobody');

  async function mkUser(email: string, groupKey: string | null) {
    const u = await t.app.get(UserService).create({ email, name: email, password: PW });
    await t.db.deleteFrom('auth_user_groups' as any).where('user_id', '=', u.id).execute();
    if (groupKey) await sql`insert into auth_user_groups (user_id, group_id) select ${u.id}, id from auth_groups where key = ${groupKey}`.execute(t.db);
    cookies[email.split('@')[0]!] = `oc_session=${(await loginAs(t, email, PW)).sessionCookie}`;
  }

  let noteId: string;
  let articleId: string;

  beforeAll(async () => {
    t = await createCoreTestApp();
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookies.admin = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    await mkUser('contenter@example.com', 'contenter');
    await mkUser('reviewer@example.com', 'reviewer');
    await mkUser('nobody@example.com', null);

    for (const def of [noteDef, articleDef]) {
      const saved = await admin('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
      expect(saved.status).toBe(200);
    }
    noteId = (await admin('/api/admin/content/note', { method: 'POST', body: JSON.stringify({ title: 'n' }) })).body.data.documentId;
    articleId = (await admin('/api/admin/content/article', { method: 'POST', body: JSON.stringify({ title: 'a' }) })).body.data.documentId;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const forbidden = (perm: string) => ({ error: { code: 'forbidden', message: `Missing permission: ${perm}` } });

  it('stores review on the definition', async () => {
    const r = await admin('/api/admin/content-types/article');
    expect(r.body.data.review).toBe(true);
    expect((await admin('/api/admin/content-types/note')).body.data.review).toBeUndefined();
  });

  it('GET /api/admin/meta needs only a session', async () => {
    expect((await nobody('/api/admin/meta')).status).toBe(200);
    expect((await fetch(`${t.baseUrl}/api/admin/meta`)).status).toBe(401);
  });

  it('content.read: list, get, versions', async () => {
    for (const p of ['/api/admin/content/note', `/api/admin/content/note/${noteId}`, `/api/admin/content/note/${noteId}/versions`]) {
      expect((await contenter(p)).status).toBe(200);
      expect((await reviewer(p)).status).toBe(200);
      const n = await nobody(p);
      expect(n.status, p).toBe(403);
      expect(n.body).toEqual(forbidden('content.read'));
    }
  });

  it('content.create: POST', async () => {
    const body = JSON.stringify({ title: 'x' });
    expect((await contenter('/api/admin/content/note', { method: 'POST', body })).status).toBeLessThan(300);
    const r = await reviewer('/api/admin/content/note', { method: 'POST', body });
    expect(r.status).toBe(403);
    expect(r.body).toEqual(forbidden('content.create'));
    expect((await nobody('/api/admin/content/note', { method: 'POST', body })).status).toBe(403);
  });

  it('content.update: PATCH', async () => {
    const body = JSON.stringify({ title: 'y' });
    const p = `/api/admin/content/note/${noteId}`;
    expect((await contenter(p, { method: 'PATCH', body })).status).toBe(200);
    expect((await reviewer(p, { method: 'PATCH', body })).status).toBe(200);
    const n = await nobody(p, { method: 'PATCH', body });
    expect(n.status).toBe(403);
    expect(n.body).toEqual(forbidden('content.update'));
  });

  it('content.delete: DELETE', async () => {
    const tmp = (await admin('/api/admin/content/note', { method: 'POST', body: JSON.stringify({ title: 'tmp' }) })).body.data.documentId;
    const r = await reviewer(`/api/admin/content/note/${tmp}`, { method: 'DELETE' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual(forbidden('content.delete'));
    expect((await nobody(`/api/admin/content/note/${tmp}`, { method: 'DELETE' })).status).toBe(403);
    expect((await contenter(`/api/admin/content/note/${tmp}`, { method: 'DELETE' })).status).toBeLessThan(300);
  });

  it('publish / unpublish: review:false needs content.update or content.publish; review:true needs content.publish', async () => {
    const pub = (id: string, api: string, who: typeof admin, verb = 'publish') =>
      who(`/api/admin/content/${api}/${id}/${verb}`, { method: 'POST' });
    // review:false -> a Contenter (content.update) may publish and unpublish; a user with neither may not.
    expect((await pub(noteId, 'note', contenter)).status).toBe(200);
    expect((await pub(noteId, 'note', contenter, 'unpublish')).status).toBe(200);
    const none = await pub(noteId, 'note', nobody);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('forbidden');
    expect((await pub(noteId, 'note', reviewer)).status).toBe(200);
    // review:true -> only content.publish.
    const c = await pub(articleId, 'article', contenter);
    expect(c.status).toBe(403);
    expect(c.body).toEqual(forbidden('content.publish'));
    // A review type is approved from In review (spec B §5.2), so submit first.
    expect((await pub(articleId, 'article', contenter, 'submit')).status).toBe(200);
    expect((await pub(articleId, 'article', reviewer)).status).toBe(200);
    const cu = await pub(articleId, 'article', contenter, 'unpublish');
    expect(cu.status).toBe(403);
    expect(cu.body).toEqual(forbidden('content.publish'));
    expect((await pub(articleId, 'article', reviewer, 'unpublish')).status).toBe(200);
    expect((await pub(articleId, 'article', admin, 'submit')).status).toBe(200);
    expect((await pub(articleId, 'article', admin)).status).toBe(200);
  });

  it('settings.content-types: schema builder, content-groups, system APIs', async () => {
    const rows: [string, RequestInit?][] = [
      ['/api/admin/content-types/note', { method: 'DELETE' }],
      ['/api/admin/content-types/plan', { method: 'POST', body: '{}' }],
      ['/api/admin/content-groups'],
      ['/api/admin/taxonomies', { method: 'POST', body: '{}' }],
    ];
    for (const [p, init] of rows) {
      for (const who of [contenter, reviewer, nobody]) {
        const r = await who(p, init);
        expect(r.status, p).toBe(403);
        expect(r.body, p).toEqual(forbidden('settings.content-types'));
      }
      expect((await admin(p, init)).status, p).not.toBe(403);
    }
  });

  it('content type definitions are readable by any session (they drive entry forms)', async () => {
    for (const who of [contenter, reviewer, nobody]) {
      expect((await who('/api/admin/content-types')).status).toBe(200);
      expect((await who('/api/admin/content-types/note')).status).toBe(200);
    }
  });

  it('assets and taxonomy terms follow content permissions (R10)', async () => {
    const asset = JSON.stringify({ filename: 'a.png', url: 'https://x.example/a.png' });
    expect((await admin('/api/admin/taxonomies', { method: 'POST', body: JSON.stringify({ slug: 'tags', name: 'Tags' }) })).status).toBe(201);
    for (const who of [contenter, reviewer]) {
      expect((await who('/api/admin/assets')).status).toBe(200);
      expect((await who('/api/admin/taxonomies')).status).toBe(200);
      expect((await who('/api/admin/taxonomies/tags/terms')).status).toBe(200);
    }
    expect((await contenter('/api/admin/assets', { method: 'POST', body: asset })).status).toBe(201);
    expect((await contenter('/api/admin/taxonomies/tags/terms', { method: 'POST', body: JSON.stringify({ slug: 't', name: { 'en-US': 'T' } }) })).status).toBe(201);
    for (const [p, init, perm] of [
      ['/api/admin/assets', undefined, 'content.read'],
      ['/api/admin/taxonomies/tags/terms', undefined, 'content.read'],
      ['/api/admin/assets', { method: 'POST', body: asset }, 'content.update'],
      ['/api/admin/taxonomies/tags/terms', { method: 'POST', body: '{}' }, 'content.update'],
    ] as const) {
      const r = await nobody(p, init as RequestInit | undefined);
      expect(r.status, p).toBe(403);
      expect(r.body).toEqual(forbidden(perm));
    }
  });

  it('settings.languages: /api/admin/locales', async () => {
    for (const who of [contenter, reviewer, nobody]) {
      const r = await who('/api/admin/locales');
      expect(r.status).toBe(403);
      expect(r.body).toEqual(forbidden('settings.languages'));
    }
    expect((await admin('/api/admin/locales')).status).toBe(200);
  });

  it('settings.users / settings.groups: oauth2 controllers', async () => {
    expect((await contenter('/api/admin/users')).body).toEqual(forbidden('settings.users'));
    expect((await reviewer('/api/admin/groups', { method: 'POST', body: '{}' })).body).toEqual(forbidden('settings.groups'));
    expect((await admin('/api/admin/users')).status).toBe(200);
  });
});
