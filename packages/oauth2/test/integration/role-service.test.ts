import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleService } from '../../src/roles/role.service';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';

describe('RoleService', () => {
  let t: TestApp;
  let roles: RoleService;
  let users: UserService;

  beforeAll(async () => {
    t = await createTestApp();
    roles = t.app.get(RoleService);
    users = t.app.get(UserService);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await t.db.deleteFrom('auth_user_roles').execute();
    await t.db.deleteFrom('auth_users').execute();
  });

  it('CRUD: create list get patch description rename delete', async () => {
    const created = await roles.create({ name: 'editor', description: 'Edits content' });
    expect(created).toMatchObject({ name: 'editor', description: 'Edits content', isSystem: false });
    const listed = await roles.list();
    expect(listed.map((r) => r.name).sort()).toEqual(['editor', 'super_admin']);
    expect(await roles.get(created.id)).toMatchObject({ id: created.id, name: 'editor' });
    const patched = await roles.update(created.id, { description: 'Updated' });
    expect(patched.description).toBe('Updated');
    const renamed = await roles.update(created.id, { name: 'content_editor' });
    expect(renamed.name).toBe('content_editor');
    await roles.delete(created.id);
    await expect(roles.get(created.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('system protect: no delete/rename super_admin; description ok', async () => {
    const sa = (await roles.list()).find((r) => r.name === 'super_admin')!;
    await expect(roles.delete(sa.id)).rejects.toMatchObject({ code: 'system_role_immutable', status: 403 });
    await expect(roles.update(sa.id, { name: 'root' })).rejects.toMatchObject({
      code: 'system_role_immutable',
      status: 403,
    });
    const updated = await roles.update(sa.id, { description: 'Primary admin' });
    expect(updated.description).toBe('Primary admin');
    expect(updated.name).toBe('super_admin');
  });

  it('duplicate name → role_name_taken', async () => {
    await roles.create({ name: 'dup_role' });
    await expect(roles.create({ name: 'dup_role' })).rejects.toMatchObject({
      code: 'role_name_taken',
      status: 409,
    });
  });

  it('delete role in use → role_in_use with userCount', async () => {
    const role = await roles.create({ name: 'temp_role' });
    const u = await users.create({ email: 'r@x.com', name: 'R', password: 'correct horse battery' });
    await t.db.insertInto('auth_user_roles').values({ user_id: u.id, role_id: role.id }).execute();
    await expect(roles.delete(role.id)).rejects.toMatchObject({
      code: 'role_in_use',
      status: 409,
      userCount: 1,
    });
  });

  it('assign is idempotent; listForUser returns roles', async () => {
    const role = await roles.create({ name: 'viewer_role' });
    const u = await users.create({ email: 'v@x.com', name: 'V', password: 'correct horse battery' });
    await roles.assign(u.id, role.id);
    await roles.assign(u.id, role.id);
    const list = await roles.listForUser(u.id);
    expect(list.map((r) => r.name).sort()).toEqual(['super_admin', 'viewer_role']);
  });

  it('replace roles and unassign; last_super_admin blocked', async () => {
    const editor = await roles.create({ name: 'ed2' });
    const a = await users.create({ email: 'a1@x.com', name: 'A', password: 'correct horse battery' });
    const b = await users.create({ email: 'b1@x.com', name: 'B', password: 'correct horse battery' });
    // a and b both have super_admin from create
    const sa = (await roles.list()).find((r) => r.name === 'super_admin')!;
    await roles.replaceUserRoles(a.id, [editor.id]);
    expect((await roles.listForUser(a.id)).map((r) => r.name)).toEqual(['ed2']);
    await expect(roles.unassign(b.id, sa.id)).rejects.toMatchObject({ code: 'last_super_admin', status: 409 });
    await expect(roles.replaceUserRoles(b.id, [editor.id])).rejects.toMatchObject({
      code: 'last_super_admin',
      status: 409,
    });
  });

  it('assign unknown user or role → not_found', async () => {
    const role = await roles.create({ name: 'xrole' });
    await expect(roles.assign('00000000-0000-4000-8000-000000000099', role.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    const u = await users.create({ email: 'u2@x.com', name: 'U', password: 'correct horse battery' });
    await expect(roles.assign(u.id, '00000000-0000-4000-8000-000000000099')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
