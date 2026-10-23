import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../src/permissions';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };
const NIL = '00000000-0000-4000-8000-000000000000';

interface Call {
  status: number;
  body: any;
}

function client(t: TestApp) {
  return async (path: string, o: { cookie: string; method?: string; body?: unknown }): Promise<Call> => {
    const method = o.method ?? 'GET';
    const headers: Record<string, string> = { cookie: `oc_session=${o.cookie}` };
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
}

async function groupId(t: TestApp, key: string): Promise<string> {
  return (await t.db.selectFrom('auth_groups').select('id').where('key', '=', key).executeTakeFirstOrThrow()).id;
}

async function newGroup(t: TestApp, key: string, roles: string[]): Promise<string> {
  const r = await t.db
    .insertInto('auth_groups')
    .values({ key, name: key, roles: [...roles].sort() })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function login(t: TestApp, email: string): Promise<string> {
  const r = await loginAs(t, email, PW);
  if (!r.sessionCookie) throw new Error('no session');
  return r.sessionCookie;
}

async function auditTypes(t: TestApp, type: string) {
  return t.db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).execute();
}

describe('groups API', () => {
  let t: TestApp;
  let users: UserService;
  let api: ReturnType<typeof client>;
  let adminId: string;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp({}, { auth });
    users = t.app.get(UserService);
    api = client(t);
    adminId = (await users.create({ email: 'admin@x.com', name: 'Admin', password: PW })).id;
    admin = await login(t, 'admin@x.com');
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('GET /api/admin/permissions returns PERMISSIONS', async () => {
    const r = await api('/api/admin/permissions', { cookie: admin });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: [...PERMISSIONS] });
  });

  it('GET lists the seed groups with userCount; super-admin reports every permission', async () => {
    const r = await api('/api/admin/groups', { cookie: admin });
    expect(r.status).toBe(200);
    const byKey = Object.fromEntries(r.body.data.map((g: any) => [g.key, g]));
    expect(byKey['super-admin']).toEqual({
      id: expect.any(String), key: 'super-admin', name: 'Super Admin', roles: [...PERMISSIONS], system: true, userCount: 1,
    });
    expect(byKey.contenter).toMatchObject({
      key: 'contenter', system: false, userCount: 0,
      roles: ['content.create', 'content.delete', 'content.read', 'content.submit', 'content.update'],
    });
    expect(byKey.reviewer).toMatchObject({ roles: ['content.publish', 'content.read', 'content.update'] });
  });

  it('POST creates (201, roles sorted and de-duplicated, audited); duplicate key 409 group_key_taken', async () => {
    const r = await api('/api/admin/groups', {
      cookie: admin, method: 'POST',
      body: { key: 'editors', name: 'Editors', roles: ['content.update', 'content.read', 'content.update'] },
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({
      id: expect.any(String), key: 'editors', name: 'Editors', roles: ['content.read', 'content.update'], system: false, userCount: 0,
    });
    const a = (await auditTypes(t, 'group.create')).find((e) => (e.meta as any).key === 'editors');
    expect(a?.actor_id).toBe(adminId);
    const dup = await api('/api/admin/groups', { cookie: admin, method: 'POST', body: { key: 'editors', name: 'Again', roles: [] } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('group_key_taken');
  });

  it('POST validation: key slug, name 1-100, unknown role -> 422', async () => {
    const bad = [
      { key: 'Bad Key', name: 'x', roles: [] },
      { key: '1abc', name: 'x', roles: [] },
      { key: 'a'.repeat(65), name: 'x', roles: [] },
      { key: 'ok-key', name: '', roles: [] },
      { key: 'ok-key', name: 'n'.repeat(101), roles: [] },
      { key: 'ok-key', name: 'x', roles: ['content.read', 'content.fly'] },
      { key: 'ok-key', name: 'x' },
      { key: 'ok-key', name: 'x', roles: [], system: true },
    ];
    for (const body of bad) {
      const r = await api('/api/admin/groups', { cookie: admin, method: 'POST', body });
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.code).toBe('validation_failed');
    }
    expect((await api('/api/admin/groups', { cookie: admin, method: 'POST', body: { key: 'a'.repeat(64), name: 'n'.repeat(100), roles: [] } })).status).toBe(201);
  });

  it('PATCH updates name/roles (audited); system group 409 system_group; key not patchable; 404s', async () => {
    const id = await newGroup(t, 'patchme', ['content.read']);
    const r = await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'PATCH', body: { name: 'Patched', roles: ['settings.users', 'content.read'] } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id, key: 'patchme', name: 'Patched', roles: ['content.read', 'settings.users'] });
    expect((await auditTypes(t, 'group.update')).some((e) => (e.meta as any).groupId === id)).toBe(true);
    const sys = await api(`/api/admin/groups/${await groupId(t, 'super-admin')}`, { cookie: admin, method: 'PATCH', body: { name: 'Root' } });
    expect(sys.status).toBe(409);
    expect(sys.body.error.code).toBe('system_group');
    expect((await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'PATCH', body: { key: 'other' } })).status).toBe(422);
    expect((await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'PATCH', body: {} })).status).toBe(422);
    expect((await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'PATCH', body: { roles: ['nope'] } })).status).toBe(422);
    expect((await api(`/api/admin/groups/${NIL}`, { cookie: admin, method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
    expect((await api('/api/admin/groups/not-a-uuid', { cookie: admin, method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
  });

  it('DELETE removes the group and its user links (user keeps existing with 0 groups); system group 409', async () => {
    const id = await newGroup(t, 'doomed', ['content.read']);
    const u = await users.create({ email: 'member@x.com', name: 'M', password: PW, groupIds: [id] });
    const r = await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'DELETE' });
    expect(r.status).toBe(204);
    expect(await t.db.selectFrom('auth_groups').select('id').where('id', '=', id).execute()).toEqual([]);
    expect((await users.findById(u.id))?.groups).toEqual([]);
    expect((await auditTypes(t, 'group.delete')).some((e) => (e.meta as any).key === 'doomed')).toBe(true);
    const sys = await api(`/api/admin/groups/${await groupId(t, 'super-admin')}`, { cookie: admin, method: 'DELETE' });
    expect(sys.status).toBe(409);
    expect(sys.body.error.code).toBe('system_group');
    expect((await api(`/api/admin/groups/${NIL}`, { cookie: admin, method: 'DELETE' })).status).toBe(404);
  });

  it('groups routes need settings.groups (GET list also allowed with settings.users); permissions needs settings.groups', async () => {
    await newGroup(t, 'only-content', ['content.read']);
    await users.create({ email: 'content@x.com', name: 'C', password: PW, groupIds: [await groupId(t, 'only-content')] });
    const c = await login(t, 'content@x.com');
    for (const [path, method] of [['/api/admin/groups', 'GET'], ['/api/admin/permissions', 'GET'], ['/api/admin/groups', 'POST']] as const) {
      const r = await api(path, { cookie: c, method, body: method === 'POST' ? { key: 'x', name: 'x', roles: [] } : undefined });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
    }
    await newGroup(t, 'user-admins', ['settings.users']);
    await users.create({ email: 'ua@x.com', name: 'UA', password: PW, groupIds: [await groupId(t, 'user-admins')] });
    const ua = await login(t, 'ua@x.com');
    expect((await api('/api/admin/groups', { cookie: ua })).status).toBe(200);
    expect((await api('/api/admin/groups', { cookie: ua, method: 'POST', body: { key: 'y', name: 'y', roles: [] } })).status).toBe(403);
  });

  describe('users API with groups', () => {
    it('POST requires groupIds (>= 1, all existing) -> 422; returns groups; list returns groups', async () => {
      const contenter = await groupId(t, 'contenter');
      for (const body of [
        { email: 'g1@x.com', name: 'G' },
        { email: 'g1@x.com', name: 'G', groupIds: [] },
        { email: 'g1@x.com', name: 'G', groupIds: [NIL] },
        { email: 'g1@x.com', name: 'G', groupIds: ['nope'] },
        { email: 'g1@x.com', name: 'G', groupIds: [contenter, NIL] },
      ]) {
        const r = await api('/api/admin/users', { cookie: admin, method: 'POST', body });
        expect(r.status, JSON.stringify(body)).toBe(422);
        expect(r.body.error.code).toBe('validation_failed');
      }
      expect(await users.findByEmail('g1@x.com')).toBeUndefined();
      const reviewer = await groupId(t, 'reviewer');
      const ok = await api('/api/admin/users', { cookie: admin, method: 'POST', body: { email: 'g1@x.com', name: 'G', groupIds: [reviewer, contenter, contenter] } });
      expect(ok.status).toBe(201);
      expect(ok.body.data.groups).toEqual([
        { id: contenter, key: 'contenter', name: 'Contenter' },
        { id: reviewer, key: 'reviewer', name: 'Reviewer' },
      ]);
      expect(ok.body.data.roles).toBeUndefined();
      const list = await api('/api/admin/users', { cookie: admin });
      expect(list.body.data.find((u: any) => u.id === ok.body.data.id).groups.map((g: any) => g.key)).toEqual(['contenter', 'reviewer']);
      expect(list.body.data.find((u: any) => u.id === adminId).groups.map((g: any) => g.key)).toEqual(['super-admin']);
    });

    it('PATCH groupIds replaces the groups and audits user.groups.update; unknown group 422', async () => {
      const u = await users.create({ email: 'regroup@x.com', name: 'R', password: PW, groupIds: [await groupId(t, 'contenter')] });
      const reviewer = await groupId(t, 'reviewer');
      const r = await api(`/api/admin/users/${u.id}`, { cookie: admin, method: 'PATCH', body: { groupIds: [reviewer] } });
      expect(r.status).toBe(200);
      expect(r.body.data.groups).toEqual([{ id: reviewer, key: 'reviewer', name: 'Reviewer' }]);
      const a = (await auditTypes(t, 'user.groups.update')).filter((e) => e.user_id === u.id);
      expect(a).toHaveLength(1);
      expect(a[0].actor_id).toBe(adminId);
      expect(a[0].meta).toMatchObject({ before: ['contenter'], after: ['reviewer'] });
      const bad = await api(`/api/admin/users/${u.id}`, { cookie: admin, method: 'PATCH', body: { groupIds: [NIL] } });
      expect(bad.status).toBe(422);
      // PATCH with groupIds: [] is allowed (a user may end up with 0 groups, spec B §8.3).
      const none = await api(`/api/admin/users/${u.id}`, { cookie: admin, method: 'PATCH', body: { groupIds: [] } });
      expect(none.status).toBe(200);
      expect(none.body.data.groups).toEqual([]);
    });
  });

  describe('escalation (Review Focus)', () => {
    let ua: string;
    let uaId: string;
    let ga: string;

    beforeAll(async () => {
      const userAdmins = await newGroup(t, 'esc-users', ['settings.users']);
      uaId = (await users.create({ email: 'esc-ua@x.com', name: 'UA', password: PW, groupIds: [userAdmins] })).id;
      ua = await login(t, 'esc-ua@x.com');
      const groupAdmins = await newGroup(t, 'esc-groups', ['content.read', 'settings.groups']);
      await users.create({ email: 'esc-ga@x.com', name: 'GA', password: PW, groupIds: [groupAdmins] });
      ga = await login(t, 'esc-ga@x.com');
    }, 60_000);

    it('a non-super-admin with settings.users cannot add or remove anyone to/from super-admin', async () => {
      const sa = await groupId(t, 'super-admin');
      const contenter = await groupId(t, 'contenter');
      const create = await api('/api/admin/users', { cookie: ua, method: 'POST', body: { email: 'esc-new@x.com', name: 'N', groupIds: [sa] } });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('forbidden');
      expect(await users.findByEmail('esc-new@x.com')).toBeUndefined();
      const self = await api(`/api/admin/users/${uaId}`, { cookie: ua, method: 'PATCH', body: { groupIds: [await groupId(t, 'esc-users'), sa] } });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('forbidden');
      expect((await users.findById(uaId))?.isSuperAdmin).toBe(false);
      const other = await users.create({ email: 'esc-sa@x.com', name: 'SA', password: PW });
      const demote = await api(`/api/admin/users/${other.id}`, { cookie: ua, method: 'PATCH', body: { groupIds: [contenter] } });
      expect(demote.status).toBe(403);
      expect((await users.findById(other.id))?.isSuperAdmin).toBe(true);
      // R7(b): any group change of a super-admin target is refused, even one keeping super-admin.
      const keep = await api(`/api/admin/users/${other.id}`, { cookie: ua, method: 'PATCH', body: { groupIds: [sa, contenter] } });
      expect(keep.status).toBe(403);
      expect((await users.findById(other.id))?.groups.map((g) => g.key)).toEqual(['super-admin']);
    });

    it('R7(a): a non-super-admin may only add/remove groups whose roles are within their own permissions', async () => {
      const contenter = await groupId(t, 'contenter');
      const small = await newGroup(t, 'esc-small', ['settings.users']);
      const empty = await newGroup(t, 'esc-empty', []);
      const create = await api('/api/admin/users', { cookie: ua, method: 'POST', body: { email: 'r7-c@x.com', name: 'C', groupIds: [contenter] } });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('forbidden');
      expect(await users.findByEmail('r7-c@x.com')).toBeUndefined();
      const ok = await api('/api/admin/users', { cookie: ua, method: 'POST', body: { email: 'r7-ok@x.com', name: 'OK', groupIds: [small, empty] } });
      expect(ok.status).toBe(201);
      // Adding a group beyond the actor's permissions.
      const add = await api(`/api/admin/users/${ok.body.data.id}`, { cookie: ua, method: 'PATCH', body: { groupIds: [small, contenter] } });
      expect(add.status).toBe(403);
      expect(add.body.error.code).toBe('forbidden');
      // Removing a group beyond the actor's permissions.
      const holder = await users.create({ email: 'r7-h@x.com', name: 'H', password: PW, groupIds: [contenter] });
      const remove = await api(`/api/admin/users/${holder.id}`, { cookie: ua, method: 'PATCH', body: { groupIds: [empty] } });
      expect(remove.status).toBe(403);
      expect((await users.findById(holder.id))?.groups.map((g) => g.key)).toEqual(['contenter']);
      // Only the symmetric difference counts: keeping contenter while adding an allowed group is fine.
      const keep = await api(`/api/admin/users/${holder.id}`, { cookie: ua, method: 'PATCH', body: { groupIds: [contenter, empty] } });
      expect(keep.status).toBe(200);
      expect(keep.body.data.groups.map((g: any) => g.key)).toEqual(['contenter', 'esc-empty']);
    });

    it('R7(b): a non-super-admin cannot disable, delete or reset the password of a super admin', async () => {
      const target = await users.create({ email: 'r7-sa@x.com', name: 'SA', password: PW });
      for (const [method, path, body] of [
        ['PATCH', `/api/admin/users/${target.id}`, { status: 'disabled' }],
        ['DELETE', `/api/admin/users/${target.id}`, undefined],
        ['POST', `/api/admin/users/${target.id}/password`, { password: 'brand new passphrase' }],
      ] as const) {
        const r = await api(path, { cookie: ua, method, body });
        expect(r.status, `${method} ${path}`).toBe(403);
        expect(r.body.error.code).toBe('forbidden');
      }
      // Rename is refused too (R7b: no PATCH of any field).
      const rename = await api(`/api/admin/users/${target.id}`, { cookie: ua, method: 'PATCH', body: { name: 'Hacked' } });
      expect(rename.status).toBe(403);
      expect(rename.body.error.code).toBe('forbidden');
      // PATCH has no email field (strict body): refused for every actor, before any write.
      const email = await api(`/api/admin/users/${target.id}`, { cookie: ua, method: 'PATCH', body: { email: 'hacked@x.com' } });
      expect(email.status).toBe(422);
      const after = await users.findById(target.id);
      expect(after).toMatchObject({ status: 'active', name: 'SA', email: 'r7-sa@x.com' });
      // A super admin can still rename another super admin.
      const ok = await api(`/api/admin/users/${target.id}`, { cookie: admin, method: 'PATCH', body: { name: 'Renamed SA' } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.name).toBe('Renamed SA');
      expect(await t.app.get(UserService).findByEmail('r7-sa@x.com')).toBeTruthy();
      expect(await login(t, 'r7-sa@x.com')).toBeTruthy(); // password unchanged
      // Unlinking a super admin's IdP identity (could lock out an SSO-only super admin).
      const ident = await t.db
        .insertInto('auth_user_identities')
        .values({ user_id: target.id, provider: 'google', subject: 'r7-sub', email: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      const unlink = await api(`/api/admin/users/${target.id}/identities/${ident.id}`, { cookie: ua, method: 'DELETE' });
      expect(unlink.status).toBe(403);
      expect(unlink.body.error.code).toBe('forbidden');
      expect(await t.db.selectFrom('auth_user_identities').select('id').where('id', '=', ident.id).execute()).toHaveLength(1);
      expect((await api(`/api/admin/users/${target.id}/identities/${ident.id}`, { cookie: admin, method: 'DELETE' })).status).toBe(204);
      expect(await t.db.selectFrom('auth_user_identities').select('id').where('id', '=', ident.id).execute()).toEqual([]);
      const audit = (await auditTypes(t, 'user.identity.unlink')).filter((e) => e.user_id === target.id);
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_id).toBe(adminId);
      expect(audit[0].meta).toMatchObject({ identityId: ident.id, provider: 'google' });
      // A super admin may do it.
      expect((await api(`/api/admin/users/${target.id}/password`, { cookie: admin, method: 'POST', body: { password: 'brand new passphrase' } })).status).toBe(204);
    });

    it('a non-super-admin with settings.groups cannot grant a permission they lack', async () => {
      const lacking = await api('/api/admin/groups', { cookie: ga, method: 'POST', body: { key: 'esc-pub', name: 'P', roles: ['content.read', 'content.publish'] } });
      expect(lacking.status).toBe(403);
      expect(lacking.body.error.code).toBe('forbidden');
      expect(await t.db.selectFrom('auth_groups').select('id').where('key', '=', 'esc-pub').execute()).toEqual([]);
      const ok = await api('/api/admin/groups', { cookie: ga, method: 'POST', body: { key: 'esc-read', name: 'R', roles: ['content.read'] } });
      expect(ok.status).toBe(201);
      const id = ok.body.data.id;
      const add = await api(`/api/admin/groups/${id}`, { cookie: ga, method: 'PATCH', body: { roles: ['content.read', 'settings.users'] } });
      expect(add.status).toBe(403);
      expect(add.body.error.code).toBe('forbidden');
      // Keeping or removing permissions they lack is not a grant.
      const rich = await newGroup(t, 'esc-rich', ['content.publish', 'content.read']);
      expect((await api(`/api/admin/groups/${rich}`, { cookie: ga, method: 'PATCH', body: { name: 'Renamed' } })).status).toBe(200);
      expect((await api(`/api/admin/groups/${rich}`, { cookie: ga, method: 'PATCH', body: { roles: ['content.publish'] } })).status).toBe(200);
      // A super admin may grant anything.
      expect((await api(`/api/admin/groups/${id}`, { cookie: admin, method: 'PATCH', body: { roles: ['settings.users'] } })).status).toBe(200);
    });
  });
});

describe('last super admin', () => {
  let t: TestApp;
  let users: UserService;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    t = await createTestApp({}, { auth });
    users = t.app.get(UserService);
    api = client(t);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('removing the last super admin from super-admin, disabling or deleting them -> 409 last_super_admin', async () => {
    const solo = await users.create({ email: 'solo@x.com', name: 'Solo', password: PW });
    const c = await login(t, 'solo@x.com');
    const contenter = await groupId(t, 'contenter');
    const r = await api(`/api/admin/users/${solo.id}`, { cookie: c, method: 'PATCH', body: { groupIds: [contenter] } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('last_super_admin');
    expect((await users.findById(solo.id))?.isSuperAdmin).toBe(true);
    // Combined with another change: nothing is applied.
    const both = await api(`/api/admin/users/${solo.id}`, { cookie: c, method: 'PATCH', body: { name: 'Renamed', groupIds: [] } });
    expect(both.status).toBe(409);
    expect((await users.findById(solo.id))?.name).toBe('Solo');

    // Disable over HTTP by the super admin themselves.
    const dis = await api(`/api/admin/users/${solo.id}`, { cookie: c, method: 'PATCH', body: { status: 'disabled' } });
    expect(dis.status).toBe(409);
    expect(dis.body.error.code).toBe('last_super_admin');
    // A non-super-admin user manager gets 403 (R7) before the last_super_admin check.
    const managers = await newGroup(t, 'managers', ['settings.users']);
    const mgr = await users.create({ email: 'mgr@x.com', name: 'Mgr', password: PW, groupIds: [managers] });
    const m = await login(t, 'mgr@x.com');
    expect((await api(`/api/admin/users/${solo.id}`, { cookie: m, method: 'PATCH', body: { status: 'disabled' } })).body.error.code).toBe('forbidden');
    expect((await api(`/api/admin/users/${solo.id}`, { cookie: m, method: 'DELETE' })).body.error.code).toBe('forbidden');
    // Delete of the last super admin by another (super-admin) actor is unreachable over HTTP: service level.
    const asSuper = { id: mgr.id, isSuperAdmin: true, permissions: [...PERMISSIONS] };
    await expect(users.delete(solo.id, asSuper)).rejects.toMatchObject({ code: 'last_super_admin', status: 409 });
    await expect(users.setStatus(solo.id, 'disabled', asSuper)).rejects.toMatchObject({ code: 'last_super_admin', status: 409 });
    expect((await users.findById(solo.id))?.status).toBe('active');
  });

  it('two concurrent requests removing the last two super admins: exactly one succeeds', async () => {
    const contenter = await groupId(t, 'contenter');
    // Leave exactly two active super admins.
    await t.db.updateTable('auth_users').set({ status: 'disabled' }).where('email', '=', 'solo@x.com').execute();
    const a = await users.create({ email: 'sa-a@x.com', name: 'A', password: PW });
    const b = await users.create({ email: 'sa-b@x.com', name: 'B', password: PW });
    const ca = await login(t, 'sa-a@x.com');
    const cb = await login(t, 'sa-b@x.com');
    const res = await Promise.all([
      api(`/api/admin/users/${a.id}`, { cookie: ca, method: 'PATCH', body: { groupIds: [contenter] } }),
      api(`/api/admin/users/${b.id}`, { cookie: cb, method: 'PATCH', body: { groupIds: [contenter] } }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe('last_super_admin');
    const left = [await users.findById(a.id), await users.findById(b.id)].filter((u) => u?.isSuperAdmin);
    expect(left).toHaveLength(1);

    // Same race across paths (group removal vs disable) at the service level.
    const keeper = left[0]!;
    const other = await users.create({ email: 'sa-c@x.com', name: 'C', password: PW });
    const settled = await Promise.allSettled([
      users.update(keeper.id, { groupIds: [contenter] }, { id: other.id, isSuperAdmin: true, permissions: [...PERMISSIONS] }),
      users.setStatus(other.id, 'disabled', { id: keeper.id, isSuperAdmin: true, permissions: [...PERMISSIONS] }),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'last_super_admin', status: 409 });
  });
});
