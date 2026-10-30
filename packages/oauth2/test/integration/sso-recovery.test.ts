import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OAuth2Config } from '../../src/config/schema';
import { ConflictException } from '@nestjs/common';
import { AuditService } from '../../src/audit/audit.service';
import { ProviderRecoveryService } from '../../src/sso-management/provider-recovery.service';
import { startTestDb, type TestDb } from '../support/db';

describe('SSO provider recovery', () => {
  let t: TestDb;
  let service: ProviderRecoveryService;
  let providerId: string;
  let sourceId: string;
  const actor = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    t = await startTestDb();
    service = new ProviderRecoveryService(t.db, { secret: randomBytes(32) } as OAuth2Config, new AuditService(t.db));
    const p = await t.db.insertInto('auth_identity_providers').values({
      code: 'keycloak', display_name: 'Keycloak', description: null,
      active_version_id: null, draft_version_id: null,
      created_by: null, updated_by: null, archived_at: null,
    }).returning('id').executeTakeFirstOrThrow();
    providerId = p.id;
    const v = await t.db.insertInto('auth_identity_provider_versions').values({
      provider_id: providerId, version_no: 1, state: 'PUBLISHED',
      config_public: { issuer: 'https://idp.example.org', clientId: 'cms' },
      client_secret_enc: 'sealed-original', config_fingerprint: 'original',
      tested_fingerprint: 'original', tested_at: new Date(), published_at: new Date(),
      source_version_id: null, created_by: null, published_by: null,
    }).returning('id').executeTakeFirstOrThrow();
    sourceId = v.id;
    await t.db.updateTable('auth_identity_providers')
      .set({ active_version_id: sourceId, lifecycle_status: 'ACTIVE' })
      .where('id', '=', providerId).execute();
  });
  afterAll(async () => { await t?.stop(); });

  it('copies a published version into an untested draft without changing active version', async () => {
    const created = await service.createFromVersion(providerId, sourceId, actor);
    expect(created.versionNo).toBe(2);
    const provider = await t.db.selectFrom('auth_identity_providers')
      .select(['active_version_id', 'draft_version_id']).where('id', '=', providerId)
      .executeTakeFirstOrThrow();
    expect(provider.active_version_id).toBe(sourceId);
    expect(provider.draft_version_id).toBe(created.draftId);
    const draft = await t.db.selectFrom('auth_identity_provider_versions')
      .selectAll().where('id', '=', created.draftId).executeTakeFirstOrThrow();
    expect(draft.state).toBe('DRAFT');
    expect(draft.tested_fingerprint).toBeNull();
    expect(draft.source_version_id).toBe(sourceId);
    expect(draft.client_secret_enc).toBe('sealed-original');
    const original = await t.db.selectFrom('auth_identity_provider_versions')
      .select('state').where('id', '=', sourceId).executeTakeFirstOrThrow();
    expect(original.state).toBe('PUBLISHED');
  });

  it('does not overwrite an existing draft', async () => {
    await expect(service.createFromVersion(providerId, sourceId, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
