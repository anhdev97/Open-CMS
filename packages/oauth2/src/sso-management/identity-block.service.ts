import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthProvenanceService } from './auth-provenance.service';

/**
 * PostgreSQL is the authority. Advisory locks serialize Block with the
 * final BFF session insertion, including on different application nodes.
 */
@Injectable()
export class IdentityBlockService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(AuthProvenanceService) private readonly provenance: AuthProvenanceService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async assertAllowed(providerCode: string, subject: string): Promise<void> {
    const subjectHash = this.provenance.subjectHash(providerCode, subject);
    await this.assertHashAllowed(providerCode, subjectHash);
  }

  async assertHashAllowed(providerCode: string, subjectHash: string): Promise<void> {
    const blocked = await this.db.selectFrom('auth_identity_blocks').select('id')
      .where('provider_code', '=', providerCode)
      .where('subject_hash', '=', subjectHash)
      .where('unblocked_at', 'is', null).executeTakeFirst();
    if (blocked) throw new ConflictException('External identity is blocked');
  }

  async block(input: { providerCode: string; subject: string; reason: string; actorId: string }): Promise<number> {
    if (!input.reason.trim() || input.reason.length > 500) throw new ConflictException('Block reason is required');
    const subjectHash = this.provenance.subjectHash(input.providerCode, input.subject);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.providerCode}), hashtext(${subjectHash}))`.execute(trx);
      const provider = await trx.selectFrom('auth_identity_providers').select('id')
        .where('code', '=', input.providerCode).executeTakeFirst();
      if (!provider) throw new NotFoundException('Provider not found');
      const existing = await trx.selectFrom('auth_identity_blocks').select('id')
        .where('provider_code', '=', input.providerCode)
        .where('subject_hash', '=', subjectHash)
        .where('unblocked_at', 'is', null).executeTakeFirst();
      if (existing) throw new ConflictException('Identity already blocked');
      await trx.insertInto('auth_identity_blocks').values({
        provider_code: input.providerCode,
        subject_hash: subjectHash, reason: input.reason.trim(),
        blocked_by: input.actorId, unblocked_by: null, unblocked_at: null,
      }).execute();
      const matched = await trx.selectFrom('auth_sessions')
        .select(['id_hash', 'origin_grant_id'])
        .where('origin_provider_code', '=', input.providerCode)
        .where('origin_subject_hash', '=', subjectHash).execute();
      const deleted = await trx.deleteFrom('auth_sessions')
        .where('origin_provider_code', '=', input.providerCode)
        .where('origin_subject_hash', '=', subjectHash).executeTakeFirst();

      // Revoke only the AS grants that no other BFF sessions still reference.
      // This avoids collateral revocation of another provider/subject or local session.
      let revokedGrants = 0;
      const grants = [...new Set(matched.map((row) => row.origin_grant_id).filter((v): v is string => !!v))];
      for (const grantId of grants) {
        const inUse = await trx.selectFrom('auth_sessions').select('id_hash')
          .where('origin_grant_id', '=', grantId).executeTakeFirst();
        if (inUse) continue;
        await trx.deleteFrom('auth_oidc_payloads').where('grant_id', '=', grantId).execute();
        await trx.deleteFrom('auth_oidc_payloads')
          .where('kind', '=', 'Grant').where('id', '=', grantId).execute();
        revokedGrants++;
      }
      await this.audit.record({
        type: 'sso.identity.block', actorId: input.actorId,
        meta: { providerCode: input.providerCode, revokedSessions: Number(deleted.numDeletedRows), revokedGrants },
      }, trx);
      return Number(deleted.numDeletedRows);
    });
  }

  async unblock(input: { providerCode: string; subject: string; actorId: string }): Promise<void> {
    const subjectHash = this.provenance.subjectHash(input.providerCode, input.subject);
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.providerCode}), hashtext(${subjectHash}))`.execute(trx);
      const updated = await trx.updateTable('auth_identity_blocks').set({
        unblocked_at: new Date(), unblocked_by: input.actorId,
      }).where('provider_code', '=', input.providerCode)
        .where('subject_hash', '=', subjectHash)
        .where('unblocked_at', 'is', null).returning('id').executeTakeFirst();
      if (!updated) throw new NotFoundException('Active block not found');
      await this.audit.record({ type: 'sso.identity.unblock', actorId: input.actorId,
        meta: { providerCode: input.providerCode } }, trx);
    });
  }

  /** Unlink never removes block tombstones and does not revoke existing BFF sessions. */
  async unlink(identityId: string, actorId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx.deleteFrom('auth_user_identities')
        .where('id', '=', identityId).returning(['user_id', 'provider']).executeTakeFirst();
      if (!row) throw new NotFoundException('Identity link not found');
      await this.audit.record({ type: 'user.identity.unlink', actorId, userId: row.user_id,
        meta: { provider: row.provider } }, trx);
    });
  }
}
