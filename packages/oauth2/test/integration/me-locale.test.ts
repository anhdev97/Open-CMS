import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { UserService } from '../../src/users/user.service';
import { oauth2_0002_user_locale } from '../../src/db/migrations/oauth2_0002_user_locale';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };

describe('PATCH /api/auth/me locale', () => {
  let t: TestApp;
  let cookie: string;
  let userId: string;

  const call = async (method: string, body?: unknown, ck: string | undefined = cookie) => {
    const headers: Record<string, string> = {};
    if (ck) headers.cookie = `oc_session=${ck}`;
    if (method !== 'GET') headers.origin = new URL(t.url).origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${t.url}/api/auth/me`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  beforeAll(async () => {
    t = await createTestApp({}, { auth });
    const u = await t.app.get(UserService).create({ email: 'loc@x.com', name: 'Loc', password: PW });
    userId = u.id;
    const r = await loginAs(t, 'loc@x.com', PW);
    cookie = r.sessionCookie!;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('GET /me has locale null by default', async () => {
    const r = await call('GET');
    expect(r.status).toBe(200);
    expect(r.body.locale).toBeNull();
  });

  it('sets vi-VN and returns the GET /me shape', async () => {
    const r = await call('PATCH', { locale: 'vi-VN' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: userId, email: 'loc@x.com', locale: 'vi-VN' });
    expect((await call('GET')).body.locale).toBe('vi-VN');
  });

  it('null clears the locale', async () => {
    const r = await call('PATCH', { locale: null });
    expect(r.status).toBe(200);
    expect(r.body.locale).toBeNull();
    expect((await call('GET')).body.locale).toBeNull();
  });

  it.each(['de-DE', 'en', 5])('rejects %s with 422', async (locale) => {
    const r = await call('PATCH', { locale });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation_failed');
  });

  it('rejects a missing locale key with 422', async () => {
    expect((await call('PATCH', {})).status).toBe(422);
  });

  it('unauthenticated -> 401', async () => {
    expect((await call('PATCH', { locale: 'vi-VN' }, '')).status).toBe(401);
  });

  it('audits user.locale.update', async () => {
    await call('PATCH', { locale: 'fr-FR' });
    const rows = await t.db.selectFrom('auth_audit_events').selectAll().where('type', '=', 'user.locale.update').execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)!.user_id).toBe(userId);
  });

  it('migration up adds a nullable text column and down removes it', async () => {
    const col = () =>
      sql<{ data_type: string; is_nullable: string }>`select data_type, is_nullable from information_schema.columns where table_name = 'auth_users' and column_name = 'locale'`.execute(t.db);
    expect((await col()).rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
    await oauth2_0002_user_locale.down!(t.db as any);
    expect((await col()).rows).toEqual([]);
    await oauth2_0002_user_locale.up(t.db as any);
    expect((await col()).rows).toHaveLength(1);
  });
});
