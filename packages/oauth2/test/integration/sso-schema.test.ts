import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { startTestDb, type TestDb } from '../support/db';

describe('dynamic SSO schema migration', () => {
  let t: TestDb;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await t?.stop(); });

  const provider = (code: string) => t.db.insertInto('auth_identity_providers')
    .values({ code, display_name: code, description: null, active_version_id: null,
      draft_version_id: null, created_by: null, updated_by: null, archived_at: null })
    .returning('id').executeTakeFirstOrThrow();

  it('starts with SSO disabled and one global policy row', async () => {
    const rows = await t.db.selectFrom('auth_login_policy').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, sso_login_enabled: false });
    await expect(t.db.insertInto('auth_login_policy')
      .values({ id: 2, updated_by: null }).execute()).rejects.toThrow();
  });

  it('enforces provider code uniqueness and lifecycle status', async () => {
    await provider('microsoft');
    await expect(provider('microsoft')).rejects.toThrow();
    await expect(t.db.insertInto('auth_identity_providers')
      .values({ code: 'bad', display_name: 'Bad', lifecycle_status: 'INVALID' as any,
        description: null, active_version_id: null, draft_version_id: null,
        created_by: null, updated_by: null, archived_at: null }).execute()).rejects.toThrow();
  });

  it('rejects a version pointer belonging to another provider', async () => {
    const first = await provider('first');
    const second = await provider('second');
    const version = await t.db.insertInto('auth_identity_provider_versions').values({
      provider_id: first.id, version_no: 1, config_fingerprint: 'fingerprint',
      config_public: {}, client_secret_enc: null, tested_fingerprint: null,
      tested_at: null, published_at: null, source_version_id: null,
      created_by: null, published_by: null,
    }).returning('id').executeTakeFirstOrThrow();
    await expect(t.db.updateTable('auth_identity_providers')
      .set({ active_version_id: version.id }).where('id', '=', second.id).execute()).rejects.toThrow();
    await t.db.updateTable('auth_identity_providers')
      .set({ active_version_id: version.id }).where('id', '=', first.id).execute();
    await expect(t.db.insertInto('auth_identity_provider_versions').values({
      provider_id: first.id, version_no: 1, config_fingerprint: 'other',
      config_public: {}, client_secret_enc: null, tested_fingerprint: null,
      tested_at: null, published_at: null, source_version_id: null,
      created_by: null, published_by: null,
    }).execute()).rejects.toThrow();
  });

  it('allows only one active block for a provider and subject', async () => {
    await provider('keycloak');
    const value = { provider_code: 'keycloak', subject_hash: 'digest',
      reason: 'security', blocked_by: null, unblocked_by: null, unblocked_at: null };
    const first = await t.db.insertInto('auth_identity_blocks')
      .values(value).returning('id').executeTakeFirstOrThrow();
    await expect(t.db.insertInto('auth_identity_blocks').values(value).execute()).rejects.toThrow();
    await t.db.updateTable('auth_identity_blocks').set({ unblocked_at: new Date() })
      .where('id', '=', first.id).execute();
    await t.db.insertInto('auth_identity_blocks').values(value).execute();
  });

  it('preserves the existing identity schema', async () => {
    const { rows } = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_name = 'auth_user_identities' and column_name in ('provider','subject')
    `.execute(t.db);
    expect(rows.map((r) => r.column_name).sort()).toEqual(['provider', 'subject']);
  });
});
