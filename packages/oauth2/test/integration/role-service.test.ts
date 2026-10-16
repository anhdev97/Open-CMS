import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
