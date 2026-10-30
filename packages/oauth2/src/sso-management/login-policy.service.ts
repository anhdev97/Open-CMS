import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { OAUTH2_DB } from '../constants';
import { AuditService } from '../audit/audit.service';
import type { AuthTables } from '../db/types';

/**
 * Database-authoritative global SSO switch.
 * Local username/password login is intentionally outside this policy and remains enabled.
 */
@Injectable()
export class LoginPolicyService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async isSsoEnabled(): Promise<boolean> {
    const policy = await this.db.selectFrom('auth_login_policy')
      .select('sso_login_enabled').where('id', '=', 1).executeTakeFirstOrThrow();
    return policy.sso_login_enabled;
  }

  async getPolicy(): Promise<{ enabled: boolean; revision: number }> {
    const policy = await this.db.selectFrom('auth_login_policy')
      .select(['sso_login_enabled', 'revision']).where('id', '=', 1).executeTakeFirstOrThrow();
    return { enabled: policy.sso_login_enabled, revision: Number(policy.revision) };
  }

  async setSsoEnabled(enabled: boolean, actorId: string, expectedRevision: number): Promise<void> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ConflictException('Invalid SSO policy revision');
    }
    await this.db.transaction().execute(async (trx) => {
    const updated = await trx.updateTable('auth_login_policy')
      .set({
        sso_login_enabled: enabled,
        revision: sql`revision + 1`,
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('id', '=', 1)
      .where('revision', '=', String(expectedRevision))
      .returning('id').executeTakeFirst();
    if (!updated) throw new ConflictException('SSO policy was modified concurrently');
    await this.audit.record({ type: 'sso.policy.update', actorId,
      meta: { enabled, revision: expectedRevision + 1 } }, trx);
    });
  }
}
