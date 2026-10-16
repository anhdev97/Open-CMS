import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { AUTH_SETUP_LOCK, OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { mapRole, type RoleRow } from './role.mapper';
import { validateRoleName } from './role-name';

type Trx = Transaction<AuthTables>;

const SUPER_ADMIN = 'super_admin';

@Injectable()
export class RoleService {
  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

  private async assertUserExists(userId: string, trx: Trx): Promise<void> {
    const u = await trx.selectFrom('auth_users').select('id').where('id', '=', userId).executeTakeFirst();
    if (!u) throw new AuthError('not_found', 404, 'User not found');
  }

  private async assertNotRemovingLastSuperAdmin(
    userId: string,
    nextRoleIds: string[],
    trx: Trx,
  ): Promise<void> {
    const sa = await trx
      .selectFrom('auth_roles')
      .select('id')
      .where('name', '=', SUPER_ADMIN)
      .executeTakeFirstOrThrow();
    const willHave = nextRoleIds.includes(sa.id);
    if (willHave) return;
    const user = await trx
      .selectFrom('auth_users')
      .select(['id', 'status'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (user.status !== 'active') return;
    const currentlyHas = await trx
      .selectFrom('auth_user_roles')
      .select('role_id')
      .where('user_id', '=', userId)
      .where('role_id', '=', sa.id)
      .executeTakeFirst();
    if (!currentlyHas) return;
    const others = await trx
      .selectFrom('auth_users as u')
      .innerJoin('auth_user_roles as ur', 'ur.user_id', 'u.id')
      .select('u.id')
      .where('ur.role_id', '=', sa.id)
      .where('u.status', '=', 'active')
      .where('u.id', '<>', userId)
      .execute();
    if (others.length === 0) throw new AuthError('last_super_admin', 409);
  }

  private async rowById(id: string, trx?: Trx): Promise<RoleRow | undefined> {
    const row = await (trx ?? this.db)
      .selectFrom('auth_roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? mapRole(row) : undefined;
  }

  async list(): Promise<RoleRow[]> {
    const rows = await this.db.selectFrom('auth_roles').selectAll().orderBy('name').execute();
    return rows.map(mapRole);
  }

  async get(id: string): Promise<RoleRow> {
    const row = await this.rowById(id);
    if (!row) throw new AuthError('not_found', 404, 'Role not found');
    return row;
  }

  async create(input: { name: string; description?: string }): Promise<RoleRow> {
    const name = validateRoleName(input.name);
    const description = (input.description ?? '').trim();
    try {
      const row = await this.db
        .insertInto('auth_roles')
        .values({
          name,
          description,
          is_system: false,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapRole(row);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AuthError('role_name_taken', 409, 'Role name already taken');
      throw e;
    }
  }

  async update(id: string, input: { name?: string; description?: string }): Promise<RoleRow> {
    const existing = await this.get(id);
    const patch: { name?: string; description?: string; updated_at: Date } = { updated_at: new Date() };
    if (input.name !== undefined) {
      const name = validateRoleName(input.name);
      if (existing.isSystem && name !== existing.name) {
        throw new AuthError('system_role_immutable', 403, 'System role name cannot be changed');
      }
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description.trim();
    try {
      await this.db.updateTable('auth_roles').set(patch).where('id', '=', id).execute();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AuthError('role_name_taken', 409, 'Role name already taken');
      throw e;
    }
    return this.get(id);
  }

  async countUsers(roleId: string, trx?: Trx): Promise<number> {
    const r = await (trx ?? this.db)
      .selectFrom('auth_user_roles')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.isSystem) {
      throw new AuthError('system_role_immutable', 403, 'System role cannot be deleted');
    }
    const userCount = await this.countUsers(id);
    if (userCount > 0) {
      throw new AuthError('role_in_use', 409, `Role is assigned to ${userCount} user(s)`, { userCount });
    }
    await this.db.deleteFrom('auth_roles').where('id', '=', id).execute();
  }

  async listForUser(userId: string): Promise<RoleRow[]> {
    const user = await this.db.selectFrom('auth_users').select('id').where('id', '=', userId).executeTakeFirst();
    if (!user) throw new AuthError('not_found', 404, 'User not found');
    const rows = await this.db
      .selectFrom('auth_user_roles as ur')
      .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
      .selectAll('r')
      .where('ur.user_id', '=', userId)
      .orderBy('r.name')
      .execute();
    return rows.map(mapRole);
  }

  async assign(userId: string, roleId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.assertUserExists(userId, trx);
      const role = await this.rowById(roleId, trx);
      if (!role) throw new AuthError('not_found', 404, 'Role not found');
      await trx
        .insertInto('auth_user_roles')
        .values({ user_id: userId, role_id: roleId })
        .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
        .execute();
    });
  }

  async unassign(userId: string, roleId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${AUTH_SETUP_LOCK})`.execute(trx);
      await this.assertUserExists(userId, trx);
      const role = await this.rowById(roleId, trx);
      if (!role) throw new AuthError('not_found', 404, 'Role not found');
      const current = await trx
        .selectFrom('auth_user_roles')
        .select('role_id')
        .where('user_id', '=', userId)
        .execute();
      const next = current.map((r) => r.role_id).filter((id) => id !== roleId);
      await this.assertNotRemovingLastSuperAdmin(userId, next, trx);
      await trx
        .deleteFrom('auth_user_roles')
        .where('user_id', '=', userId)
        .where('role_id', '=', roleId)
        .execute();
    });
  }

  async replaceUserRoles(userId: string, roleIds: string[]): Promise<RoleRow[]> {
    const unique = [...new Set(roleIds)];
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${AUTH_SETUP_LOCK})`.execute(trx);
      await this.assertUserExists(userId, trx);
      for (const id of unique) {
        if (!(await this.rowById(id, trx))) throw new AuthError('not_found', 404, 'Role not found');
      }
      await this.assertNotRemovingLastSuperAdmin(userId, unique, trx);
      await trx.deleteFrom('auth_user_roles').where('user_id', '=', userId).execute();
      if (unique.length) {
        await trx
          .insertInto('auth_user_roles')
          .values(unique.map((role_id) => ({ user_id: userId, role_id })))
          .execute();
      }
      const rows = await trx
        .selectFrom('auth_user_roles as ur')
        .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
        .selectAll('r')
        .where('ur.user_id', '=', userId)
        .orderBy('r.name')
        .execute();
      return rows.map(mapRole);
    });
  }
}
