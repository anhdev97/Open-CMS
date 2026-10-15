import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OidcClient } from '../../src/bff/oidc-client';
import { SessionStore } from '../../src/bff/session.store';
import { deriveKey, open, seal, sha256 } from '../../src/security/crypto';
import { UserService } from '../../src/users/user.service';
import { OAUTH2_CONFIG } from '../../src/constants';
import { createTestApp, type TestApp } from '../support/app';
import { CookieJar } from '../support/interaction';
import { loginAs, type LoginResult } from '../support/login';

const PW = 'correct horse battery';
const DAY = 86400;
// Each login consumes the per-email budget; this file logs in many times.
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };

const cookieLine = (lines: string[], name: string) => lines.find((l) => l.startsWith(`${name}=`));
const attrs = (line: string) => line.split(';').slice(1).map((a) => a.trim().toLowerCase());

/**
 * Asserts that nothing the browser received in the chain carries a token: neither the token key names nor
 * (the first 20 chars of) any of the token values actually issued for the session.
 */
function expectNoTokens(r: LoginResult, tokens: (string | undefined)[]): void {
  const values = tokens.filter((v): v is string => !!v);
  expect(values.length).toBeGreaterThan(0);
  for (const res of r.responses) {
    const all = [res.body, JSON.stringify(res.headers), res.setCookies.join('\n')].join('\n');
    for (const needle of ['access_token', 'refresh_token', 'id_token', ...values.map((v) => v.slice(0, 20))]) {
      expect(all, `${res.method} ${res.url} leaked a token`).not.toContain(needle);
    }
  }
}

describe('BFF login and callback', () => {
  let t: TestApp;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestApp({}, { auth });
    adminId = (await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW })).id;
  });
  afterAll(async () => {
    await t?.close();
  });

  const sessions = () => t.db.selectFrom('auth_sessions').selectAll().execute();

  it('GET /api/auth/login → 302 to the provider authorize URL with a sealed oc_login cookie', async () => {
    const res = await fetch(`${t.url}/api/auth/login?returnTo=/admin/x&login_hint=admin@x.com`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${t.url}/oauth2/auth`);
    const p = loc.searchParams;
    expect(p.get('client_id')).toBe('opencms-admin');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('redirect_uri')).toBe(`${t.url}/api/auth/callback`);
    expect(p.get('scope')).toBe('openid profile email offline_access');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')).toBeTruthy();
    expect(p.get('nonce')).toBeTruthy();
    expect(p.get('login_hint')).toBe('admin@x.com');
    // C1: every BFF login runs the interaction; a surviving provider session never re-authenticates.
    expect(p.get('prompt')).toBe('login');

    const line = cookieLine(res.headers.getSetCookie(), 'oc_login')!;
    expect(line).toBeTruthy();
    const a = attrs(line);
    expect(a).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/api/auth', 'max-age=600']));
    expect(a).not.toContain('secure');
    const value = line.split(';')[0].slice('oc_login='.length);
    // Sealed: neither state nor the return path are readable from the cookie.
    expect(value).not.toContain(p.get('state')!);
    expect(Buffer.from(value, 'base64url').toString('latin1')).not.toContain('/admin/x');
  });

  it('full chain → 302 returnTo with oc_session, oc_login cleared, encrypted session row, no tokens to the browser', async () => {
    const before = await t.db.selectFrom('auth_users').select('last_login_at').where('id', '=', adminId).executeTakeFirstOrThrow();
    expect(before.last_login_at).toBeNull();

    const r = await loginAs(t, 'admin@x.com', PW, { returnTo: '/admin/x' });
    expect(r.finalLocation).toBe('/admin/x');
    const session = cookieLine(r.callbackSetCookies, 'oc_session')!;
    expect(session).toBeTruthy();
    expect(attrs(session)).toEqual(
      expect.arrayContaining(['httponly', 'samesite=lax', 'path=/', `max-age=${30 * DAY}`]),
    );
    expect(attrs(session)).not.toContain('secure');
    expect(Buffer.from(r.sessionCookie!, 'base64url')).toHaveLength(32);
    const clear = cookieLine(r.callbackSetCookies, 'oc_login')!;
    expect(clear).toBeTruthy();
    expect(attrs(clear)).toEqual(expect.arrayContaining(['path=/api/auth', 'max-age=0']));
    const store = t.app.get(SessionStore);
    const got = await store.get(r.sessionCookie!);
    expect(got).toMatchObject({ userId: adminId });
    expectNoTokens(r, [got!.accessToken, got!.refreshToken, got!.idToken]);

    const rows = await sessions();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id_hash).toBe(sha256(r.sessionCookie!));
    expect(row.user_id).toBe(adminId);
    expect(row.access_token_enc).toBeTruthy();
    expect(row.refresh_token_enc).toBeTruthy();
    expect(row.id_token_enc).toBeTruthy();
    // Sealed at rest: no column holds its plaintext, and opening it with the token key yields the issued token.
    const tokenKey = deriveKey(t.app.get(OAUTH2_CONFIG).secret, 'token');
    const issued = [got!.accessToken, got!.refreshToken!, got!.idToken];
    [row.access_token_enc, row.refresh_token_enc, row.id_token_enc].forEach((col, i) => {
      expect(col).not.toBe(issued[i]);
      expect(col).not.toContain(issued[i].slice(0, 20));
      expect(open(tokenKey, col!)).toBe(issued[i]);
    });
    expect(row.user_agent).toBe('vitest-bff');
    expect(row.ip).toBeTruthy();
    const now = Date.now();
    const at = (d: Date | string | null) => new Date(d as Date).getTime();
    expect(at(row.access_expires_at)).toBeGreaterThan(now + 800_000);
    expect(at(row.access_expires_at)).toBeLessThanOrEqual(now + 900_000 + 5_000);
    expect(Math.abs(at(row.idle_expires_at) - (now + 7 * DAY * 1000))).toBeLessThan(60_000);
    expect(Math.abs(at(row.absolute_expires_at) - (now + 30 * DAY * 1000))).toBeLessThan(60_000);

    const after = await t.db.selectFrom('auth_users').select('last_login_at').where('id', '=', adminId).executeTakeFirstOrThrow();
    expect(after.last_login_at).not.toBeNull();

    // The store opens what it sealed.
    expect(got).toMatchObject({ idHash: row.id_hash, userId: adminId });
    expect(got!.idToken.split('.')).toHaveLength(3); // a JWS
    expect(got!.accessToken).toBeTruthy();
    expect(got!.refreshToken).toBeTruthy();
    expect(await store.get('not-a-session')).toBeUndefined();
  });

  it('returnTo=//evil.com → ends at /admin', async () => {
    const r = await loginAs(t, 'admin@x.com', PW, { returnTo: '//evil.com' });
    expect(r.finalLocation).toBe('/admin');
    expect(r.sessionCookie).toBeTruthy();
  });

  it('tampered state → 302 /admin/login?error=invalid_state, no session', async () => {
    const before = (await sessions()).length;
    const r = await loginAs(t, 'admin@x.com', PW, {
      beforeCallback: (u) => u.searchParams.set('state', 'tampered'),
    });
    expect(r.finalLocation).toBe('/admin/login?error=invalid_state');
    expect(r.sessionCookie).toBeUndefined();
    expect(await sessions()).toHaveLength(before);
  });

  it('callback without oc_login, or with an undecryptable one → invalid_state', async () => {
    const bare = await fetch(`${t.url}/api/auth/callback?code=x&state=y`, { redirect: 'manual' });
    expect(bare.status).toBe(302);
    expect(bare.headers.get('location')).toBe('/admin/login?error=invalid_state');
    const forged = await fetch(`${t.url}/api/auth/callback?code=x&state=y`, {
      redirect: 'manual',
      headers: { cookie: 'oc_login=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(forged.headers.get('location')).toBe('/admin/login?error=invalid_state');
  });

  it('provider error param → /admin/login?error=<code>; odd codes become login_failed', async () => {
    const start = async () => {
      const jar = new CookieJar();
      const res = await jar.fetch(`${t.url}/api/auth/login`);
      const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
      return { jar, state };
    };
    const a = await start();
    const denied = await a.jar.fetch(`${t.url}/api/auth/callback?error=access_denied&state=${a.state}`);
    expect(denied.headers.get('location')).toBe('/admin/login?error=access_denied');
    const b = await start();
    const odd = await b.jar.fetch(`${t.url}/api/auth/callback?error=${encodeURIComponent('<x>')}&state=${b.state}`);
    expect(odd.headers.get('location')).toBe('/admin/login?error=login_failed');
  });

  it('code exchange failure → /admin/login?error=login_failed', async () => {
    const r = await loginAs(t, 'admin@x.com', PW, { beforeCallback: (u) => u.searchParams.set('code', 'bogus') });
    expect(r.finalLocation).toBe('/admin/login?error=login_failed');
    expect(r.sessionCookie).toBeUndefined();
  });

  it('session creation failure after a valid exchange → login_failed, no oc_session', async () => {
    const spy = vi.spyOn(t.app.get(SessionStore), 'create').mockRejectedValueOnce(new Error('db down'));
    try {
      const r = await loginAs(t, 'admin@x.com', PW);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(r.finalLocation).toBe('/admin/login?error=login_failed');
      expect(r.sessionCookie).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('a session sealed with another OPENCMS_SECRET → 401 (not 500) and the row is deleted', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    const other = deriveKey(Buffer.alloc(32, 7), 'token');
    await t.db
      .updateTable('auth_sessions')
      .set({ access_token_enc: seal(other, 'a'), refresh_token_enc: seal(other, 'r'), id_token_enc: seal(other, 'i') })
      .where('id_hash', '=', sha256(r.sessionCookie!))
      .execute();
    const me = await fetch(`${t.url}/api/auth/me`, { headers: { cookie: `oc_session=${r.sessionCookie}` } });
    expect(me.status).toBe(401);
    const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(r.sessionCookie!)).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('SessionStore.touch extends idle at most once per 60 s and never past absolute', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    const store = t.app.get(SessionStore);
    const idHash = sha256(r.sessionCookie!);
    const read = () => t.db.selectFrom('auth_sessions').selectAll().where('id_hash', '=', idHash).executeTakeFirstOrThrow();
    const r0 = await read();
    const seen0 = new Date(r0.last_seen_at as Date).getTime();

    await store.touch(idHash, new Date(seen0 + 30_000));
    expect(new Date((await read()).last_seen_at as Date).getTime()).toBe(seen0);

    const t1 = new Date(seen0 + 120_000);
    await store.touch(idHash, t1);
    const r1 = await read();
    expect(new Date(r1.last_seen_at as Date).getTime()).toBe(t1.getTime());
    expect(new Date(r1.idle_expires_at).getTime()).toBe(t1.getTime() + 7 * DAY * 1000);

    const absolute = new Date(r1.absolute_expires_at).getTime();
    const late = new Date(absolute - DAY * 1000);
    await store.touch(idHash, late);
    expect(new Date((await read()).idle_expires_at).getTime()).toBe(absolute);
  });

  it('SessionStore.claimRefresh/completeRefresh/releaseRefresh/delete', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    const store = t.app.get(SessionStore);
    const idHash = sha256(r.sessionCookie!);
    const lease = async () =>
      (await t.db.selectFrom('auth_sessions').select('refresh_lease_until').where('id_hash', '=', idHash).executeTakeFirstOrThrow())
        .refresh_lease_until;

    const won = await store.claimRefresh(idHash);
    expect(won?.userId).toBe(adminId);
    const until = new Date((await lease()) as Date).getTime();
    expect(until).toBeGreaterThan(Date.now() + 8_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 11_000);
    expect(await store.claimRefresh(idHash)).toBeUndefined(); // lease held
    await store.completeRefresh(idHash, { accessToken: 'new-access', expiresIn: 60 });
    expect(await lease()).toBeNull();
    const got = (await store.get(r.sessionCookie!))!;
    expect(got.accessToken).toBe('new-access');
    expect(got.refreshToken).toBeTruthy(); // kept when the response has none
    expect(got.accessExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);

    expect(await store.claimRefresh(idHash)).toBeTruthy();
    await store.releaseRefresh(idHash);
    expect(await lease()).toBeNull();
    // An expired lease can be taken over.
    await t.db.updateTable('auth_sessions').set({ refresh_lease_until: new Date(Date.now() - 1000) }).where('id_hash', '=', idHash).execute();
    expect(await store.claimRefresh(idHash)).toBeTruthy();

    expect(await store.claimRefresh('missing')).toBeUndefined();
    await store.delete(idHash);
    expect(await store.get(r.sessionCookie!)).toBeUndefined();
  });

  it('R13: refresh tokens survive the provider Session; revoke kills them', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    const store = t.app.get(SessionStore);
    const client = t.app.get(OidcClient);
    const { refreshToken } = (await store.get(r.sessionCookie!))!;
    await t.db.deleteFrom('auth_oidc_payloads').where('kind', '=', 'Session').execute();
    const next = await client.refresh(refreshToken!);
    expect(next.accessToken).toBeTruthy();
    expect(next.refreshToken).toBeTruthy();
    expect(next.refreshToken).not.toBe(refreshToken); // rotated
    await client.revoke(next.refreshToken!);
    await expect(client.refresh(next.refreshToken!)).rejects.toThrow();
  });
});

describe('BFF behind a TLS reverse proxy (Review Focus 5)', () => {
  let t: TestApp;

  beforeAll(async () => {
    // the internal URL defaults to the app's real address via PORT (R7); publicUrl is unreachable from inside.
    t = await createTestApp({ OPENCMS_PUBLIC_URL: 'https://cms.test' }, { auth });
    await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('exchanges the code via internalUrl; oc_login and oc_session carry Secure', async () => {
    expect(t.url).toBe('https://cms.test');
    expect(t.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const r = await loginAs(t, 'admin@x.com', PW, { returnTo: '/admin/y' });
    expect(r.finalLocation).toBe('/admin/y');
    expect(r.responses[0].headers.location.startsWith('https://cms.test/oauth2/auth?')).toBe(true);
    expect(attrs(cookieLine(r.responses[0].setCookies, 'oc_login')!)).toContain('secure');
    const session = cookieLine(r.callbackSetCookies, 'oc_session')!;
    expect(attrs(session)).toEqual(expect.arrayContaining(['secure', 'httponly', 'samesite=lax', 'path=/']));
    const got = (await t.app.get(SessionStore).get(r.sessionCookie!))!;
    expectNoTokens(r, [got.accessToken, got.refreshToken, got.idToken]);
    expect(await t.db.selectFrom('auth_sessions').selectAll().execute()).toHaveLength(1);
  });
});

describe('BFF with an unreachable internal URL', () => {
  let t: TestApp;

  beforeAll(async () => {
    // PORT=9 (discard) on loopback: nothing listens there, so the BFF's internal discovery fails
    // while the app itself listens on another port.
    t = await createTestApp({ PORT: '9' }, { auth });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('GET /api/auth/login → 302 /admin/login?error=login_failed, no oc_login', async () => {
    const res = await fetch(`${t.url}/api/auth/login?returnTo=/admin/x`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/login?error=login_failed');
    expect(cookieLine(res.headers.getSetCookie(), 'oc_login')).toBeUndefined();
  });
});
