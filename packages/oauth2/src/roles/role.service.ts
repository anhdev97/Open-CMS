import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { mapRole, type RoleRow } from './role.mapper';
import { validateRoleName } from './role-name';

type Trx = Transaction<AuthTables>;

@Injectable()
export class RoleService {
  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

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
}
