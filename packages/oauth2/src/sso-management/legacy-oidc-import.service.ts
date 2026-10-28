import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { OAuth2Config } from '../config/schema';
import type { AuthTables } from '../db/types';
import { deriveKey, seal } from '../security/crypto';

/** The legacy config is an import source only, never an authority for live logins. */
@Injectable()
export class LegacyOidcImportService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
  ) {}

  async importOnce(): Promise<'imported' | 'already_imported' | 'not_configured'> {
    const legacy = this.cfg.idp.oidc;
    if (!legacy) return 'not_configured';

    const encryptionKey = deriveKey(this.cfg.secret, 'client-secret');
    // Keyed fingerprint avoids leaking low-entropy config values.
    const fingerprint = createHmac('sha256', encryptionKey)
      .update(JSON.stringify([legacy.issuer, legacy.clientId, legacy.clientSecret, legacy.label]))
      .digest('hex');

    return this.db.transaction().execute(async (trx) => {
      // Serialize across all application instances even before the marker exists.
      await trx.executeQuery(
        // PostgreSQL transaction-scoped lock; key is stable and unrelated to user data.
        { sql: 'select pg_advisory_xact_lock(1480676197, 1869181033)', parameters: [] },
      );
      const marker = await trx.selectFrom('auth_sso_migration_markers')
        .select('key').where('key', '=', 'legacy_oidc_v1').executeTakeFirst();
      if (marker) return 'already_imported';

      // Never overwrite a provider already created or edited by an administrator.
      const existing = await trx.selectFrom('auth_identity_providers')
        .select('id').where('code', '=', 'oidc').executeTakeFirst();
      if (existing) {
        await trx.insertInto('auth_sso_migration_markers')
          .values({ key: 'legacy_oidc_v1', fingerprint }).execute();
        return 'already_imported';
      }

      const provider = await trx.insertInto('auth_identity_providers').values({
        code: 'oidc',
        display_name: legacy.label,
        description: null,
        active_version_id: null,
        draft_version_id: null,
        created_by: null,
        updated_by: null,
        archived_at: null,
      }).returning('id').executeTakeFirstOrThrow();

      const version = await trx.insertInto('auth_identity_provider_versions').values({
        provider_id: provider.id,
        version_no: 1,
        config_public: {
          issuer: legacy.issuer,
          clientId: legacy.clientId,
          scopes: ['openid', 'email', 'profile'],
          clientAuthMethod: 'client_secret_basic',
          claimMapping: { subject: 'sub', email: 'email', emailVerified: 'email_verified' },
          loginLabel: legacy.label,
        },
        client_secret_enc: seal(encryptionKey, legacy.clientSecret),
        config_fingerprint: fingerprint,
        tested_fingerprint: null,
        tested_at: null,
        published_at: null,
        source_version_id: null,
        created_by: null,
        published_by: null,
      }).returning('id').executeTakeFirstOrThrow();

      // Unvalidated imports stay DRAFT. Activation is a separate, audited operation.
      await trx.updateTable('auth_identity_providers')
        .set({ draft_version_id: version.id }).where('id', '=', provider.id).execute();
      await trx.insertInto('auth_sso_migration_markers')
        .values({ key: 'legacy_oidc_v1', fingerprint }).execute();
      return 'imported';
    });
  }
}
