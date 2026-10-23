import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { PERMISSIONS, type Permission } from '../permissions';

/** A permission group as the API returns it (spec B §4.3). */
export interface GroupView {
  id: string;
  key: string;
  name: string;
  /** Sorted; a `system` group reports every permission (`PERMISSIONS`). */
  roles: Permission[];
  system: boolean;
  userCount: number;
}

/** Who performs a write: grants are limited to the actor's own permissions unless they are a super admin. */
export interface GroupActor {
  id: string;
  isSuperAdmin: boolean;
  permissions: readonly Permission[];
}

/** Sorted, de-duplicated (spec B §3.3: stored sorted, no duplicates). */
const normalizeRoles = (roles: readonly Permission[]): Permission[] => [...new Set(roles)].sort();

/**
 * Privilege escalation rule (plan Review Focus): a non-super-admin cannot grant a group a permission they do
 * not hold themselves. Only newly added roles count; keeping or removing existing ones is not a grant.
 */
function assertCanGrant(actor: GroupActor, added: readonly Permission[]): void {
  if (actor.isSuperAdmin) return;
  const missing = added.find((p) => !actor.permissions.includes(p));
  if (missing) throw new AuthError('forbidden', 403, `Cannot grant a permission you do not hold: ${missing}`);
}

@Injectable()
export class GroupsService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(ids?: string[]): Promise<GroupView[]> {
    let q = this.db
      .selectFrom('auth_groups as g')
      .leftJoin('auth_user_groups as ug', 'ug.group_id', 'g.id')
      .select(['g.id', 'g.key', 'g.name', 'g.roles', 'g.system'])
      .select((eb) => eb.fn.count<string>('ug.user_id').as('user_count'))
      .groupBy('g.id')
      .orderBy('g.system', 'desc')
      .orderBy('g.key');
    if (ids) q = q.where('g.id', 'in', ids);
    const rows = await q.execute();
    return rows.map((g) => ({
      id: g.id,
      key: g.key,
      name: g.name,
      roles: g.system ? [...PERMISSIONS] : (g.roles as Permission[]),
      system: g.system,
      userCount: Number(g.user_count),
    }));
  }

  private async view(id: string): Promise<GroupView> {
    const [v] = await this.list([id]);
    if (!v) throw new AuthError('not_found', 404, 'Group not found');
    return v;
  }

  async create(input: { key: string; name: string; roles: Permission[] }, actor: GroupActor): Promise<GroupView> {
    const roles = normalizeRoles(input.roles);
    assertCanGrant(actor, roles);
    const id = await this.db.transaction().execute(async (trx) => {
      let row: { id: string };
      try {
        row = await trx
          .insertInto('auth_groups')
          .values({ key: input.key, name: input.name, roles, updated_at: new Date() })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AuthError('group_key_taken', 409, 'Group key already exists');
        throw e;
      }
      await this.audit.record({ type: 'group.create', actorId: actor.id, meta: { groupId: row.id, key: input.key, roles } }, trx);
      return row.id;
    });
    return this.view(id);
  }

  async update(id: string, patch: { name?: string; roles?: Permission[] }, actor: GroupActor): Promise<GroupView> {
    await this.db.transaction().execute(async (trx) => {
      const g = await trx.selectFrom('auth_groups').select(['key', 'roles', 'system']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw new AuthError('not_found', 404, 'Group not found');
      if (g.system) throw new AuthError('system_group', 409, 'System groups cannot be changed');
      const roles = patch.roles === undefined ? undefined : normalizeRoles(patch.roles);
      if (roles) assertCanGrant(actor, roles.filter((r) => !g.roles.includes(r)));
      await trx
        .updateTable('auth_groups')
        .set({ ...(patch.name !== undefined ? { name: patch.name } : {}), ...(roles ? { roles } : {}), updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await this.audit.record(
        {
          type: 'group.update',
          actorId: actor.id,
          meta: { groupId: id, key: g.key, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(roles ? { before: g.roles, roles } : {}) },
        },
        trx,
      );
    });
    return this.view(id);
  }

  /** Deletes a non-system group and its user links (members may end up with 0 groups, spec B §4.3). */
  async delete(id: string, actor: GroupActor): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const g = await trx.selectFrom('auth_groups').select(['key', 'system']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw new AuthError('not_found', 404, 'Group not found');
      if (g.system) throw new AuthError('system_group', 409, 'System groups cannot be deleted');
      const removed = await trx.deleteFrom('auth_user_groups').where('group_id', '=', id).executeTakeFirst();
      await trx.deleteFrom('auth_groups').where('id', '=', id).execute();
      await this.audit.record(
        { type: 'group.delete', actorId: actor.id, meta: { groupId: id, key: g.key, userCount: Number(removed.numDeletedRows) } },
        trx,
      );
    });
  }
}
