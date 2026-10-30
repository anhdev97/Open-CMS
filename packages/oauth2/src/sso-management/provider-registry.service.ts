import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { OAuth2Config } from '../config/schema';
import type { AuthTables } from '../db/types';
import { deriveKey, open } from '../security/crypto';
import { LoginPolicyService } from './login-policy.service';

export interface ActiveProvider {
  id: string;
  code: string;
  versionId: string;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  claimMapping: Record<string, string>;
}

/** No process-local or Redis cache: every decision reads authoritative DB state. */
@Injectable()
export class ProviderRegistryService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly config: OAuth2Config,
    @Inject(LoginPolicyService) private readonly policy: LoginPolicyService,
  ) {}

  async listLoginOptions(): Promise<Array<{ code: string; label: string }>> {
    if (!(await this.policy.isSsoEnabled())) return [];
    const rows = await this.db.selectFrom('auth_identity_providers as p')
      .innerJoin('auth_identity_provider_versions as v', 'v.id', 'p.active_version_id')
      .select(['p.code', 'p.display_name'])
      .where('p.lifecycle_status', '=', 'ACTIVE')
      .where('v.state', '=', 'PUBLISHED')
      .orderBy('p.display_order').orderBy('p.code').execute();
    return rows.map((r) => ({ code: r.code, label: r.display_name }));
  }

  async getForStart(code: string): Promise<ActiveProvider | undefined> {
    return this.resolve(code);
  }

  /**
   * In-flight callbacks may use the pinned published/superseded version,
   * but ONLY while provider lifecycle and global policy still allow login.
   * Caller must separately enforce 600s state expiry and single use.
   */
  async getForCallback(code: string, versionId: string): Promise<ActiveProvider | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(versionId)) return undefined;
    return this.resolve(code, versionId);
  }

  private async resolve(code: string, pinnedVersionId?: string): Promise<ActiveProvider | undefined> {
    if (!(await this.policy.isSsoEnabled())) return undefined;
    const row = await this.db.selectFrom('auth_identity_providers as p')
      .innerJoin('auth_identity_provider_versions as v', (join) =>
        pinnedVersionId
          ? join.onRef('v.provider_id', '=', 'p.id').on('v.id', '=', pinnedVersionId)
          : join.onRef('v.provider_id', '=', 'p.id').onRef('v.id', '=', 'p.active_version_id'))
      .select([
        'p.id', 'p.code', 'p.display_name', 'v.id as version_id',
        'v.state', 'v.config_public', 'v.client_secret_enc',
      ])
      .where('p.code', '=', code)
      .where('p.lifecycle_status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) return undefined;
    if (pinnedVersionId
      ? !['PUBLISHED', 'SUPERSEDED'].includes(row.state)
      : row.state !== 'PUBLISHED') return undefined;
    const raw = row.config_public;
    const issuer = raw.issuer;
    const clientId = raw.clientId;
    const scopes = raw.scopes;
    const claimMapping = raw.claimMapping;
    if (typeof issuer !== 'string' || typeof clientId !== 'string' || !row.client_secret_enc) {
      return undefined;
    }
    if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string')) return undefined;
    if (!claimMapping || typeof claimMapping !== 'object' || Array.isArray(claimMapping)) return undefined;
    const mapping = Object.fromEntries(
      Object.entries(claimMapping).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    return {
      id: row.id,
      code: row.code,
      versionId: row.version_id,
      label: row.display_name,
      issuer,
      clientId,
      clientSecret: open(deriveKey(this.config.secret, 'client-secret'), row.client_secret_enc),
      scopes,
      claimMapping: mapping,
    };
  }
}
