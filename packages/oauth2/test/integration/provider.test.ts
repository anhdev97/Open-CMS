import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadConfig, type OAuth2Config } from '../../src/config/schema';
import { ADMIN_CLIENT_ID, GRANT_REVOKER, OAUTH2_CONFIG } from '../../src/constants';
import { ConfigError } from '../../src/errors';
import { deriveKey } from '../../src/security/crypto';
import { createKyselyAdapter } from '../../src/provider/kysely.adapter';
import { adminClientSecret } from '../../src/provider/provider.factory';
import { ensureSigningKey } from '../../src/provider/signing-keys';
import type { GrantRevoker } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { startTestDb } from '../support/db';

describe('oidc provider mounted at /oauth2', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('serves discovery with issuer = publicUrl/oauth2 and only S256 PKCE', async () => {
    const res = await fetch(`${t.url}/oauth2/.well-known/openid-configuration`);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Record<string, unknown>;
    expect(d.issuer).toBe(`${t.url}/oauth2`);
    expect(d.code_challenge_methods_supported).toEqual(['S256']);
    expect(d.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
    expect(d.scopes_supported).toEqual(expect.arrayContaining(['openid', 'profile', 'email', 'offline_access']));
    expect(d.id_token_signing_alg_values_supported).toContain('ES256');
    expect(d.revocation_endpoint).toBe(`${t.url}/oauth2/token/revocation`);
    expect(d.end_session_endpoint).toBe(`${t.url}/oauth2/session/end`);
  });

  it('publishes exactly one ES256 signing key from auth_signing_keys', async () => {
    const res = await fetch(`${t.url}/oauth2/jwks`);
    const { keys } = (await res.json()) as { keys: Array<Record<string, unknown>> };
    const rows = await t.db.selectFrom('auth_signing_keys').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].alg).toBe('ES256');
    expect(rows[0].jwk_private_enc).not.toContain('"d"');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kid: rows[0].kid, alg: 'ES256', kty: 'EC', crv: 'P-256' });
    expect(keys[0].d).toBeUndefined();
  });

  it('upserts the opencms-admin client and authenticates it with client_secret_basic', async () => {
    const row = await t.db.selectFrom('auth_oauth_clients').selectAll().where('client_id', '=', ADMIN_CLIENT_ID).executeTakeFirstOrThrow();
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.redirect_uris).toEqual([`${t.url}/api/auth/callback`]);
    expect(meta.post_logout_redirect_uris).toEqual([`${t.url}/admin/login`]);
    expect(meta.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(meta.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(meta).not.toHaveProperty('client_secret');

    const secret = adminClientSecret(t.app.get<OAuth2Config>(OAUTH2_CONFIG));
    const ok = await fetch(`${t.url}/oauth2/token/revocation`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${ADMIN_CLIENT_ID}:${secret}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'token=does-not-exist',
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${t.url}/oauth2/token/revocation`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${ADMIN_CLIENT_ID}:wrong`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'token=x',
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('renders authorization errors as JSON without a stack', async () => {
    const res = await fetch(`${t.url}/oauth2/auth?client_id=nope&response_type=code&scope=openid`, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_client');
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\.js/);
  });

  it('GrantRevoker removes only the given user\'s Grants, their tokens and Sessions', async () => {
    const A = createKyselyAdapter(t.db);
    const grants = new A('Grant');
    const access = new A('AccessToken');
    const u = '11111111-1111-1111-1111-111111111111';
    const other = '22222222-2222-2222-2222-222222222222';
    await grants.upsert('g-u1', { accountId: u, clientId: ADMIN_CLIENT_ID }, 600);
    await grants.upsert('g-u2', { accountId: u, clientId: ADMIN_CLIENT_ID }, 600);
    await grants.upsert('g-o', { accountId: other, clientId: ADMIN_CLIENT_ID }, 600);
    await access.upsert('at-u1', { accountId: u, grantId: 'g-u1' }, 600);
    await access.upsert('at-o', { accountId: other, grantId: 'g-o' }, 600);
    const sessions = new A('Session');
    await sessions.upsert('s-u', { accountId: u, uid: 'uid-u' }, 600);
    await sessions.upsert('s-o', { accountId: other, uid: 'uid-o' }, 600);

    await t.app.get<GrantRevoker>(GRANT_REVOKER).revokeAllGrants(u);

    const left = await t.db.selectFrom('auth_oidc_payloads').select(['kind', 'id']).orderBy('id').execute();
    expect(left).toEqual([
      { kind: 'AccessToken', id: 'at-o' },
      { kind: 'Grant', id: 'g-o' },
      { kind: 'Session', id: 's-o' },
    ]);
  });
});

describe('provider boot', () => {
  it('second boot on the same database does not create another signing key', async () => {
    const ctx = await startTestDb();
    try {
      const env = { OPENCMS_SECRET: randomBytes(32).toString('hex') };
      const a = await createTestApp(env, { db: ctx });
      const kid1 = (await ctx.db.selectFrom('auth_signing_keys').select('kid').execute()).map((r) => r.kid);
      await a.close();
      const b = await createTestApp(env, { db: ctx });
      const res = await fetch(`${b.url}/oauth2/jwks`);
      const { keys } = (await res.json()) as { keys: Array<{ kid: string }> };
      await b.close();
      const kid2 = (await ctx.db.selectFrom('auth_signing_keys').select('kid').execute()).map((r) => r.kid);
      expect(kid1).toHaveLength(1);
      expect(kid2).toEqual(kid1);
      expect(keys.map((k) => k.kid)).toEqual(kid1);

      const key = deriveKey(Buffer.from(env.OPENCMS_SECRET, 'hex'), 'key');
      const jwks = await ensureSigningKey(ctx.db, key);
      expect(jwks.map((j) => j.kid)).toEqual(kid1);
      expect(jwks[0].d).toBeTypeOf('string');
      expect(await ctx.db.selectFrom('auth_signing_keys').select('kid').execute()).toHaveLength(1);
    } finally {
      await ctx.stop();
    }
  });

  it('stored signing keys sealed with another OPENCMS_SECRET → ConfigError naming the secret and the remedy', async () => {
    const ctx = await startTestDb();
    try {
      await ensureSigningKey(ctx.db, deriveKey(Buffer.alloc(32, 1), 'key'));
      const err = await ensureSigningKey(ctx.db, deriveKey(Buffer.alloc(32, 2), 'key')).catch((e) => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toMatch(/OPENCMS_SECRET/);
      expect(err.message).toMatch(/auth_signing_keys/);
      expect(err.message).toMatch(/auth_sessions/);
    } finally {
      await ctx.stop();
    }
  });

  it('refuses to start without OPENCMS_SECRET', async () => {
    await expect(createTestApp({ OPENCMS_SECRET: '' })).rejects.toThrow(/OPENCMS_SECRET/);
  });

  it('derives a stable admin client secret from OPENCMS_SECRET', () => {
    const cfg = loadConfig({ OPENCMS_SECRET: Buffer.alloc(32, 1).toString('hex'), OPENCMS_PUBLIC_URL: 'http://x.test' });
    const s = adminClientSecret(cfg);
    expect(s).toBe(deriveKey(cfg.secret, 'client-secret').toString('base64url'));
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
