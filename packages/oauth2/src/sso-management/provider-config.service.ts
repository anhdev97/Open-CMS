import { createHmac } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { OAuth2Config } from '../config/schema';
import type { AuthTables } from '../db/types';
import { deriveKey, seal } from '../security/crypto';
import { assertPublicHttpsUrl } from './provider-validation.service';
import { checkOidcDiscovery } from './oidc-discovery-client';

export interface ProviderDraftInput {
  code: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

/** Mutations are database-serialized; published version rows are never edited here. */
@Injectable()
export class ProviderConfigService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
  ) {}

  private key(): Buffer { return deriveKey(this.cfg.secret, 'client-secret'); }

  private fingerprint(publicConfig: Record<string, unknown>, encryptedSecret: string): string {
    // Fingerprint includes encrypted secret; never log it or return it to the browser.
    return createHmac('sha256', this.key())
      .update(JSON.stringify(publicConfig)).update('\0').update(encryptedSecret).digest('hex');
  }

  private validate(input: ProviderDraftInput): void {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.code)) throw new ConflictException('Invalid provider code');
    if (!input.displayName.trim() || !input.clientId.trim() || !input.clientSecret) {
      throw new ConflictException('Missing required OIDC configuration');
    }
    assertPublicHttpsUrl(input.issuer);
    if (input.scopes && (!Array.isArray(input.scopes) ||
      !input.scopes.every((s) => typeof s === 'string' && /^[a-zA-Z0-9:._-]+$/.test(s)))) {
      throw new ConflictException('Invalid OIDC scopes');
    }
  }


  /**
   * Admin read model: never return encrypted secrets or raw fingerprints.
   * The caller must still enforce CMS RBAC before exposing this data.
   */
  async listProviders(): Promise<Array<{
    id: string;
    code: string;
    displayName: string;
    lifecycle: string;
    activeVersionId: string | null;
    draftVersionId: string | null;
    hasDraftSecret: boolean;
    draftState: string | null;
    draftUpdatedAt: string | null;
  }>> {
    const rows = await this.db.selectFrom('auth_identity_providers as p')
      .leftJoin('auth_identity_provider_versions as v', 'v.id', 'p.draft_version_id')
      .select([
        'p.id', 'p.code', 'p.display_name', 'p.lifecycle_status',
        'p.active_version_id', 'p.draft_version_id',
        'v.client_secret_enc', 'v.state as draft_state', 'v.updated_at as draft_updated_at',
      ])
      .orderBy('p.display_order').orderBy('p.code').execute();
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      lifecycle: row.lifecycle_status,
      activeVersionId: row.active_version_id,
      draftVersionId: row.draft_version_id,
      hasDraftSecret: Boolean(row.client_secret_enc),
      draftState: row.draft_state ?? null,
      draftUpdatedAt: row.draft_updated_at ? new Date(row.draft_updated_at).toISOString() : null,
    }));
  }

  async createDraft(input: ProviderDraftInput, actorId: string): Promise<{ providerId: string; draftId: string }> {
    this.validate(input);
    const config = {
      issuer: input.issuer, clientId: input.clientId,
      scopes: input.scopes ?? ['openid', 'email', 'profile'],
      claimMapping: { subject: 'sub', email: 'email', emailVerified: 'email_verified' },
    };
    const encrypted = seal(this.key(), input.clientSecret);
    const fingerprint = this.fingerprint(config, encrypted);
    return this.db.transaction().execute(async (trx) => {
      const provider = await trx.insertInto('auth_identity_providers').values({
        code: input.code, display_name: input.displayName, description: null,
        active_version_id: null, draft_version_id: null,
        created_by: actorId, updated_by: actorId, archived_at: null,
      }).returning('id').executeTakeFirstOrThrow();
      const version = await trx.insertInto('auth_identity_provider_versions').values({
        provider_id: provider.id, version_no: 1, state: 'DRAFT',
        config_public: config, client_secret_enc: encrypted,
        config_fingerprint: fingerprint, tested_fingerprint: null,
        tested_at: null, published_at: null, source_version_id: null,
        created_by: actorId, published_by: null,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.updateTable('auth_identity_providers')
        .set({ draft_version_id: version.id }).where('id', '=', provider.id).execute();
      return { providerId: provider.id, draftId: version.id };
    });
  }

  /**
   * A draft edit invalidates its previous test result.
   * expectedUpdatedAt is an optimistic concurrency token from the draft read API.
   */
  async updateDraft(
    providerId: string,
    patch: Partial<Pick<ProviderDraftInput, 'displayName' | 'issuer' | 'clientId' | 'clientSecret' | 'scopes'>>,
    expectedUpdatedAt: Date,
    actorId: string,
  ): Promise<void> {
    return this.db.transaction().execute(async (trx) => {
      const provider = await trx.selectFrom('auth_identity_providers')
        .select(['draft_version_id', 'lifecycle_status']).where('id', '=', providerId)
        .forUpdate().executeTakeFirst();
      if (!provider) throw new NotFoundException('SSO provider not found');
      if (provider.lifecycle_status === 'ARCHIVED' || !provider.draft_version_id) {
        throw new ConflictException('Provider has no editable draft');
      }
      const draft = await trx.selectFrom('auth_identity_provider_versions').selectAll()
        .where('id', '=', provider.draft_version_id).where('provider_id', '=', providerId)
        .executeTakeFirstOrThrow();
      if (!['DRAFT', 'TESTED'].includes(draft.state)) throw new ConflictException('Draft is immutable');
      if (new Date(draft.updated_at).getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException('Draft was modified concurrently');
      }
      const config = { ...draft.config_public };
      if (patch.issuer !== undefined) {
        assertPublicHttpsUrl(patch.issuer);
        config.issuer = patch.issuer;
      }
      if (patch.clientId !== undefined) {
        if (!patch.clientId.trim()) throw new ConflictException('Client ID cannot be empty');
        config.clientId = patch.clientId;
      }
      if (patch.scopes !== undefined) {
        if (!Array.isArray(patch.scopes) ||
          !patch.scopes.every((s) => typeof s === 'string' && /^[a-zA-Z0-9:._-]+$/.test(s))) {
          throw new ConflictException('Invalid scopes');
        }
        config.scopes = patch.scopes;
      }
      const encrypted = patch.clientSecret === undefined
        ? draft.client_secret_enc
        : patch.clientSecret ? seal(this.key(), patch.clientSecret) : null;
      if (!encrypted) throw new ConflictException('Client Secret cannot be empty');
      await trx.updateTable('auth_identity_provider_versions')
        .set({
          config_public: config, client_secret_enc: encrypted,
          config_fingerprint: this.fingerprint(config, encrypted),
          state: 'DRAFT', tested_fingerprint: null, tested_at: null,
          updated_at: sql`greatest(now(), updated_at + interval '1 millisecond')`,
        }).where('id', '=', draft.id).execute();
      await trx.updateTable('auth_identity_providers')
        .set({
          ...(patch.displayName === undefined ? {} : { display_name: patch.displayName.trim() }),
          updated_by: actorId, updated_at: new Date(),
        }).where('id', '=', providerId).execute();
    });
  }


  /**
   * Publish is deliberately gated by a verified TESTED state.
   * No API can set TESTED until the network-safe discovery tester is implemented.
   */

  /**
   * Test the immutable snapshot of a draft with a DNS-pinned HTTPS fetch.
   * "TESTED" means that discovery/JWKS and mandatory PKCE metadata passed;
   * it does NOT prove that the IdP accepts the client secret.
   *
   * Network calls intentionally run outside a database transaction.
   * A concurrent edit changes the fingerprint and invalidates the result.
   */
  async testDraft(providerId: string, _actorId: string): Promise<{ testedFingerprint: string; warning: string }> {
    const provider = await this.db.selectFrom('auth_identity_providers')
      .select(['draft_version_id', 'lifecycle_status']).where('id', '=', providerId).executeTakeFirst();
    if (!provider || !provider.draft_version_id || provider.lifecycle_status === 'ARCHIVED') {
      throw new NotFoundException('Editable provider draft not found');
    }
    const draft = await this.db.selectFrom('auth_identity_provider_versions')
      .select(['id', 'state', 'config_public', 'client_secret_enc', 'config_fingerprint'])
      .where('id', '=', provider.draft_version_id).where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (!draft || !['DRAFT', 'TESTED'].includes(draft.state)) {
      throw new ConflictException('No testable draft');
    }
    if (typeof draft.config_public.issuer !== 'string' ||
      typeof draft.config_public.clientId !== 'string' || !draft.client_secret_enc) {
      throw new ConflictException('Draft is missing required OIDC configuration');
    }
    await checkOidcDiscovery(draft.config_public.issuer);
    const result = await this.db.updateTable('auth_identity_provider_versions')
      .set({
        state: 'TESTED',
        tested_fingerprint: draft.config_fingerprint,
        tested_at: new Date(),
        updated_at: sql`greatest(now(), updated_at + interval '1 millisecond')`,
      })
      .where('id', '=', draft.id).where('provider_id', '=', providerId)
      .where('config_fingerprint', '=', draft.config_fingerprint)
      .where('state', 'in', ['DRAFT', 'TESTED'])
      .where(({ exists, selectFrom }) => exists(
        selectFrom('auth_identity_providers').select('id')
          .where('id', '=', providerId).where('draft_version_id', '=', draft.id)
          .where('lifecycle_status', '<>', 'ARCHIVED'),
      ))
      .returning('id').executeTakeFirst();
    if (!result) throw new ConflictException('Draft changed while discovery was being tested');
    return {
      testedFingerprint: draft.config_fingerprint,
      warning: 'OIDC discovery and JWKS validated. Client credentials were not tested end-to-end.',
    };
  }

  async publish(providerId: string, expectedFingerprint: string, actorId: string): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const provider = await trx.selectFrom('auth_identity_providers')
        .select(['id', 'draft_version_id', 'active_version_id', 'lifecycle_status'])
        .where('id', '=', providerId).forUpdate().executeTakeFirst();
      if (!provider) throw new NotFoundException('SSO provider not found');
      if (provider.lifecycle_status === 'ARCHIVED' || !provider.draft_version_id) {
        throw new ConflictException('Provider has no publishable draft');
      }
      const draft = await trx.selectFrom('auth_identity_provider_versions')
        .select(['id', 'state', 'config_fingerprint', 'tested_fingerprint', 'client_secret_enc'])
        .where('id', '=', provider.draft_version_id)
        .where('provider_id', '=', providerId).executeTakeFirstOrThrow();
      if (draft.state !== 'TESTED' || !draft.tested_fingerprint ||
        draft.tested_fingerprint !== draft.config_fingerprint ||
        draft.config_fingerprint !== expectedFingerprint || !draft.client_secret_enc) {
        throw new ConflictException('Draft must be successfully tested and unchanged before publishing');
      }
      if (provider.active_version_id) {
        await trx.updateTable('auth_identity_provider_versions')
          .set({ state: 'SUPERSEDED', updated_at: new Date() })
          .where('id', '=', provider.active_version_id).where('provider_id', '=', providerId)
          .where('state', '=', 'PUBLISHED').execute();
      }
      const updated = await trx.updateTable('auth_identity_provider_versions')
        .set({ state: 'PUBLISHED', published_at: new Date(), published_by: actorId, updated_at: new Date() })
        .where('id', '=', draft.id).where('state', '=', 'TESTED').returning('id').executeTakeFirst();
      if (!updated) throw new ConflictException('Draft was concurrently modified');
      await trx.updateTable('auth_identity_providers')
        .set({
          lifecycle_status: 'ACTIVE', active_version_id: draft.id, draft_version_id: null,
          updated_by: actorId, updated_at: new Date(),
        }).where('id', '=', providerId).execute();
      return draft.id;
    });
  }


  /** Exposes public configuration and history; secrets and fingerprint stay server-only. */
  async listVersions(providerId: string): Promise<Array<{
    id: string; versionNo: number; state: string;
    configPublic: Record<string, unknown>; testedAt: string | null; publishedAt: string | null;
  }>> {
    const versions = await this.db.selectFrom('auth_identity_provider_versions')
      .select(['id', 'version_no', 'state', 'config_public', 'tested_at', 'published_at'])
      .where('provider_id', '=', providerId).orderBy('version_no', 'desc').execute();
    return versions.map((row) => ({
      id: row.id, versionNo: row.version_no, state: row.state,
      configPublic: row.config_public,
      testedAt: row.tested_at ? new Date(row.tested_at).toISOString() : null,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    }));
  }

  async restore(providerId: string, actorId: string): Promise<void> {
    const restored = await this.db.updateTable('auth_identity_providers')
      .set({ lifecycle_status: 'ACTIVE', updated_by: actorId, updated_at: new Date() })
      .where('id', '=', providerId).where('lifecycle_status', '=', 'DISABLED')
      .where('active_version_id', 'is not', null)
      .returning('id').executeTakeFirst();
    if (!restored) throw new ConflictException('Only a disabled provider with an active version can be restored');
  }

  async disable(providerId: string, actorId: string): Promise<void> {
    const row = await this.db.updateTable('auth_identity_providers')
      .set({ lifecycle_status: 'DISABLED', updated_by: actorId, updated_at: new Date() })
      .where('id', '=', providerId).where('lifecycle_status', '=', 'ACTIVE')
      .returning('id').executeTakeFirst();
    if (!row) throw new ConflictException('Only active providers can be disabled');
  }

  async archive(providerId: string, actorId: string): Promise<void> {
    const row = await this.db.updateTable('auth_identity_providers')
      .set({ lifecycle_status: 'ARCHIVED', archived_at: new Date(), updated_by: actorId, updated_at: new Date() })
      .where('id', '=', providerId).where('lifecycle_status', 'in', ['DRAFT', 'DISABLED'])
      .returning('id').executeTakeFirst();
    if (!row) throw new ConflictException('Disable an active provider before archiving');
  }
}
