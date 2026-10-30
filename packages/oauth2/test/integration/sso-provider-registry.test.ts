import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OAuth2Config } from '../../src/config/schema';
import { deriveKey, seal } from '../../src/security/crypto';
import { LoginPolicyService } from '../../src/sso-management/login-policy.service';
import { AuditService } from '../../src/audit/audit.service';
import { ProviderRegistryService } from '../../src/sso-management/provider-registry.service';
import { startTestDb, type TestDb } from '../support/db';

describe('dynamic SSO registry', () => {
  let t: TestDb;
  let policy: LoginPolicyService;
  let registry: ProviderRegistryService;
  let providerId: string;
  let versionId: string;
  const secret = randomBytes(32);
  const actorId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    t = await startTestDb();
    policy = new LoginPolicyService(t.db, new AuditService(t.db));
    registry = new ProviderRegistryService(t.db, { secret } as OAuth2Config, policy);
    const p = await t.db.insertInto('auth_identity_providers').values({
      code: 'entra', display_name: 'Microsoft Entra', description: null,
      active_version_id: null, draft_version_id: null,
      created_by: null, updated_by: null, archived_at: null,
    }).returning('id').executeTakeFirstOrThrow();
    providerId = p.id;
    const v = await t.db.insertInto('auth_identity_provider_versions').values({
      provider_id: providerId, version_no: 1, state: 'PUBLISHED',
      config_public: { issuer: 'https://login.example.org', clientId: 'client',
        scopes: ['openid', 'email'], claimMapping: { subject: 'sub' } },
      client_secret_enc: seal(deriveKey(secret, 'client-secret'), 'test-secret'),
      config_fingerprint: 'hash', tested_fingerprint: 'hash',
      tested_at: new Date(), published_at: new Date(),
      source_version_id: null, created_by: null, published_by: null,
    }).returning('id').executeTakeFirstOrThrow();
    versionId = v.id;
    await t.db.updateTable('auth_identity_providers').set({
      lifecycle_status: 'ACTIVE', active_version_id: versionId,
    }).where('id', '=', providerId).execute();
  });
  afterAll(async () => { await t?.stop(); });

  it('does not expose login options while the global policy is off', async () => {
    expect(await registry.listLoginOptions()).toEqual([]);
    expect(await registry.getForStart('entra')).toBeUndefined();
    expect(await registry.getForCallback('entra', versionId)).toBeUndefined();
  });

  it('allows published providers and decrypts secrets only for internal runtime', async () => {
    await policy.setSsoEnabled(true, actorId, 0);
    expect(await registry.listLoginOptions()).toEqual([{ code: 'entra', label: 'Microsoft Entra' }]);
    const runtime = await registry.getForStart('entra');
    expect(runtime?.clientSecret).toBe('test-secret');
    expect(runtime?.versionId).toBe(versionId);
    expect(await registry.getForCallback('entra', versionId)).toEqual(runtime);
    expect(await registry.getForCallback('entra', 'not-a-uuid')).toBeUndefined();
  });

  it('rejects disabled providers even for an already pinned callback', async () => {
    await t.db.updateTable('auth_identity_providers')
      .set({ lifecycle_status: 'DISABLED' }).where('id', '=', providerId).execute();
    expect(await registry.listLoginOptions()).toEqual([]);
    expect(await registry.getForCallback('entra', versionId)).toBeUndefined();
  });
});
