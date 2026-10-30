import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/bff/session.store';
import { sha256 } from '../../src/security/crypto';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };

interface Call {
  status: number;
  body: any;
}

describe('user management + password change API', () => {
  let t: TestApp;
  let users: UserService;
  let adminId: string;
  let cookie: string;
  let contenterId: string;

  const api = async (
    path: string,
    o: { cookie?: string; method?: string; body?: unknown } = {},
  ): Promise<Call> => {
    const method = o.method ?? 'GET';
    const headers: Record<string, string> = { cookie: `oc_session=${o.cookie ?? cookie}` };
    if (method !== 'GET') headers.origin = new URL(t.url).origin;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${t.url}${path}`, {
      method,
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  };

  const login = async (email: string, password = PW) => {
    const r = await loginAs(t, email, password);
    if (!r.sessionCookie) throw new Error('no session');
    return r.sessionCookie;
  };

  beforeAll(async () => {
    t = await createTestApp({}, { auth });
    users = t.app.get(UserService);
    const admin = await users.create({ email: 'admin@x.com', name: 'Admin', password: PW });
    adminId = admin.id;
    cookie = await login('admin@x.com');
    contenterId = (await t.db.selectFrom('auth_groups').select('id').where('key', '=', 'contenter').executeTakeFirstOrThrow()).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('GET list has identities and never exposes passwordHash', async () => {
    const u = await users.create({ email: 'withidp@x.com', name: 'Idp', password: PW });
    await t.db
      .insertInto('auth_user_identities')
      .values({ user_id: u.id, provider: 'google', subject: 'sub-1', email: 'withidp@x.com' })
      .execute();
    const r = await api('/api/admin/users');
    expect(r.status).toBe(200);
    const row = r.body.data.find((x: any) => x.id === u.id);
    expect(row).toMatchObject({ email: 'withidp@x.com', name: 'Idp', status: 'active', groups: [{ id: expect.any(String), key: 'super-admin', name: 'Super Admin' }], lastLoginAt: null });
    expect(row.identities).toEqual([{ id: expect.any(String), provider: 'google', subject: 'sub-1', email: 'withidp@x.com' }]);
    const adminRow = r.body.data.find((x: any) => x.id === adminId);
    expect(adminRow.lastLoginAt).toEqual(expect.any(String));
    expect(adminRow.identities).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|password_hash|argon2/);
  });

  it('POST without password creates an IdP-only user (null hash); password login is invalid_credentials', async () => {
    const r = await api('/api/admin/users', { method: 'POST', body: { email: ' IdpOnly@X.com ', name: 'Only', groupIds: [contenterId] } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ email: 'idponly@x.com', name: 'Only', status: 'active', identities: [] });
    expect(JSON.stringify(r.body)).not.toMatch(/password/i);
    const row = await t.db.selectFrom('auth_users').select('password_hash').where('id', '=', r.body.data.id).executeTakeFirstOrThrow();
    expect(row.password_hash).toBeNull();
    await expect(loginAs(t, 'idponly@x.com', PW)).rejects.toThrow(/invalid_credentials/);
    const audit = await t.db.selectFrom('auth_audit_events').selectAll().where('user_id', '=', r.body.data.id).where('type', '=', 'user_created').execute();
    expect(audit[0].actor_id).toBe(adminId);
  });

  it('POST validation and conflicts', async () => {
    const dup = await api('/api/admin/users', { method: 'POST', body: { email: 'ADMIN@x.com', name: 'Dup', groupIds: [contenterId] } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
    const bad = await api('/api/admin/users', { method: 'POST', body: { email: 'nope', name: 'x', groupIds: [contenterId] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation_failed');
    const extra = await api('/api/admin/users', { method: 'POST', body: { email: 'e@x.com', name: 'x', groupIds: [contenterId], roles: ['a'] } });
    expect(extra.status).toBe(422);
    const weak = await api('/api/admin/users', { method: 'POST', body: { email: 'w@x.com', name: 'x', password: 'short', groupIds: [contenterId] } });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('weak_password');
  });

  it('PATCH renames, validates, and handles status; non-UUID id is 404', async () => {
    const u = await users.create({ email: 'patch@x.com', name: 'Old', password: PW });
    const renamed = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { name: 'New' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id: u.id, name: 'New', status: 'active' });
    const empty = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: {} });
    expect(empty.status).toBe(422);
    const badStatus = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'weird' } });
    expect(badStatus.status).toBe(422);
    const dis = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'disabled', name: 'N2' } });
    expect(dis.status).toBe(200);
    expect(dis.body.data).toMatchObject({ status: 'disabled', name: 'N2' });
    const types = (await t.db.selectFrom('auth_audit_events').select('type').where('user_id', '=', u.id).execute()).map((r) => r.type);
    expect(types).toContain('user_disabled');
    const en = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'active' } });
    expect(en.body.data.status).toBe('active');
    expect((await api('/api/admin/users/not-a-uuid', { method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
    expect((await api('/api/admin/users/00000000-0000-4000-8000-000000000000', { method: 'PATCH', body: { name: 'x' } })).body.error.code).toBe('not_found');
  });

  it('PATCH disabling the last active super_admin (self) -> 409 last_super_admin', async () => {
    const solo = await createTestApp({}, { auth });
    try {
      const us = solo.app.get(UserService);
      const a = await us.create({ email: 'solo@x.com', name: 'Solo', password: PW });
      const c = (await loginAs(solo, 'solo@x.com', PW)).sessionCookie!;
      const res = await fetch(`${solo.url}/api/admin/users/${a.id}`, {
        method: 'PATCH',
        headers: { cookie: `oc_session=${c}`, origin: new URL(solo.url).origin, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'disabled' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('last_super_admin');
    } finally {
      await solo.close();
    }
  });

  it('admin reset password revokes the target sessions and audits', async () => {
    const u = await users.create({ email: 'reset@x.com', name: 'R', password: PW });
    const victim = await login('reset@x.com');
    expect((await api('/api/auth/me', { cookie: victim })).status).toBe(200);
    const weak = await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password: 'short' } });
    expect(weak.status).toBe(422);
    const r = await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password: 'brand new passphrase' } });
    expect(r.status).toBe(204);
    expect((await api('/api/auth/me', { cookie: victim })).status).toBe(401);
    expect(await t.db.selectFrom('auth_sessions').select('id_hash').where('user_id', '=', u.id).execute()).toEqual([]);
    expect(await login('reset@x.com', 'brand new passphrase')).toBeTruthy();
    const a = await t.db.selectFrom('auth_audit_events').selectAll().where('user_id', '=', u.id).where('type', '=', 'password_reset_by_admin').execute();
    expect(a).toHaveLength(1);
    expect(a[0].actor_id).toBe(adminId);
    expect((await api(`/api/admin/users/${'00000000-0000-4000-8000-000000000000'}/password`, { method: 'POST', body: { password: 'brand new passphrase' } })).status).toBe(404);
  });

  it('DELETE user: self is forbidden, others deleted (204), non-UUID is 404', async () => {
    const self = await api(`/api/admin/users/${adminId}`, { method: 'DELETE' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('forbidden');
    const u = await users.create({ email: 'del@x.com', name: 'D', password: PW });
    expect((await api(`/api/admin/users/${u.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await users.findById(u.id)).toBeUndefined();
    expect((await api('/api/admin/users/xyz', { method: 'DELETE' })).status).toBe(404);
  });

  it('DELETE identity removes only the link that belongs to that user', async () => {
    const a = await users.create({ email: 'ida@x.com', name: 'A', password: PW });
    const b = await users.create({ email: 'idb@x.com', name: 'B', password: PW });
    const ident = await t.db
      .insertInto('auth_user_identities')
      .values({ user_id: a.id, provider: 'google', subject: 'sub-a', email: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const unverified = await api(`/api/admin/users/${a.id}/identities/${ident.id}`, { method: 'DELETE' });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('step_up_required');
    const stepUp = await api('/api/admin/sso/step-up', { method: 'POST', body: { password: PW } });
    expect(stepUp.status).toBe(201);
    const wrong = await api(`/api/admin/users/${b.id}/identities/${ident.id}`, { method: 'DELETE' });
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.code).toBe('not_found');
    expect((await api(`/api/admin/users/${a.id}/identities/bad`, { method: 'DELETE' })).status).toBe(404);
    expect(await t.db.selectFrom('auth_user_identities').select('id').where('id', '=', ident.id).execute()).toHaveLength(1);
    expect((await api(`/api/admin/users/${a.id}/identities/${ident.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await t.db.selectFrom('auth_user_identities').select('id').where('id', '=', ident.id).execute()).toEqual([]);
  });

  it('a session whose user lost super-admin gets 403 forbidden (Missing permission: settings.users) on users routes', async () => {
    await users.create({ email: 'norole@x.com', name: 'N', password: PW });
    const c = await login('norole@x.com');
    const u = (await users.findByEmail('norole@x.com'))!;
    await t.db.deleteFrom('auth_user_groups').where('user_id', '=', u.id).execute();
    const r = await api('/api/admin/users', { cookie: c });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: { code: 'forbidden', message: 'Missing permission: settings.users' } });
  });

  it('POST /api/auth/password: wrong current -> 401; correct keeps this session and kills the other', async () => {
    await users.create({ email: 'pw@x.com', name: 'P', password: PW });
    const s1 = await login('pw@x.com');
    const s2 = await login('pw@x.com');
    const wrong = await api('/api/auth/password', { cookie: s1, method: 'POST', body: { currentPassword: 'not the password!!', newPassword: 'another long passphrase' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');
    const weak = await api('/api/auth/password', { cookie: s1, method: 'POST', body: { currentPassword: PW, newPassword: 'short' } });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('weak_password');
    const bad = await api('/api/auth/password', { cookie: s1, method: 'POST', body: { currentPassword: PW } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation_failed');
    const ok = await api('/api/auth/password', { cookie: s1, method: 'POST', body: { currentPassword: PW, newPassword: 'another long passphrase' } });
    expect(ok.status).toBe(204);
    expect((await api('/api/auth/me', { cookie: s1 })).status).toBe(200);
    expect((await api('/api/auth/me', { cookie: s2 })).status).toBe(401);

    // I1: the kept session must also survive its next token refresh (its grant is not revoked).
    const store = t.app.get(SessionStore);
    const before = (await store.get(s1))!;
    await t.db.updateTable('auth_sessions').set({ access_expires_at: new Date() }).where('id_hash', '=', sha256(s1)).execute();
    expect((await api('/api/auth/me', { cookie: s1 })).status).toBe(200);
    const after = (await store.get(s1))!;
    expect(after.refreshToken).toBeTruthy();
    expect(after.refreshToken).not.toBe(before.refreshToken); // rotated
    expect((await api('/api/auth/me', { cookie: s2 })).status).toBe(401);
    expect(await login('pw@x.com', 'another long passphrase')).toBeTruthy();
    const u = (await users.findByEmail('pw@x.com'))!;
    const a = await t.db.selectFrom('auth_audit_events').select('type').where('user_id', '=', u.id).where('type', '=', 'password_changed').execute();
    expect(a).toHaveLength(1);
  });

  it('password change for a user without a password hash -> 401 invalid_credentials', async () => {
    const u = await users.create({ email: 'nohash@x.com', name: 'NH', password: PW });
    const c = await login('nohash@x.com');
    await t.db.updateTable('auth_users').set({ password_hash: null }).where('id', '=', u.id).execute();
    const r = await api('/api/auth/password', { cookie: c, method: 'POST', body: { currentPassword: PW, newPassword: 'another long passphrase' } });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('invalid_credentials');
  });

  it('password change is rate limited per user', async () => {
    const rl = await createTestApp({}, { auth: { rateLimit: { loginPerEmail: { limit: 2 }, loginPerIp: { limit: 1000 } } } });
    try {
      await rl.app.get(UserService).create({ email: 'rl@x.com', name: 'RL', password: PW });
      const c = (await loginAs(rl, 'rl@x.com', PW)).sessionCookie!;
      const post = () =>
        fetch(`${rl.url}/api/auth/password`, {
          method: 'POST',
          headers: { cookie: `oc_session=${c}`, origin: new URL(rl.url).origin, 'content-type': 'application/json' },
          body: JSON.stringify({ currentPassword: 'wrong wrong wrong', newPassword: 'another long passphrase' }),
        });
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) statuses.push((await post()).status);
      expect(statuses).toEqual([401, 401, 429]);
    } finally {
      await rl.close();
    }
  });
});
