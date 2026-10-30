import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/audit/audit.service';
import type { OAuth2Config } from '../../src/config/schema';
import { AuthProvenanceService } from '../../src/sso-management/auth-provenance.service';
import { IdentityBlockService } from '../../src/sso-management/identity-block.service';
import { startTestDb, type TestDb } from '../support/db';

describe('targeted SSO identity block and tombstone', () => {
  let t: TestDb;
  let service: IdentityBlockService;
  let provenance: AuthProvenanceService;
  let providerId: string;
  let userId: string;
  const actorId = '00000000-0000-0000-0000-000000000001';

  async function session(id: string, origin: 'local' | 'oidc', subject?: string): Promise<void> {
    const now = new Date();
    await t.db.insertInto('auth_sessions').values({
      id_hash: id, user_id: userId, access_token_enc: null, refresh_token_enc: null,
      id_token_enc: null, access_expires_at: null,
      idle_expires_at: new Date(now.getTime() + 60_000),
      absolute_expires_at: new Date(now.getTime() + 120_000),
      created_at: now, last_seen_at: now, ip: null, user_agent: null,
      refresh_lease_until: null, auth_method: origin,
      origin_provider_code: origin === 'oidc' ? 'entra' : null,
      origin_subject_hash: origin === 'oidc' ? provenance.subjectHash('entra', subject!) : null,
      origin_provider_version_id: origin === 'oidc' ? providerId : null,
      step_up_verified_at: null,
    }).execute();
  }

  beforeAll(async () => {
    t = await startTestDb();
    const audit = new AuditService(t.db);
    provenance = new AuthProvenanceService(t.db, { secret: randomBytes(32) } as OAuth2Config);
    service = new IdentityBlockService(t.db, provenance, audit);
    const provider = await t.db.insertInto('auth_identity_providers').values({
      code: 'entra', display_name: 'Entra', description: null,
      active_version_id: null, draft_version_id: null, created_by: null,
      updated_by: null, archived_at: null,
    }).returning('id').executeTakeFirstOrThrow();
    providerId = provider.id;
    const user = await t.db.insertInto('auth_users').values({
      email: 'blocked@x.com', name: 'Blocked',
    }).returning('id').executeTakeFirstOrThrow();
    userId = user.id;
    await session('blocked-session', 'oidc', 'sub-block');
    await session('other-identity', 'oidc', 'sub-other');
    await session('local-session', 'local');
  });
  afterAll(async () => { await t?.stop(); });

  it('deletes only sessions from the blocked provider/subject; local and other SSO survive', async () => {
    const revoked = await service.block({
      providerCode: 'entra', subject: 'sub-block', reason: 'Compromised identity', actorId,
    });
    expect(revoked).toBe(1);
    const remaining = await t.db.selectFrom('auth_sessions').select('id_hash')
      .orderBy('id_hash').execute();
    expect(remaining.map((s) => s.id_hash)).toEqual(['local-session', 'other-identity']);
    await expect(service.assertAllowed('entra', 'sub-block')).rejects.toThrow();
    await expect(service.assertAllowed('entra', 'sub-other')).resolves.toBeUndefined();
  });

  it('keeps a durable blocked tombstone until an explicit unblock', async () => {
    const blocks = await t.db.selectFrom('auth_identity_blocks').selectAll().execute();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].subject_hash).not.toContain('sub-block');
    await service.unblock({ providerCode: 'entra', subject: 'sub-block', actorId });
    await expect(service.assertAllowed('entra', 'sub-block')).resolves.toBeUndefined();
    const retained = await t.db.selectFrom('auth_identity_blocks').selectAll().execute();
    expect(retained).toHaveLength(1);
    expect(retained[0].unblocked_at).not.toBeNull();
    const events = await t.db.selectFrom('auth_audit_events')
      .select('type').where('type', 'in', ['sso.identity.block', 'sso.identity.unblock']).execute();
    expect(events.map((v) => v.type).sort()).toEqual(['sso.identity.block', 'sso.identity.unblock']);
  });
});
