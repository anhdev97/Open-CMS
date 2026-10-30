import 'reflect-metadata';
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { CookieJar } from '../support/interaction';

// Network isolation in tests: the fake IdP binds loopback, which production SSO transport rejects.
 // Keep this bypass limited to the mock-server test; production always pins public DNS addresses.
vi.mock('../../src/sso-management/oidc-discovery-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sso-management/oidc-discovery-client')>();
  return { ...original, secureOidcFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, redirect: 'manual' }) };
});

const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };
const cookieLine = (lines: string[], name: string) => lines.find((l) => l.startsWith(`${name}=`));
const cookieValue = (lines: string[], name: string) => cookieLine(lines, name)?.split(';')[0].slice(name.length + 1);

describe('external OIDC identity provider (spec §6.4)', () => {
  let idp: OAuth2Server;
  let t: TestApp;
  /** Claims the mock IdP puts into every token it signs; tests overwrite them. */
  let claims: Record<string, unknown>;
  let userId: string;

  beforeAll(async () => {
    idp = new OAuth2Server();
    await idp.issuer.keys.generate('RS256');
    await idp.start(0, '127.0.0.1');
    idp.service.on('beforeTokenSigning', (token: { payload: Record<string, unknown> }) => {
      // openid-client form-encodes the Basic credentials (RFC 6749 §2.3.1: '-' → %2D); the mock does not decode.
      if (typeof token.payload.aud === 'string') token.payload.aud = decodeURIComponent(token.payload.aud);
      Object.assign(token.payload, claims);
    });
    t = await createTestApp(
      {
        OPENCLOUDCMS_IDP_OIDC_ISSUER: idp.issuer.url!,
        OPENCLOUDCMS_IDP_OIDC_CLIENT_ID: 'opencloudcms-sso',
        OPENCLOUDCMS_IDP_OIDC_CLIENT_SECRET: 'sso-secret',
        OPENCLOUDCMS_IDP_OIDC_LABEL: 'Acme SSO',
      },
      { auth },
    );
    userId = (await t.app.get(UserService).create({ email: 'user@x.com', name: 'User' })).id;
    // Legacy env values are import-only: explicit operator approval is required for activation.
    // Simulate the approved cutover here, without bypassing the production runtime lifecycle.
    const provider = await t.db.selectFrom('auth_identity_providers')
      .select(['id', 'draft_version_id']).where('code', '=', 'oidc').executeTakeFirstOrThrow();
    const draft = await t.db.selectFrom('auth_identity_provider_versions')
      .select('config_fingerprint').where('id', '=', provider.draft_version_id!).executeTakeFirstOrThrow();
    await t.db.updateTable('auth_identity_provider_versions')
      .set({ state: 'PUBLISHED', tested_fingerprint: draft.config_fingerprint,
        tested_at: new Date(), published_at: new Date() })
      .where('id', '=', provider.draft_version_id!).execute();
    await t.db.updateTable('auth_identity_providers')
      .set({ lifecycle_status: 'ACTIVE', active_version_id: provider.draft_version_id,
        draft_version_id: null })
      .where('id', '=', provider.id).execute();
    await t.db.updateTable('auth_login_policy')
      .set({ sso_login_enabled: true }).where('id', '=', 1).execute();
  });
  afterAll(async () => {
    await t?.close();
    await idp?.stop();
  });
  beforeEach(() => {
    claims = { sub: 'idp-user-1', email: 'User@X.com', email_verified: true };
  });

  const events = (type: string) =>
    t.db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).orderBy('at').execute();

  /** Browser: /api/auth/login → provider → /admin/login?uid. */
  async function beginLogin(): Promise<{ jar: CookieJar; uid: string }> {
    const jar = new CookieJar();
    const login = await jar.fetch(`${t.url}/api/auth/login`);
    const auth = await jar.fetch(new URL(login.headers.get('location')!, t.url).toString());
    const uid = new URL(auth.headers.get('location')!, t.url).searchParams.get('uid');
    if (!uid) throw new Error('no interaction uid');
    return { jar, uid };
  }

  /** Clicks "Sign in with SSO" and lets the IdP authorize; returns the IdP's redirect to our callback. */
  async function throughIdp(jar: CookieJar, uid: string): Promise<{ start: Response; callbackUrl: string }> {
    const start = await jar.fetch(`${t.url}/oauth2/interaction/${uid}/idp/oidc`);
    expect(start.status).toBe(302);
    const authorize = start.headers.get('location')!;
    // The IdP is another origin: the test jar's cookies must not go there.
    const atIdp = await fetch(authorize, { redirect: 'manual' });
    expect(atIdp.status).toBe(302);
    return { start, callbackUrl: atIdp.headers.get('location')! };
  }

  /** Follows same-origin redirects with the jar until a Location outside /oauth2 (or the BFF callback's result). */
  async function follow(jar: CookieJar, href: string): Promise<{ location: string; setCookies: string[] }> {
    let next = new URL(href, t.url).toString();
    const setCookies: string[] = [];
    for (let hop = 0; hop < 12; hop++) {
      const res = await jar.fetch(next);
      setCookies.push(...res.headers.getSetCookie());
      const loc = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !loc) throw new Error(`no redirect from ${next}: ${res.status} ${await res.text()}`);
      const u = new URL(loc, next);
      if (u.origin !== new URL(t.url).origin || (!u.pathname.startsWith('/oauth2/') && !u.pathname.startsWith('/api/auth/callback'))) {
        return { location: u.pathname + u.search, setCookies };
      }
      next = u.toString();
    }
    throw new Error('too many redirects');
  }

  it('GET /oauth2/interaction/:uid lists the configured IdP', async () => {
    const { jar, uid } = await beginLogin();
    const res = await jar.fetch(`${t.url}/oauth2/interaction/${uid}`);
    expect(await res.json()).toEqual({ idps: [{ id: 'oidc', label: 'Acme SSO' }] });
  });

  it('start sets oc_idp (httpOnly, Lax, Path=/oauth2, 600 s) and redirects to the IdP with PKCE, fixed callback', async () => {
    const { jar, uid } = await beginLogin();
    const start = await jar.fetch(`${t.url}/oauth2/interaction/${uid}/idp/oidc`);
    expect(start.status).toBe(302);
    expect(start.headers.get('cache-control')).toBe('no-store');
    const line = cookieLine(start.headers.getSetCookie(), 'oc_idp')!;
    expect(line).toBeTruthy();
    const attrs = line.split(';').slice(1).map((a) => a.trim().toLowerCase());
    expect(attrs).toEqual(expect.arrayContaining(['path=/oauth2', 'max-age=600', 'httponly', 'samesite=lax']));
    expect(attrs).not.toContain('secure');
    const loc = new URL(start.headers.get('location')!);
    expect(loc.origin).toBe(new URL(idp.issuer.url!).origin);
    expect(Object.fromEntries(loc.searchParams)).toMatchObject({
      client_id: 'opencloudcms-sso',
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: `${t.url}/oauth2/idp/oidc/callback`,
      code_challenge_method: 'S256',
      state: expect.any(String),
      nonce: expect.any(String),
      code_challenge: expect.any(String),
    });
    // No secret material of the flow is visible in the cookie.
    expect(line).not.toContain(loc.searchParams.get('state')!);
  });

  it('full chain: IdP → link "User@X.com" to user@x.com → oc_session valid for /api/auth/me', async () => {
    const { jar, uid } = await beginLogin();
    const { callbackUrl } = await throughIdp(jar, uid);
    expect(callbackUrl.startsWith(`${t.url}/oauth2/idp/oidc/callback?`)).toBe(true);
    const out = await follow(jar, callbackUrl);
    expect(out.location).toBe('/admin');
    expect(cookieValue(out.setCookies, 'oc_session')).toBeTruthy();
    // oc_idp is gone after the flow.
    expect(jar.header(`${t.url}/oauth2/interaction/${uid}/idp/complete`)).not.toContain('oc_idp=');

    const me = await jar.fetch(`${t.url}/api/auth/me`);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: userId, email: 'user@x.com' });

    const links = await t.db.selectFrom('auth_user_identities').selectAll().where('subject', '=', 'idp-user-1').execute();
    expect(links).toEqual([expect.objectContaining({ user_id: userId, provider: 'oidc', email: 'user@x.com' })]);
    expect((await events('idp_linked')).map((e) => [e.user_id, e.meta])).toEqual([[userId, { provider: 'oidc' }]]);
    expect((await events('login_succeeded')).at(-1)).toMatchObject({ user_id: userId, meta: { method: 'idp', provider: 'oidc' } });

    // Second SSO login goes through the existing link.
    const again = await beginLogin();
    const second = await throughIdp(again.jar, again.uid);
    expect((await follow(again.jar, second.callbackUrl)).location).toBe('/admin');
    expect(await events('idp_linked')).toHaveLength(1);
  });

  it('email_verified:false for an unlinked subject → /admin/login?error=idp_email_unverified, audited', async () => {
    claims = { sub: 'idp-unverified', email: 'user@x.com', email_verified: false };
    const { jar, uid } = await beginLogin();
    const { callbackUrl } = await throughIdp(jar, uid);
    const cb = await jar.fetch(callbackUrl);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/admin/login?error=idp_email_unverified');
    expect(cookieLine(cb.headers.getSetCookie(), 'oc_idp')).toMatch(/Max-Age=0/);
    expect((await events('login_failed')).at(-1)).toMatchObject({ meta: { reason: 'idp_email_unverified', method: 'idp' } });
  });

  it('unknown email → idp_account_not_found', async () => {
    claims = { sub: 'idp-stranger', email: 'stranger@x.com', email_verified: true };
    const { jar, uid } = await beginLogin();
    const { callbackUrl } = await throughIdp(jar, uid);
    const cb = await jar.fetch(callbackUrl);
    expect(cb.headers.get('location')).toBe('/admin/login?error=idp_account_not_found');
  });

  it('tampered oc_idp → invalid_state', async () => {
    const { jar, uid } = await beginLogin();
    const { start, callbackUrl } = await throughIdp(jar, uid);
    const value = cookieValue(start.headers.getSetCookie(), 'oc_idp')!;
    const tampered = new CookieJar();
    tampered.store(
      new Response(null, { headers: [['set-cookie', `oc_idp=${value.slice(0, -4)}AAAA; Path=/oauth2`]] }),
      `${t.url}/oauth2/x`,
    );
    const cb = await tampered.fetch(callbackUrl);
    expect(cb.headers.get('location')).toBe('/admin/login?error=invalid_state');
    // No cookie at all.
    const bare = await fetch(callbackUrl, { redirect: 'manual' });
    expect(bare.headers.get('location')).toBe('/admin/login?error=invalid_state');
  });

  it("another interaction's oc_idp (uid mismatch) → invalid_state, no session", async () => {
    const a = await beginLogin();
    const b = await beginLogin();
    const viaA = await throughIdp(a.jar, a.uid);
    const viaB = await throughIdp(b.jar, b.uid);
    const bCookie = cookieValue(viaB.start.headers.getSetCookie(), 'oc_idp')!;

    // A's browser carries B's oc_idp: A's callback state does not match B's sealed state.
    a.jar.store(new Response(null, { headers: [['set-cookie', `oc_idp=${bCookie}; Path=/oauth2`]] }), `${t.url}/oauth2/x`);
    const cb = await a.jar.fetch(viaA.callbackUrl);
    expect(cb.headers.get('location')).toBe('/admin/login?error=invalid_state');

    // A's browser replays B's whole IdP response (state matches B's cookie) but holds A's interaction.
    a.jar.store(new Response(null, { headers: [['set-cookie', `oc_idp=${bCookie}; Path=/oauth2`]] }), `${t.url}/oauth2/x`);
    const out = await follow(a.jar, viaB.callbackUrl);
    expect(out.location).toBe('/admin/login?error=invalid_state');
    expect(cookieValue(out.setCookies, 'oc_session')).toBeUndefined();
  });

  it('IdP error response → login_failed', async () => {
    const { jar, uid } = await beginLogin();
    const start = await jar.fetch(`${t.url}/oauth2/interaction/${uid}/idp/oidc`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb = await jar.fetch(`${t.url}/oauth2/idp/oidc/callback?error=access_denied&state=${state}`);
    expect(cb.headers.get('location')).toBe('/admin/login?error=login_failed');
  });

  it('unknown provider id → login_failed; dead interaction → login_expired', async () => {
    const { jar, uid } = await beginLogin();
    const unknown = await jar.fetch(`${t.url}/oauth2/interaction/${uid}/idp/github`);
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get('location')).toBe('/admin/login?error=login_failed');
    const dead = await new CookieJar().fetch(`${t.url}/oauth2/interaction/${uid}/idp/oidc`);
    expect(dead.headers.get('location')).toBe('/admin/login?error=login_expired');
  });
});

describe('without idp.oidc configured', () => {
  it('lists no IdP and refuses to start one', async () => {
    const t = await createTestApp();
    try {
      const jar = new CookieJar();
      const login = await jar.fetch(`${t.url}/api/auth/login`);
      const authRes = await jar.fetch(new URL(login.headers.get('location')!, t.url).toString());
      const uid = new URL(authRes.headers.get('location')!, t.url).searchParams.get('uid')!;
      expect(await (await jar.fetch(`${t.url}/oauth2/interaction/${uid}`)).json()).toEqual({ idps: [] });
      const start = await jar.fetch(`${t.url}/oauth2/interaction/${uid}/idp/oidc`);
      expect(start.headers.get('location')).toBe('/admin/login?error=login_failed');
    } finally {
      await t.close();
    }
  });
});
