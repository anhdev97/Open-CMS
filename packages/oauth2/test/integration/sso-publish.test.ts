import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AuditService } from '../../src/audit/audit.service';
import type { OAuth2Config } from '../../src/config/schema';
import { ProviderConfigService } from '../../src/sso-management/provider-config.service';
import { startTestDb, type TestDb } from '../support/db';

describe('SSO publish security gate', () => {
  let t: TestDb;
  let service: ProviderConfigService;
  let providerId: string;
  let draftId: string;
  let fingerprint: string;
  const actor = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    t = await startTestDb();
    service = new ProviderConfigService(t.db, { secret: randomBytes(32) } as OAuth2Config, new AuditService(t.db));
    const created = await service.createDraft({
      code: 'keycloak', displayName: 'Keycloak',
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      clientId: 'cms', clientSecret: 'private-value',
    }, actor);
    providerId = created.providerId;
    draftId = created.draftId;
    const draft = await t.db.selectFrom('auth_identity_provider_versions')
      .select('config_fingerprint').where('id', '=', draftId).executeTakeFirstOrThrow();
    fingerprint = draft.config_fingerprint;
  });
  afterAll(async () => { await t?.stop(); });

  it('rejects publishing an untested draft', async () => {
    await expect(service.publish(providerId, fingerprint, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects stale or mismatched test fingerprints', async () => {
    await t.db.updateTable('auth_identity_provider_versions')
      .set({ state: 'TESTED', tested_fingerprint: 'old-fingerprint' })
      .where('id', '=', draftId).execute();
    await expect(service.publish(providerId, fingerprint, actor)).rejects.toBeInstanceOf(ConflictException);
    await t.db.updateTable('auth_identity_provider_versions')
      .set({ tested_fingerprint: fingerprint })
      .where('id', '=', draftId).execute();
    await expect(service.publish(providerId, 'stale-client-value', actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('atomically publishes the verified draft and refuses replay', async () => {
    expect(await service.publish(providerId, fingerprint, actor)).toBe(draftId);
    const provider = await t.db.selectFrom('auth_identity_providers')
      .select(['lifecycle_status', 'active_version_id', 'draft_version_id'])
      .where('id', '=', providerId).executeTakeFirstOrThrow();
    expect(provider).toMatchObject({
      lifecycle_status: 'ACTIVE', active_version_id: draftId, draft_version_id: null,
    });
    await expect(service.publish(providerId, fingerprint, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
