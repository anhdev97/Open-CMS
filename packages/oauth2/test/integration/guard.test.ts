import 'reflect-metadata';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OidcClient } from '../../src/bff/oidc-client';
import { SessionStore } from '../../src/bff/session.store';
import { OAUTH2_CONFIG } from '../../src/constants';
import { CurrentUser, RequirePermission, RequireRole, type RequestUser } from '../../src/guard/current-user.decorator';
import { PERMISSIONS } from '../../src/permissions';
import { adminClientSecret } from '../../src/provider/provider.factory';
import { sha256 } from '../../src/security/crypto';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs, restartLogin } from '../support/login';

const PW = 'correct horse battery';
const auth = { rateLimit: { loginPerEmail: { limit: 1000 }, loginPerIp: { limit: 1000 } } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Controller('api/test')
class ProbeController {
  @Get('whoami')
  whoami(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @Post('echo')
  @HttpCode(200)
  echo(@CurrentUser() user: RequestUser): { ok: true; id: string } {
    return { ok: true, id: user.id };
  }

  @RequireRole('nonexistent')
  @Get('needs-role')
  needsRole(): { ok: true } {
    return { ok: true };
  }

  /** Compat shim (removed in Task 14): the legacy key maps to isSuperAdmin. */
  @RequireRole('super_admin')
  @Get('needs-super-admin')
  needsSuperAdmin(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('settings.users')
  @Get('needs-users')
  needsUsers(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('content.read', 'content.publish')
  @Get('needs-read-publish')
  needsReadPublish(): { ok: true } {
    return { ok: true };
  }
}

/** A host-app route outside /api: the guard must leave it alone. */
@Controller('host')
class HostController {
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}

const controllers = [ProbeController, HostController];

interface Call {
  status: number;
  body: any;
  setCookies: string[];
}

function client(t: TestApp) {
  return async (
    path: string,
    o: { cookie?: string; method?: string; origin?: string | null; body?: unknown } = {},
  ): Promise<Call> => {
    const method = o.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (o.cookie) headers.cookie = `oc_session=${o.cookie}`;
    if (o.origin !== null && method !== 'GET') headers.origin = o.origin ?? new URL(t.url).origin;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${t.url}${path}`, {
      method,
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body, setCookies: res.headers.getSetCookie() };
  };
}

const clearsSession = (c: Call) =>
  c.setCookies.some((l) => {
    const parts = l.split(';').map((p) => p.trim().toLowerCase());
    return parts[0] === 'oc_session=' && parts.includes('path=/') && parts.includes('max-age=0') && parts.includes('httponly');
  });

/** Presents a refresh token straight at the provider's token endpoint as opencms-admin. */
async function useRefreshToken(t: TestApp, refreshToken: string): Promise<{ status: number; body: any }> {
  const secret = adminClientSecret(t.app.get(OAUTH2_CONFIG));
  const res = await fetch(`${t.url}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`opencms-admin:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  return { status: res.status, body: await res.json() };
}

describe('AuthGuard, me, logout (default TTLs)', () => {
  let t: TestApp;
  let api: ReturnType<typeof client>;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestApp({}, { auth, controllers });
    api = client(t);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('empty DB → GET /api/auth/me and protected routes answer 409 setup_required; setup stays public', async () => {
    const me = await api('/api/auth/me');
    expect(me.status).toBe(409);
    expect(me.body).toEqual({ error: { code: 'setup_required', message: expect.any(String) } });
    expect((await api('/api/test/whoami')).body.error.code).toBe('setup_required');
    expect((await api('/api/auth/setup')).body).toEqual({ required: true });

    adminId = (await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW })).id;
  });

  it('routes outside /api are untouched by the guard', async () => {
    const r = await api('/host/open');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('no cookie → 401 unauthenticated and oc_session cleared', async () => {
    const me = await api('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('unauthenticated');
    expect(clearsSession(me)).toBe(true);
    const w = await api('/api/test/whoami');
    expect(w.status).toBe(401);
    expect(clearsSession(w)).toBe(true);
    const bogus = await api('/api/test/whoami', { cookie: 'not-a-session' });
    expect(bogus.status).toBe(401);
  });

  it('after login → me 200 { id, email, name, locale, groups, permissions, isSuperAdmin }; @CurrentUser() gets the same user', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const me = await api('/api/auth/me', { cookie: sessionCookie });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: adminId,
      email: 'admin@x.com',
      name: 'Admin',
      locale: null,
      groups: [{ key: 'super-admin', name: 'Super Admin' }],
      permissions: [...PERMISSIONS].sort(),
      isSuperAdmin: true,
    });
    const w = await api('/api/test/whoami', { cookie: sessionCookie });
    expect(w.status).toBe(200);
    expect(w.body).toEqual(me.body);
  });

  it('@RequireRole with a missing role → 403 forbidden', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const r = await api('/api/test/needs-role', { cookie: sessionCookie });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
  });

  it('@RequirePermission: super admin passes; contenter gets 403 with the missing permission; permissions recomputed per request', async () => {
    const admin = (await loginAs(t, 'admin@x.com', PW)).sessionCookie;
    expect((await api('/api/test/needs-users', { cookie: admin })).status).toBe(200);
    expect((await api('/api/test/needs-super-admin', { cookie: admin })).status).toBe(200);

    const c = await t.app.get(UserService).create({ email: 'contenter@x.com', name: 'C', password: PW });
    await t.db.deleteFrom('auth_user_groups').where('user_id', '=', c.id).execute();
    await sql`insert into auth_user_groups (user_id, group_id) select ${c.id}, id from auth_groups where key = 'contenter'`.execute(t.db);
    const cookie = (await loginAs(t, 'contenter@x.com', PW)).sessionCookie;

    const me = await api('/api/auth/me', { cookie });
    expect(me.body).toMatchObject({
      groups: [{ key: 'contenter', name: 'Contenter' }],
      permissions: ['content.create', 'content.delete', 'content.read', 'content.submit', 'content.update'],
      isSuperAdmin: false,
    });

    const r = await api('/api/test/needs-users', { cookie });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: { code: 'forbidden', message: 'Missing permission: settings.users' } });
    const rp = await api('/api/test/needs-read-publish', { cookie });
    expect(rp.body).toEqual({ error: { code: 'forbidden', message: 'Missing permission: content.publish' } });
    expect((await api('/api/test/needs-super-admin', { cookie })).status).toBe(403);

    // Adding reviewer takes effect on the next request (B10).
    await sql`insert into auth_user_groups (user_id, group_id) select ${c.id}, id from auth_groups where key = 'reviewer'`.execute(t.db);
    expect((await api('/api/test/needs-read-publish', { cookie })).status).toBe(200);
    const me2 = await api('/api/auth/me', { cookie });
    expect(me2.body.groups).toEqual([{ key: 'contenter', name: 'Contenter' }, { key: 'reviewer', name: 'Reviewer' }]);
    expect(me2.body.permissions).toContain('content.publish');
  });

  it('POST with a wrong or missing Origin → 403 origin_mismatch; right Origin → 200', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const bad = await api('/api/test/echo', { method: 'POST', cookie: sessionCookie, origin: 'http://evil.example' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('origin_mismatch');
    const none = await api('/api/test/echo', { method: 'POST', cookie: sessionCookie, origin: null });
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('origin_mismatch');
    // Origin is checked before the session: no cookie + wrong Origin is still origin_mismatch.
    expect((await api('/api/test/echo', { method: 'POST', origin: 'http://evil.example' })).body.error.code).toBe(
      'origin_mismatch',
    );
    const ok = await api('/api/test/echo', { method: 'POST', cookie: sessionCookie });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, id: adminId });
  });

  it('mixed-case /api paths are guarded too (Express routes case-insensitively)', async () => {
    const upper = await api('/API/test/whoami');
    expect(upper.status).toBe(401);
    expect(upper.body.error.code).toBe('unauthenticated');
    const echo = await api('/Api/test/echo', { method: 'POST', origin: 'http://evil.example' });
    expect(echo.status).toBe(403);
    expect(echo.body.error.code).toBe('origin_mismatch');
    expect((await api('/aPI/TEST/needs-role')).status).toBe(401);
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const role = await api('/API/Test/Needs-Role', { cookie: sessionCookie });
    expect(role.status).toBe(403);
    expect(role.body.error.code).toBe('forbidden');
  });

  it('disabling the user via UserService → next request 401 and cookie cleared', async () => {
    const users = t.app.get(UserService);
    const other = await users.create({ email: 'second@x.com', name: 'Second', password: PW });
    const { sessionCookie } = await loginAs(t, 'second@x.com', PW);
    expect((await api('/api/auth/me', { cookie: sessionCookie })).status).toBe(200);
    await users.setStatus(other.id, 'disabled', adminId);
    const r = await api('/api/test/whoami', { cookie: sessionCookie });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthenticated');
    expect(clearsSession(r)).toBe(true);
    await users.setStatus(other.id, 'active', adminId);
  });

  it('user disabled behind the store (session row still there) → 401 and the session is destroyed', async () => {
    const { sessionCookie } = await loginAs(t, 'second@x.com', PW);
    await t.db.updateTable('auth_users').set({ status: 'disabled' }).where('email', '=', 'second@x.com').execute();
    try {
      const r = await api('/api/auth/me', { cookie: sessionCookie });
      expect(r.status).toBe(401);
      expect(clearsSession(r)).toBe(true);
      const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(sessionCookie!)).executeTakeFirst();
      expect(row).toBeUndefined();
    } finally {
      await t.db.updateTable('auth_users').set({ status: 'active' }).where('email', '=', 'second@x.com').execute();
    }
  });

  it('idle or absolute expiry in the past → 401 and the session row is deleted', async () => {
    for (const col of ['idle_expires_at', 'absolute_expires_at'] as const) {
      const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
      await t.db
        .updateTable('auth_sessions')
        .set({ [col]: new Date(Date.now() - 1000) })
        .where('id_hash', '=', sha256(sessionCookie!))
        .execute();
      const r = await api('/api/test/whoami', { cookie: sessionCookie });
      expect(r.status, col).toBe(401);
      expect(clearsSession(r)).toBe(true);
      const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(sessionCookie!)).executeTakeFirst();
      expect(row, col).toBeUndefined();
    }
  });

  it('a session row that cannot be decrypted → 401 (not 500) and the row is deleted', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    await t.db
      .updateTable('auth_sessions')
      .set({ access_token_enc: 'garbage' })
      .where('id_hash', '=', sha256(sessionCookie!))
      .execute();
    const r = await api('/api/auth/me', { cookie: sessionCookie });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthenticated');
    const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(sessionCookie!)).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('logout: needs Origin; revokes, deletes the session, clears the cookie, audits, returns the login page', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const stored = await t.app.get(SessionStore).get(sessionCookie!);
    expect(stored?.refreshToken).toBeTruthy();

    const noOrigin = await api('/api/auth/logout', { method: 'POST', cookie: sessionCookie, origin: 'http://evil.example' });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.code).toBe('origin_mismatch');

    const r = await api('/api/auth/logout', { method: 'POST', cookie: sessionCookie });
    expect(r.status).toBe(200);
    expect(clearsSession(r)).toBe(true);
    // C1/M1: no end-session hop (and so no id token in a browser-visible URL).
    expect(r.body).toEqual({ redirectTo: '/admin/login' });

    const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(sessionCookie!)).executeTakeFirst();
    expect(row).toBeUndefined();
    expect((await api('/api/auth/me', { cookie: sessionCookie })).status).toBe(401);

    const audit = await t.db
      .selectFrom('auth_audit_events')
      .selectAll()
      .where('type', '=', 'logout')
      .where('user_id', '=', adminId)
      .execute();
    expect(audit).toHaveLength(1);

    // R13: revocation is what ends the refresh token.
    const reuse = await useRefreshToken(t, stored!.refreshToken!);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  const providerSessions = (userId: string) =>
    t.db
      .selectFrom('auth_oidc_payloads')
      .select('id')
      .where('kind', '=', 'Session')
      .where(sql<string>`payload->>'accountId'`, '=', userId)
      .execute();

  it('C1: after logout, /api/auth/login in the same browser runs the login interaction again', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    expect(await providerSessions(adminId)).not.toHaveLength(0);
    expect((await api('/api/auth/logout', { method: 'POST', cookie: r.sessionCookie })).status).toBe(200);
    expect(await providerSessions(adminId)).toHaveLength(0);

    const again = await restartLogin(t, r.cookies);
    expect(again.location.pathname).toBe('/admin/login');
    expect(again.location.searchParams.get('uid')).toBeTruthy();
    expect(again.newSession).toBe(false);
  });

  it('C1: after BFF idle expiry, /api/auth/login in the same browser runs the login interaction again', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    await t.db
      .updateTable('auth_sessions')
      .set({ idle_expires_at: new Date(Date.now() - 1000) })
      .where('id_hash', '=', sha256(r.sessionCookie!))
      .execute();
    expect((await api('/api/auth/me', { cookie: r.sessionCookie })).status).toBe(401);
    expect(await providerSessions(adminId)).toHaveLength(0);

    const again = await restartLogin(t, r.cookies);
    expect(again.location.pathname).toBe('/admin/login');
    expect(again.location.searchParams.get('uid')).toBeTruthy();
    expect(again.newSession).toBe(false);
  });

  it('logout without a session → 401', async () => {
    const r = await api('/api/auth/logout', { method: 'POST' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthenticated');
  });
});

describe('AuthGuard refresh (access TTL 2 s)', () => {
  let t: TestApp;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    t = await createTestApp({ OPENCMS_AUTH_TTL_ACCESS: '2' }, { auth, controllers });
    api = client(t);
    await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW });
  });
  afterAll(async () => {
    await t?.close();
  });

  const encRow = (cookie: string) =>
    t.db
      .selectFrom('auth_sessions')
      .select(['access_token_enc', 'refresh_token_enc', 'access_expires_at'])
      .where('id_hash', '=', sha256(cookie))
      .executeTakeFirstOrThrow();

  it('access token expired → me still 200 and access_token_enc has changed', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const before = await encRow(sessionCookie!);
    await sleep(3000);
    const me = await api('/api/auth/me', { cookie: sessionCookie });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('admin@x.com');
    const after = await encRow(sessionCookie!);
    expect(after.access_token_enc).not.toBe(before.access_token_enc);
    expect(after.refresh_token_enc).not.toBe(before.refresh_token_enc);
    expect(new Date(after.access_expires_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('two concurrent requests after expiry → both 200, exactly one refresh', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    await sleep(3000);
    const oidc = t.app.get(OidcClient);
    const original = oidc.refresh.bind(oidc);
    // Slow the refresh down so the second request is certainly waiting on the row lock meanwhile.
    const spy = vi.spyOn(oidc, 'refresh').mockImplementation(async (rt) => {
      await sleep(300);
      return original(rt);
    });
    try {
      const [a, b] = await Promise.all([
        api('/api/auth/me', { cookie: sessionCookie }),
        api('/api/test/whoami', { cookie: sessionCookie }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('12 parallel requests at refresh time → all 200, exactly one refresh, no pool deadlock', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    await sleep(2100);
    const oidc = t.app.get(OidcClient);
    const original = oidc.refresh.bind(oidc);
    const spy = vi.spyOn(oidc, 'refresh').mockImplementation(async (rt) => {
      await sleep(300);
      return original(rt);
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          api(i % 2 ? '/api/test/whoami' : '/api/auth/me', { cookie: sessionCookie }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  }, 20_000);

  it('another instance holds the refresh lease → request waits for its tokens, no own refresh', async () => {
    const store = t.app.get(SessionStore);
    const oidc = t.app.get(OidcClient);
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const idHash = sha256(sessionCookie!);
    // "Instance B" has claimed the refresh and already got new tokens from the provider.
    const tokens = await oidc.refresh((await store.get(sessionCookie!))!.refreshToken!);
    await t.db
      .updateTable('auth_sessions')
      .set({ refresh_lease_until: new Date(Date.now() + 10_000) })
      .where('id_hash', '=', idHash)
      .execute();
    await sleep(2100);
    const spy = vi.spyOn(oidc, 'refresh');
    try {
      const completing = sleep(300).then(() => store.completeRefresh(idHash, tokens));
      const r = await api('/api/auth/me', { cookie: sessionCookie });
      await completing;
      expect(r.status).toBe(200);
      expect(r.body.email).toBe('admin@x.com');
      expect(spy).not.toHaveBeenCalled();
      const row = await t.db.selectFrom('auth_sessions').select('refresh_lease_until').where('id_hash', '=', idHash).executeTakeFirstOrThrow();
      expect(row.refresh_lease_until).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('refresh failure → 401, session destroyed, cookie cleared', async () => {
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const spy = vi.spyOn(t.app.get(OidcClient), 'refresh').mockRejectedValue(new Error('boom'));
    try {
      await sleep(2100);
      const r = await api('/api/test/whoami', { cookie: sessionCookie });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('unauthenticated');
      expect(clearsSession(r)).toBe(true);
      const row = await t.db.selectFrom('auth_sessions').select('id_hash').where('id_hash', '=', sha256(sessionCookie!)).executeTakeFirst();
      expect(row).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('reusing a rotated refresh token revokes the grant: old and new refresh tokens both invalid', async () => {
    const store = t.app.get(SessionStore);
    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    const oldRt = (await store.get(sessionCookie!))!.refreshToken!;
    await sleep(2100);
    expect((await api('/api/auth/me', { cookie: sessionCookie })).status).toBe(200);
    const newRt = (await store.get(sessionCookie!))!.refreshToken!;
    expect(newRt).not.toBe(oldRt);

    const reuse = await useRefreshToken(t, oldRt);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');

    const rotated = await useRefreshToken(t, newRt);
    expect(rotated.status).toBe(400);
    expect(rotated.body.error).toBe('invalid_grant');

    // The BFF session can no longer refresh → 401.
    await sleep(100);
    const me = await api('/api/auth/me', { cookie: sessionCookie });
    expect(me.status).toBe(401);
  });
});

@Controller('api/content')
class PublicContentController {
  @Get('x')
  x(): { ok: true } {
    return { ok: true };
  }
}

@Controller('api/contents')
class NotPublicController {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

describe('publicPathPrefixes (R17)', () => {
  let t: TestApp;
  let api: ReturnType<typeof client>;
  beforeAll(async () => {
    t = await createTestApp({}, { auth, controllers: [PublicContentController, NotPublicController] });
    api = client(t);
    await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('/api/content/** is reachable without a session, in any case', async () => {
    expect((await api('/api/content/x')).body).toEqual({ ok: true });
    expect((await api('/API/Content/x')).status).toBe(200);
  });

  it('/api/contents (no trailing-slash match) stays protected', async () => {
    const r = await api('/api/contents');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthenticated');
  });
});
