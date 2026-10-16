import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { AUTH_SETUP_LOCK, GRANT_REVOKER, OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { normalizeEmail } from '../security/email';
import { PasswordService } from '../security/password';

export type Trx = Transaction<AuthTables>;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled';
  roles: string[];
  passwordHash: string | null;
  lastLoginAt: Date | null;
};

export interface GrantRevoker {
  /** Destroys the user's Grants (and their codes/tokens) except `exceptGrantId`, and all provider Sessions. */
  revokeAllGrants(userId: string, opts?: { exceptGrantId?: string }): Promise<void>;
  /** Destroys the user's provider Sessions only (logout, BFF session expiry). */
  destroyProviderSessions(userId: string): Promise<void>;
}

const SUPER_ADMIN = 'super_admin';

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
    const roles = await exec
      .selectFrom('auth_user_roles as ur')
      .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
      .select('r.name')
      .where('ur.user_id', '=', row.id)
      .orderBy('r.name')
      .execute();
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status as 'active' | 'disabled',
      roles: roles.map((r) => r.name),
      passwordHash: row.password_hash,
      lastLoginAt: row.last_login_at,
    };
  }

  async create(
    input: { email: string; name: string; password?: string; actorId?: string },
    trx?: Trx,
  ): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    let passwordHash: string | null = null;
    if (input.password !== undefined) {
      this.passwords.validate(input.password, email);
      passwordHash = await this.passwords.hash(input.password);
    }
    const run = async (t: Trx): Promise<string> => {
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
      await sql`insert into auth_user_roles (user_id, role_id) select ${id}, id from auth_roles where name = ${SUPER_ADMIN}`.execute(t);
      await this.audit.record({ type: 'user_created', userId: id, actorId: input.actorId, meta: { email } }, t);
      return id;
    };
    const id = trx ? await run(trx) : await this.db.transaction().execute(run);
    return (await this.findById(id, trx))!;
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

  /** True when `userId` is an active super_admin and no other active super_admin exists. */
  private async isLastActiveSuperAdmin(userId: string, trx: Trx): Promise<boolean> {
    const rows = await trx
      .selectFrom('auth_users as u')
      .innerJoin('auth_user_roles as ur', 'ur.user_id', 'u.id')
      .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
      .select('u.id')
      .where('r.name', '=', SUPER_ADMIN)
      .where('u.status', '=', 'active')
      .execute();
    return rows.length === 1 && rows[0].id === userId;
  }

  async setStatus(userId: string, status: 'active' | 'disabled', actorId: string): Promise<void> {
    await this.withSetupLock(async (trx) => {
      if (status === 'disabled' && (await this.isLastActiveSuperAdmin(userId, trx))) {
        throw new AuthError('last_super_admin', 409);
      }
      const res = await trx
        .updateTable('auth_users')
        .set({ status, updated_at: new Date() })
        .where('id', '=', userId)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) throw new AuthError('not_found', 404, 'User not found');
      if (status === 'disabled') await this.revokeAll(userId, undefined, trx);
      await this.audit.record({ type: status === 'disabled' ? 'user_disabled' : 'user_enabled', userId, actorId }, trx);
    });
  }

  async delete(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) throw new AuthError('forbidden', 403, 'Cannot delete yourself');
    await this.withSetupLock(async (trx) => {
      const exists = await trx.selectFrom('auth_users').select('id').where('id', '=', userId).executeTakeFirst();
      if (!exists) throw new AuthError('not_found', 404, 'User not found');
      if (await this.isLastActiveSuperAdmin(userId, trx)) throw new AuthError('last_super_admin', 409);
      await this.audit.record({ type: 'user_deleted', userId, actorId }, trx);
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
