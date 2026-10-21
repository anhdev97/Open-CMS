import { Inject, Injectable } from '@nestjs/common';
import { isLocale, type Locale } from '@opencms/schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { AUTH_SETUP_LOCK, GRANT_REVOKER, OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { normalizeEmail } from '../security/email';
import { PasswordService } from '../security/password';
import { effectivePermissions, SUPER_ADMIN_GROUP, type Permission } from '../permissions';

export type Trx = Transaction<AuthTables>;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled';
  /** Sorted by key. */
  groups: { key: string; name: string }[];
  permissions: Permission[];
  isSuperAdmin: boolean;
  passwordHash: string | null;
  lastLoginAt: Date | null;
  locale: Locale | null;
};

export interface GrantRevoker {
  /** Destroys the user's Grants (and their codes/tokens) except `exceptGrantId`, and all provider Sessions. */
  revokeAllGrants(userId: string, opts?: { exceptGrantId?: string }): Promise<void>;
  /** Destroys the user's provider Sessions only (logout, BFF session expiry). */
  destroyProviderSessions(userId: string): Promise<void>;
}

const SUPER_ADMIN = SUPER_ADMIN_GROUP;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unknownGroup = () => new AuthError('validation_failed', 422, 'groupIds: unknown group');

/** Who performs a user-management write (from the request's `RequestUser`). */
export interface UserActor {
  id: string;
  isSuperAdmin: boolean;
  permissions: readonly Permission[];
}

type GroupRef = { id: string; key: string; system: boolean; roles: string[] };

/**
 * Ruling R7(a): a non-super-admin may only add or remove groups that are not `system` and whose roles all lie
 * within the actor's own permissions → otherwise 403 `forbidden`.
 */
function assertCanAssign(actor: UserActor, changed: readonly GroupRef[]): void {
  if (actor.isSuperAdmin) return;
  for (const g of changed) {
    if (g.system) throw new AuthError('forbidden', 403, 'Only a super admin can add or remove super-admin members');
    const missing = g.roles.find((r) => !actor.permissions.includes(r as Permission));
    if (missing) throw new AuthError('forbidden', 403, `Cannot assign group ${g.key}: missing permission ${missing}`);
  }
}

/** Ruling R7(b): a non-super-admin may not modify (any field, groups, status), delete or reset the password of a super admin. */
function assertCanManage(actor: UserActor, targetIsSuperAdmin: boolean): void {
  if (targetIsSuperAdmin && !actor.isSuperAdmin) throw new AuthError('forbidden', 403, 'Only a super admin can manage a super admin');
}

@Injectable()
export class UserService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GRANT_REVOKER) private readonly revoker: GrantRevoker,
  ) {}

  async countUsers(trx?: Trx): Promise<number> {
    const r = await (trx ?? this.db)
      .selectFrom('auth_users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  findById(id: string, trx?: Trx): Promise<AuthUser | undefined> {
    return this.find((q) => q.where('u.id', '=', id), trx);
  }

  findByEmail(email: string, trx?: Trx): Promise<AuthUser | undefined> {
    return this.find((q) => q.where(sql`lower(u.email)`, '=', normalizeEmail(email)), trx);
  }

  private async find(filter: (q: any) => any, trx?: Trx): Promise<AuthUser | undefined> {
    const exec = trx ?? this.db;
    const row = await filter(exec.selectFrom('auth_users as u').selectAll('u')).executeTakeFirst();
    if (!row) return undefined;
    const groups = await exec
      .selectFrom('auth_user_groups as ug')
      .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
      .select(['g.key', 'g.name', 'g.system', 'g.roles'])
      .where('ug.user_id', '=', row.id)
      .orderBy('g.key')
      .execute();
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status as 'active' | 'disabled',
      groups: groups.map((g) => ({ key: g.key, name: g.name })),
      permissions: effectivePermissions(groups),
      isSuperAdmin: groups.some((g) => g.system),
      passwordHash: row.password_hash,
      lastLoginAt: row.last_login_at,
      locale: isLocale(row.locale) ? row.locale : null,
    };
  }

  /**
   * Creates a user. Without `groupIds` the user joins `super-admin` (setup wizard, env bootstrap); the users API
   * always passes `groupIds` (≥ 1, validated by the controller) and `actor`, whose groups are then limited by
   * ruling R7(a) → 403 `forbidden`. Internal callers without `actor` are trusted. Unknown group id → 422.
   */
  async create(
    input: { email: string; name: string; password?: string; actorId?: string; groupIds?: string[]; actor?: UserActor },
    trx?: Trx,
  ): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    let passwordHash: string | null = null;
    if (input.password !== undefined) {
      this.passwords.validate(input.password, email);
      passwordHash = await this.passwords.hash(input.password);
    }
    const run = async (t: Trx): Promise<string> => {
      const groups = input.groupIds === undefined ? undefined : await this.resolveGroups(input.groupIds, t);
      if (groups && input.actor) assertCanAssign(input.actor, groups);
      let id: string;
      try {
        const row = await t
          .insertInto('auth_users')
          .values({ email, name: input.name, password_hash: passwordHash, created_at: new Date(), updated_at: new Date() })
          .returning('id')
          .executeTakeFirstOrThrow();
        id = row.id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AuthError('email_taken', 409);
        throw e;
      }
      if (groups === undefined) {
        await sql`insert into auth_user_groups (user_id, group_id) select ${id}, id from auth_groups where key = ${SUPER_ADMIN}`.execute(t);
      } else if (groups.length) {
        await t.insertInto('auth_user_groups').values(groups.map((g) => ({ user_id: id, group_id: g.id }))).execute();
      }
      await this.audit.record(
        { type: 'user_created', userId: id, actorId: input.actorId, meta: { email, ...(groups ? { groups: groups.map((g) => g.key) } : {}) } },
        t,
      );
      return id;
    };
    const id = trx ? await run(trx) : await this.db.transaction().execute(run);
    return (await this.findById(id, trx))!;
  }

  /** Sets (or clears with null) the user's admin UI language. */
  async setLocale(userId: string, locale: Locale | null, ctx: { ip?: string; userAgent?: string } = {}): Promise<void> {
    await this.db.transaction().execute(async (t) => {
      const r = await t
        .updateTable('auth_users')
        .set({ locale, updated_at: new Date() })
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw new AuthError('not_found', 404, 'User not found');
      await this.audit.record(
        { type: 'user.locale.update', userId, actorId: userId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { locale } },
        t,
      );
    });
  }

  async setPassword(userId: string, password: string, trx?: Trx): Promise<void> {
    const user = await this.findById(userId, trx);
    if (!user) throw new AuthError('not_found', 404, 'User not found');
    this.passwords.validate(password, user.email);
    const hash = await this.passwords.hash(password);
    await (trx ?? this.db)
      .updateTable('auth_users')
      .set({ password_hash: hash, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
  }

  async withSetupLock<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${AUTH_SETUP_LOCK})`.execute(trx);
      return fn(trx);
    });
  }

  /** Number of active users in `super-admin`. */
  private async activeSuperAdmins(trx: Trx): Promise<number> {
    const r = await trx
      .selectFrom('auth_users as u')
      .innerJoin('auth_user_groups as ug', 'ug.user_id', 'u.id')
      .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
      .select((eb) => eb.fn.count<string>('u.id').distinct().as('n'))
      .where('g.key', '=', SUPER_ADMIN)
      .where('u.status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** True when `userId` is an active super admin and no other active super admin exists. */
  private async isLastActiveSuperAdmin(userId: string, trx: Trx): Promise<boolean> {
    const rows = await trx
      .selectFrom('auth_users as u')
      .innerJoin('auth_user_groups as ug', 'ug.user_id', 'u.id')
      .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
      .select('u.id')
      .where('g.key', '=', SUPER_ADMIN)
      .where('u.status', '=', 'active')
      .execute();
    return rows.length === 1 && rows[0].id === userId;
  }

  /**
   * De-duplicated groups of `ids`, sorted by key, share-locked so a concurrent group delete waits for this
   * transaction; any unknown (or malformed) id → 422 `validation_failed`.
   */
  private async resolveGroups(ids: string[], trx: Trx): Promise<GroupRef[]> {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !UUID.test(id))) throw unknownGroup();
    if (unique.length === 0) return [];
    const rows = await trx.selectFrom('auth_groups').select(['id', 'key', 'system', 'roles']).where('id', 'in', unique).orderBy('key').forShare().execute();
    if (rows.length !== unique.length) throw unknownGroup();
    return rows;
  }

  /**
   * Applies `patch` to the user in one transaction under the setup advisory lock (the lock every path that can
   * shrink the set of active super admins takes: groups, status, delete), so two concurrent requests cannot both
   * remove the last super admins. A change that takes the number of active `super-admin` members to 0 rolls
   * back with 409 `last_super_admin` (spec B §3.3). Ruling R7 (403 `forbidden`) is checked first, against the
   * locked target: a non-super-admin may not modify a super admin at all, any field (R7b), and may only add or
   * remove groups within their own permissions (R7a, every group of the symmetric difference current/next).
   */
  async update(
    userId: string,
    patch: { name?: string; status?: 'active' | 'disabled'; groupIds?: string[] },
    actor: UserActor,
  ): Promise<void> {
    await this.withSetupLock(async (trx) => {
      const current = await this.lockTarget(userId, trx);
      assertCanManage(actor, current.some((g) => g.system));
      const before = await this.activeSuperAdmins(trx);

      if (patch.groupIds !== undefined) {
        const next = await this.resolveGroups(patch.groupIds, trx);
        const has = (gs: GroupRef[], id: string) => gs.some((g) => g.id === id);
        const changed = [...current.filter((g) => !has(next, g.id)), ...next.filter((g) => !has(current, g.id))];
        assertCanAssign(actor, changed);
        if (changed.length) {
          await trx.deleteFrom('auth_user_groups').where('user_id', '=', userId).execute();
          if (next.length) await trx.insertInto('auth_user_groups').values(next.map((g) => ({ user_id: userId, group_id: g.id }))).execute();
          await this.audit.record(
            { type: 'user.groups.update', userId, actorId: actor.id, meta: { before: current.map((g) => g.key), after: next.map((g) => g.key) } },
            trx,
          );
        }
      }

      if (patch.status !== undefined) {
        await trx.updateTable('auth_users').set({ status: patch.status, updated_at: new Date() }).where('id', '=', userId).execute();
        await this.audit.record({ type: patch.status === 'disabled' ? 'user_disabled' : 'user_enabled', userId, actorId: actor.id }, trx);
      }
      if (patch.name !== undefined) {
        await trx.updateTable('auth_users').set({ name: patch.name, updated_at: new Date() }).where('id', '=', userId).execute();
      }

      if (before > 0 && (await this.activeSuperAdmins(trx)) === 0) throw new AuthError('last_super_admin', 409);
      // After every check that can throw: the session rows are deleted inside this transaction, but the provider
      // grants are revoked outside it (separate storage calls), so they are not rolled back if the commit fails.
      if (patch.status === 'disabled') await this.revokeAll(userId, undefined, trx);
    });
  }

  async setStatus(userId: string, status: 'active' | 'disabled', actor: UserActor): Promise<void> {
    await this.update(userId, { status }, actor);
  }

  /** Locks the target user row (404 if missing) and returns their groups. */
  private async lockTarget(userId: string, trx: Trx): Promise<GroupRef[]> {
    const exists = await trx.selectFrom('auth_users').select('id').where('id', '=', userId).forUpdate().executeTakeFirst();
    if (!exists) throw new AuthError('not_found', 404, 'User not found');
    return trx
      .selectFrom('auth_user_groups as ug')
      .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
      .select(['g.id', 'g.key', 'g.system', 'g.roles'])
      .where('ug.user_id', '=', userId)
      .orderBy('g.key')
      .execute();
  }

  /**
   * Admin password reset: sets the password and revokes every session/grant of the target, audited. A
   * non-super-admin may not reset a super admin's password (R7b, checked against the locked target).
   */
  async resetPassword(userId: string, password: string, actor: UserActor): Promise<void> {
    await this.withSetupLock(async (trx) => {
      assertCanManage(actor, (await this.lockTarget(userId, trx)).some((g) => g.system));
      await this.setPassword(userId, password, trx);
      await this.audit.record({ type: 'password_reset_by_admin', userId, actorId: actor.id }, trx);
      await this.revokeAll(userId, undefined, trx);
    });
  }

  async delete(userId: string, actor: UserActor): Promise<void> {
    if (userId === actor.id) throw new AuthError('forbidden', 403, 'Cannot delete yourself');
    await this.withSetupLock(async (trx) => {
      assertCanManage(actor, (await this.lockTarget(userId, trx)).some((g) => g.system));
      if (await this.isLastActiveSuperAdmin(userId, trx)) throw new AuthError('last_super_admin', 409);
      await this.audit.record({ type: 'user_deleted', userId, actorId: actor.id }, trx);
      await trx.deleteFrom('auth_users').where('id', '=', userId).execute();
      await this.revoker.revokeAllGrants(userId);
    });
  }

  /**
   * Deletes the user's BFF sessions and revokes their provider grants. To keep one session working
   * (own password change) pass both its id and its grant (`SessionStore.grantIdOf`): without the grant
   * the kept session would lose its refresh token at the next refresh.
   */
  async revokeAll(userId: string, opts?: { exceptSessionId?: string; exceptGrantId?: string }, trx?: Trx): Promise<void> {
    let q = (trx ?? this.db).deleteFrom('auth_sessions').where('user_id', '=', userId);
    if (opts?.exceptSessionId) q = q.where('id_hash', '<>', opts.exceptSessionId);
    await q.execute();
    if (opts?.exceptGrantId) await this.revoker.revokeAllGrants(userId, { exceptGrantId: opts.exceptGrantId });
    else await this.revoker.revokeAllGrants(userId);
  }

  async touchLogin(userId: string): Promise<void> {
    await this.db.updateTable('auth_users').set({ last_login_at: sql`now()` }).where('id', '=', userId).execute();
  }
}
