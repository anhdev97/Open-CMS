import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { open, deriveKey } from '../../src/security/crypto';
import { LegacyOidcImportService } from '../../src/sso-management/legacy-oidc-import.service';
import type { OAuth2Config } from '../../src/config/schema';
import { startTestDb, type TestDb } from '../support/db';

describe('legacy OIDC one-time import', () => {
  let t: TestDb;
  const secret = randomBytes(32);
  const cfg = {
    secret,
    idp: { oidc: {
      issuer: 'https://sso.example.org',
      clientId: 'old-client',
      clientSecret: 'do-not-log-me',
      label: 'Legacy SSO',
    } },
  } as OAuth2Config;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await t?.stop(); });

  it('imports a draft with an encrypted secret and preserves the disabled login policy', async () => {
    const service = new LegacyOidcImportService(t.db, cfg);
    expect(await service.importOnce()).toBe('imported');
    const provider = await t.db.selectFrom('auth_identity_providers')
      .selectAll().where('code', '=', 'oidc').executeTakeFirstOrThrow();
    expect(provider.lifecycle_status).toBe('DRAFT');
    expect(provider.active_version_id).toBeNull();
    expect(provider.draft_version_id).toBeTruthy();
    const version = await t.db.selectFrom('auth_identity_provider_versions')
      .selectAll().where('id', '=', provider.draft_version_id!).executeTakeFirstOrThrow();
    expect(version.client_secret_enc).not.toContain('do-not-log-me');
    expect(open(deriveKey(secret, 'client-secret'), version.client_secret_enc!)).toBe('do-not-log-me');
    expect(JSON.stringify(version.config_public)).not.toContain('do-not-log-me');
    const policy = await t.db.selectFrom('auth_login_policy').selectAll().executeTakeFirstOrThrow();
    expect(policy.sso_login_enabled).toBe(false);
  });

  it('is idempotent and never overwrites an admin-edited provider', async () => {
    const service = new LegacyOidcImportService(t.db, cfg);
    await t.db.updateTable('auth_identity_providers').set({ display_name: 'Admin edited' })
      .where('code', '=', 'oidc').execute();
    expect(await service.importOnce()).toBe('already_imported');
    const rows = await t.db.selectFrom('auth_identity_providers')
      .select(['display_name']).where('code', '=', 'oidc').execute();
    expect(rows).toEqual([{ display_name: 'Admin edited' }]);
  });

  it('does nothing without a configured legacy IdP', async () => {
    const service = new LegacyOidcImportService(t.db, { ...cfg, idp: {} });
    expect(await service.importOnce()).toBe('not_configured');
  });
});
