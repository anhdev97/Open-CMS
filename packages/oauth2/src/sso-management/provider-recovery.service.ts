import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { OAUTH2_CONFIG } from '../constants';
import type { OAuth2Config } from '../config/schema';
import { deriveKey } from '../security/crypto';
import { OAUTH2_DB } from '../constants';
import { AuditService } from '../audit/audit.service';
import type { AuthTables } from '../db/types';

/**
 * Recovery never rewinds or mutates a published version. It creates a new
 * untested draft copied from an existing historical version.
 */
@Injectable()
export class ProviderRecoveryService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createFromVersion(
    providerId: string,
    sourceVersionId: string,
    actorId: string,
  ): Promise<{ draftId: string; versionNo: number }> {
    return this.db.transaction().execute(async (trx) => {
      const provider = await trx.selectFrom('auth_identity_providers')
        .select(['id', 'draft_version_id', 'lifecycle_status'])
        .where('id', '=', providerId).forUpdate().executeTakeFirst();
      if (!provider) throw new NotFoundException('SSO provider not found');
      if (provider.lifecycle_status === 'ARCHIVED') {
        throw new ConflictException('Archived provider cannot be recovered');
      }
      if (provider.draft_version_id) {
        throw new ConflictException('Discard the current draft before creating a recovery draft');
      }
      const source = await trx.selectFrom('auth_identity_provider_versions')
        .select(['id', 'config_public', 'client_secret_enc', 'version_no', 'state'])
        .where('id', '=', sourceVersionId)
        .where('provider_id', '=', providerId)
        .executeTakeFirst();
      if (!source || !['PUBLISHED', 'SUPERSEDED'].includes(source.state)) {
        throw new NotFoundException('Published source version not found');
      }
      const maxVersion = await trx.selectFrom('auth_identity_provider_versions')
        .select(sql<number>`coalesce(max(version_no), 0)`.as('max_no'))
        .where('provider_id', '=', providerId).executeTakeFirstOrThrow();
      const versionNo = Number(maxVersion.max_no) + 1;
      const draft = await trx.insertInto('auth_identity_provider_versions')
        .values({
          provider_id: providerId,
          version_no: versionNo,
          state: 'DRAFT',
          config_public: source.config_public,
          client_secret_enc: source.client_secret_enc,
          config_fingerprint: createHmac('sha256', deriveKey(this.cfg.secret, 'client-secret'))
            .update(JSON.stringify(source.config_public)).update('\0')
            .update(source.client_secret_enc ?? '').digest('hex'),
          tested_fingerprint: null,
          tested_at: null,
          published_at: null,
          source_version_id: source.id,
          created_by: actorId,
          published_by: null,
        })
        .returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('auth_identity_providers')
        .set({ draft_version_id: draft.id, updated_by: actorId, updated_at: new Date() })
        .where('id', '=', providerId).execute();
      await this.audit.record({ type: 'sso.provider.recovery', actorId,
        meta: { providerId, sourceVersionId, draftId: draft.id } }, trx);
      return { draftId: draft.id, versionNo };
    });
  }
}
