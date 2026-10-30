import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { OAuth2Config } from '../../src/config/schema';
import { ProviderConfigService } from '../../src/sso-management/provider-config.service';
import { startTestDb, type TestDb } from '../support/db';

describe('SSO provider draft management', () => {
  let t: TestDb;
  let service: ProviderConfigService;
  let providerId: string;
  let draftId: string;
  const actor = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    t = await startTestDb();
    service = new ProviderConfigService(t.db, { secret: randomBytes(32) } as OAuth2Config);
  });
  afterAll(async () => { await t?.stop(); });

  it('creates an encrypted draft without activating SSO', async () => {
    const created = await service.createDraft({
      code: 'entra', displayName: 'Microsoft Entra',
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      clientId: 'cms-admin', clientSecret: 'private-value',
    }, actor);
    providerId = created.providerId;
    draftId = created.draftId;
    const provider = await t.db.selectFrom('auth_identity_providers')
      .selectAll().where('id', '=', providerId).executeTakeFirstOrThrow();
    expect(provider.lifecycle_status).toBe('DRAFT');
    expect(provider.active_version_id).toBeNull();
    expect(provider.draft_version_id).toBe(draftId);
    const draft = await t.db.selectFrom('auth_identity_provider_versions')
      .selectAll().where('id', '=', draftId).executeTakeFirstOrThrow();
    expect(draft.client_secret_enc).not.toContain('private-value');
    expect(draft.state).toBe('DRAFT');
    expect(draft.tested_fingerprint).toBeNull();
  });

  it('never exposes encrypted secrets or fingerprints in the admin read model', async () => {
    const providers = await service.listProviders();
    const provider = providers.find((p) => p.id === providerId);
    expect(provider).toMatchObject({
      code: 'entra', lifecycle: 'DRAFT', hasDraftSecret: true, draftState: 'DRAFT',
    });
    const serialized = JSON.stringify(providers);
    expect(serialized).not.toContain('client_secret_enc');
    expect(serialized).not.toContain('config_fingerprint');
    expect(serialized).not.toContain('private-value');
  });

  it('invalidates a test result after editing and rejects stale edits', async () => {
    const before = await t.db.selectFrom('auth_identity_provider_versions')
      .selectAll().where('id', '=', draftId).executeTakeFirstOrThrow();
    await t.db.updateTable('auth_identity_provider_versions')
      .set({ state: 'TESTED', tested_fingerprint: before.config_fingerprint })
      .where('id', '=', draftId).execute();
    await service.updateDraft(providerId, { clientId: 'cms-admin-v2' }, before.updated_at, actor);
    const after = await t.db.selectFrom('auth_identity_provider_versions')
      .selectAll().where('id', '=', draftId).executeTakeFirstOrThrow();
    expect(after.state).toBe('DRAFT');
    expect(after.tested_fingerprint).toBeNull();
    expect(after.config_public.clientId).toBe('cms-admin-v2');
    await expect(service.updateDraft(providerId, { clientId: 'stale' }, before.updated_at, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid private-network issuer', async () => {
    await expect(service.createDraft({
      code: 'unsafe', displayName: 'Unsafe',
      issuer: 'https://127.0.0.1', clientId: 'cms', clientSecret: 'private',
    }, actor)).rejects.toThrow();
  });

  it('does not allow archiving a provider without disabling it first', async () => {
    await expect(service.archive(providerId, actor)).resolves.toBeUndefined();
    const provider = await t.db.selectFrom('auth_identity_providers')
      .select('lifecycle_status').where('id', '=', providerId).executeTakeFirstOrThrow();
    expect(provider.lifecycle_status).toBe('ARCHIVED');
  });
});
