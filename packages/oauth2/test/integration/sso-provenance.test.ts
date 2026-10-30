import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ADMIN_CLIENT_ID } from '../../src/constants';
import type { OAuth2Config } from '../../src/config/schema';
import { AuthProvenanceService, challengeFromVerifier } from '../../src/sso-management/auth-provenance.service';
import { startTestDb, type TestDb } from '../support/db';

describe('PKCE-bound authentication provenance', () => {
  let t: TestDb;
  let provenance: AuthProvenanceService;
  let userId: string;
  const verifier = randomBytes(32).toString('base64url');
  const secondVerifier = randomBytes(32).toString('base64url');
  const interaction = (v: string) => ({
    params: {
      client_id: ADMIN_CLIENT_ID, code_challenge_method: 'S256',
      code_challenge: challengeFromVerifier(v),
    },
  });

  beforeAll(async () => {
    t = await startTestDb();
    provenance = new AuthProvenanceService(t.db, { secret: randomBytes(32) } as OAuth2Config);
    const user = await t.db.insertInto('auth_users')
      .values({ email: 'pkce@example.com', name: 'PKCE tester', password_hash: null,
        last_login_at: null, locale: null, created_at: new Date(), updated_at: new Date() })
      .returning('id').executeTakeFirstOrThrow();
    userId = user.id;
  });
  afterAll(async () => { await t?.stop(); });

  it('rejects browser-supplied or missing internal PKCE context', async () => {
    await expect(provenance.bindInteraction({ params: { code_challenge: challengeFromVerifier(verifier) } },
      userId, { method: 'local' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves local provenance and consumes it exactly once', async () => {
    await provenance.bindInteraction(interaction(verifier), userId, { method: 'local' });
    await expect(provenance.consumeForBff(secondVerifier, userId)).rejects.toBeInstanceOf(ConflictException);
    expect(await provenance.consumeForBff(verifier, userId)).toEqual({ method: 'local' });
    await expect(provenance.consumeForBff(verifier, userId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists only HMAC subject identifiers for external logins', async () => {
    await provenance.bindInteraction(interaction(secondVerifier), userId, {
      method: 'oidc', providerCode: 'entra', externalSubject: 'private-subject-123',
      providerVersionId: '00000000-0000-0000-0000-000000000123',
    });
    const stored = await t.db.selectFrom('auth_sso_auth_contexts')
      .selectAll().executeTakeFirstOrThrow();
    expect(stored.subject_hash).not.toContain('private-subject-123');
    const result = await provenance.consumeForBff(secondVerifier, userId);
    expect(result).toMatchObject({
      method: 'oidc', providerCode: 'entra',
      providerVersionId: '00000000-0000-0000-0000-000000000123',
    });
  });

  it('rejects expired contexts even if their PKCE proof is valid', async () => {
    const thirdVerifier = randomBytes(32).toString('base64url');
    await provenance.bindInteraction(interaction(thirdVerifier), userId, { method: 'local' });
    await t.db.updateTable('auth_sso_auth_contexts')
      .set({ expires_at: new Date(Date.now() - 1000) }).execute();
    await expect(provenance.consumeForBff(thirdVerifier, userId)).rejects.toBeInstanceOf(ConflictException);
  });
});
