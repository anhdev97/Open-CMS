import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleService } from '../../src/roles/role.service';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };

interface Call {
  status: number;
  body: any;
}

describe('roles + user-roles admin API', () => {
  let t: TestApp;
  let users: UserService;
  let roles: RoleService;
  let cookie: string;
  let superAdminRoleId: string;

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
    roles = t.app.get(RoleService);
    await users.create({ email: 'admin@x.com', name: 'Admin', password: PW });
    cookie = await login('admin@x.com');
    superAdminRoleId = (await roles.list()).find((r) => r.name === 'super_admin')!.id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('full CRUD happy path as super_admin', async () => {
    const created = await api('/api/admin/roles', {
      method: 'POST',
      body: { name: 'editor', description: 'Edits content' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'editor',
      description: 'Edits content',
      isSystem: false,
    });
    expect(created.body.id).toEqual(expect.any(String));

    const list = await api('/api/admin/roles');
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: any) => r.name).sort()).toContain('editor');

    const got = await api(`/api/admin/roles/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ id: created.body.id, name: 'editor' });

    const patched = await api(`/api/admin/roles/${created.body.id}`, {
      method: 'PATCH',
      body: { description: 'Updated' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.description).toBe('Updated');

    const renamed = await api(`/api/admin/roles/${created.body.id}`, {
      method: 'PATCH',
      body: { name: 'content_editor' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('content_editor');

    const del = await api(`/api/admin/roles/${created.body.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await api(`/api/admin/roles/${created.body.id}`)).body.error.code).toBe('not_found');
  });

  it('system protect via HTTP', async () => {
    const badDelete = await api(`/api/admin/roles/${superAdminRoleId}`, { method: 'DELETE' });
    expect(badDelete.status).toBe(403);
    expect(badDelete.body.error.code).toBe('system_role_immutable');
    const badRename = await api(`/api/admin/roles/${superAdminRoleId}`, {
      method: 'PATCH',
      body: { name: 'root' },
    });
    expect(badRename.status).toBe(403);
    expect(badRename.body.error.code).toBe('system_role_immutable');
    const ok = await api(`/api/admin/roles/${superAdminRoleId}`, {
      method: 'PATCH',
      body: { description: 'Primary admin' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'super_admin', description: 'Primary admin' });
  });

  it('duplicate name → 409 role_name_taken', async () => {
    const first = await api('/api/admin/roles', { method: 'POST', body: { name: 'dup_role' } });
    expect(first.status).toBe(201);
    const dup = await api('/api/admin/roles', { method: 'POST', body: { name: 'dup_role' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('role_name_taken');
  });

  it('assign, PUT replace, unassign, idempotent POST assign', async () => {
    const role = (await api('/api/admin/roles', { method: 'POST', body: { name: 'viewer_role' } })).body;
    const u = await users.create({ email: 'assign@x.com', name: 'A', password: PW });

    const assign = await api(`/api/admin/users/${u.id}/roles/${role.id}`, { method: 'POST' });
    expect(assign.status).toBe(204);
    const assignAgain = await api(`/api/admin/users/${u.id}/roles/${role.id}`, { method: 'POST' });
    expect(assignAgain.status).toBe(204);

    let listed = await api(`/api/admin/users/${u.id}/roles`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((r: any) => r.name).sort()).toEqual(['super_admin', 'viewer_role']);

    const editor = (await api('/api/admin/roles', { method: 'POST', body: { name: 'ed_only' } })).body;
    const replaced = await api(`/api/admin/users/${u.id}/roles`, {
      method: 'PUT',
      body: { roleIds: [editor.id, superAdminRoleId] },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.map((r: any) => r.name).sort()).toEqual(['ed_only', 'super_admin']);

    const unassign = await api(`/api/admin/users/${u.id}/roles/${editor.id}`, { method: 'DELETE' });
    expect(unassign.status).toBe(204);
    listed = await api(`/api/admin/users/${u.id}/roles`);
    expect(listed.body.data.map((r: any) => r.name)).toEqual(['super_admin']);
  });

  it('delete role in use → 409 role_in_use with userCount', async () => {
    const role = (await api('/api/admin/roles', { method: 'POST', body: { name: 'temp_in_use' } })).body;
    const u = await users.create({ email: 'inuse@x.com', name: 'I', password: PW });
    await api(`/api/admin/users/${u.id}/roles/${role.id}`, { method: 'POST' });
    const del = await api(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('role_in_use');
    expect(del.body.error.userCount).toBe(1);
  });

  it('PUT/DELETE that strips last super_admin → 409 last_super_admin', async () => {
    const solo = await createTestApp({}, { auth });
    try {
      const us = solo.app.get(UserService);
      const u1 = await us.create({ email: 'solo1@x.com', name: 'One', password: PW });
      const c1 = (await loginAs(solo, 'solo1@x.com', PW)).sessionCookie!;
      const origin = new URL(solo.url).origin;
      const call = async (path: string, method: string, body?: unknown, session = c1) => {
        const headers: Record<string, string> = { cookie: `oc_session=${session}` };
        if (method !== 'GET') headers.origin = origin;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const res = await fetch(`${solo.url}${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined };
      };

      const editor = (await call('/api/admin/roles', 'POST', { name: 'strip_ed' })).body;
      const u2 = (await call('/api/admin/users', 'POST', { email: 'solo2@x.com', name: 'Two', password: PW })).body
        .data;
      const saId = (await solo.app.get(RoleService).list()).find((r) => r.name === 'super_admin')!.id;

      expect((await call(`/api/admin/users/${u1.id}/roles`, 'PUT', { roleIds: [editor.id] })).status).toBe(200);
      const c2 = (await loginAs(solo, 'solo2@x.com', PW)).sessionCookie!;

      const unassign = await call(`/api/admin/users/${u2.id}/roles/${saId}`, 'DELETE', undefined, c2);
      expect(unassign.status).toBe(409);
      expect(unassign.body.error.code).toBe('last_super_admin');

      const put = await call(`/api/admin/users/${u2.id}/roles`, 'PUT', { roleIds: [editor.id] }, c2);
      expect(put.status).toBe(409);
      expect(put.body.error.code).toBe('last_super_admin');
    } finally {
      await solo.close();
    }
  });

  it('non–super_admin session gets 403 on every roles route', async () => {
    const custom = (await api('/api/admin/roles', { method: 'POST', body: { name: 'custom_only' } })).body;
    await users.create({ email: 'norole@x.com', name: 'N', password: PW });
    const c = await login('norole@x.com');
    const u = (await users.findByEmail('norole@x.com'))!;
    await t.db.deleteFrom('auth_user_roles').where('user_id', '=', u.id).execute();
    await t.db.insertInto('auth_user_roles').values({ user_id: u.id, role_id: custom.id }).execute();

    const paths: Array<{ path: string; method?: string; body?: unknown }> = [
      { path: '/api/admin/roles' },
      { path: `/api/admin/roles/${custom.id}` },
      { path: '/api/admin/roles', method: 'POST', body: { name: 'blocked' } },
      { path: `/api/admin/roles/${custom.id}`, method: 'PATCH', body: { description: 'x' } },
      { path: `/api/admin/roles/${custom.id}`, method: 'DELETE' },
      { path: `/api/admin/users/${u.id}/roles` },
      { path: `/api/admin/users/${u.id}/roles`, method: 'PUT', body: { roleIds: [custom.id] } },
      { path: `/api/admin/users/${u.id}/roles/${custom.id}`, method: 'POST' },
      { path: `/api/admin/users/${u.id}/roles/${custom.id}`, method: 'DELETE' },
    ];
    for (const p of paths) {
      const r = await api(p.path, { cookie: c, method: p.method, body: p.body });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
    }
  });

  it('GET /api/auth/me reflects assign without re-login', async () => {
    const target = await users.create({ email: 'me@x.com', name: 'Me', password: PW });
    const targetCookie = await login('me@x.com');
    const role = (await api('/api/admin/roles', { method: 'POST', body: { name: 'reporter' } })).body;
    expect((await api('/api/auth/me', { cookie: targetCookie })).body.roles).toEqual(['super_admin']);
    expect(
      (await api(`/api/admin/users/${target.id}/roles/${role.id}`, { method: 'POST' })).status,
    ).toBe(204);
    expect((await api('/api/auth/me', { cookie: targetCookie })).body.roles.sort()).toEqual([
      'reporter',
      'super_admin',
    ]);
  });

  it('POST validation: Bad-Name → 422 validation_failed', async () => {
    const bad = await api('/api/admin/roles', { method: 'POST', body: { name: 'Bad-Name' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation_failed');
    const emptyPatch = await api(`/api/admin/roles/${superAdminRoleId}`, { method: 'PATCH', body: {} });
    expect(emptyPatch.status).toBe(422);
    expect(emptyPatch.body.error.code).toBe('validation_failed');
  });

  it('unknown ids → 404', async () => {
    const missingRole = '00000000-0000-4000-8000-000000000000';
    const missingUser = '00000000-0000-4000-8000-000000000099';
    expect((await api(`/api/admin/roles/${missingRole}`)).body.error.code).toBe('not_found');
    expect((await api(`/api/admin/roles/not-a-uuid`)).status).toBe(404);
    expect(
      (await api(`/api/admin/users/${missingUser}/roles`)).body.error.code,
    ).toBe('not_found');
    expect(
      (await api(`/api/admin/users/${missingUser}/roles`, {
        method: 'PUT',
        body: { roleIds: [superAdminRoleId] },
      })).body.error.code,
    ).toBe('not_found');
    const u = await users.create({ email: 'unk@x.com', name: 'U', password: PW });
    expect(
      (await api(`/api/admin/users/${u.id}/roles/${missingRole}`, { method: 'POST' })).body.error.code,
    ).toBe('not_found');
    expect(
      (await api(`/api/admin/users/${u.id}/roles/${missingRole}`, { method: 'DELETE' })).body.error.code,
    ).toBe('not_found');
  });
});
