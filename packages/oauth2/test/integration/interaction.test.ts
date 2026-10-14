import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { followToCode, startInteraction, type StartedInteraction } from '../support/interaction';

const PW = 'correct horse battery';

describe('password login interaction', () => {
  let t: TestApp;
  let adminId: string;
  let disabledId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const users = t.app.get(UserService);
    adminId = (await users.create({ email: 'admin@x.com', name: 'Admin', password: PW })).id;
    disabledId = (await users.create({ email: 'off@x.com', name: 'Off', password: PW })).id;
    await t.db.updateTable('auth_users').set({ status: 'disabled' }).where('id', '=', disabledId).execute();
  });
  afterAll(async () => {
    await t?.close();
  });

  const login = (i: StartedInteraction, body: unknown, origin: string | null = t.url) =>
    i.cookies.fetch(`${t.url}/oauth2/interaction/${i.uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest-ua', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  const events = (type: string) =>
    t.db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).orderBy('at').execute();

  it('GET returns loginHint and idps with Cache-Control: no-store', async () => {
    const i = await startInteraction(t.url, { loginHint: 'admin@x.com' });
    const res = await i.cookies.fetch(`${t.url}/oauth2/interaction/${i.uid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ loginHint: 'admin@x.com', idps: [] });

    const plain = await startInteraction(t.url);
    const r2 = await plain.cookies.fetch(`${t.url}/oauth2/interaction/${plain.uid}`);
    expect(await r2.json()).toEqual({ idps: [] });
  });

  it('correct password with " ADMIN@x.com" → 200 { redirectTo } to /oauth2/auth/<uid>, audited', async () => {
    const i = await startInteraction(t.url);
    const res = await login(i, { email: ' ADMIN@x.com', password: PW });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    expect(new URL(redirectTo, t.url).pathname).toBe(`/oauth2/auth/${i.uid}`);
    const ok = await events('login_succeeded');
    expect(ok.at(-1)).toMatchObject({ user_id: adminId, user_agent: 'vitest-ua' });
    expect(ok.at(-1)!.ip).toBeTruthy();
  });

  it('a valid login resumes to /api/auth/callback?code= without a consent prompt', async () => {
    const i = await startInteraction(t.url);
    const res = await login(i, { email: 'admin@x.com', password: PW });
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    const out = await followToCode(t.url, redirectTo, i.cookies);
    expect(out.code).toBeTruthy();
    expect(out.state).toBe(i.state);
  });

  it('wrong password and unknown email → identical 401 invalid_credentials', async () => {
    const a = await startInteraction(t.url);
    const wrong = await login(a, { email: 'admin@x.com', password: 'not the password!' });
    const b = await startInteraction(t.url);
    const unknown = await login(b, { email: 'nobody@x.com', password: PW });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.headers.get('cache-control')).toBe('no-store');
    const wb = await wrong.json();
    expect(wb).toEqual({ error: { code: 'invalid_credentials', message: expect.any(String) } });
    expect(await unknown.json()).toEqual(wb);
    const failed = await events('login_failed');
    expect(failed.map((e) => [e.user_id, e.meta])).toEqual(
      expect.arrayContaining([
        [adminId, { reason: 'invalid_credentials' }],
        [null, { reason: 'invalid_credentials' }],
      ]),
    );
    expect(JSON.stringify(failed)).not.toContain('not the password');
  });

  it('disabled user with correct password → 403 account_disabled and cannot finish', async () => {
    const i = await startInteraction(t.url);
    const res = await login(i, { email: 'off@x.com', password: PW });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'account_disabled' } });
    const failed = await events('login_failed');
    expect(failed.at(-1)).toMatchObject({ user_id: disabledId, meta: { reason: 'account_disabled' } });
    // The interaction got no result: resuming it sends the browser straight back to the login page.
    const resume = await i.cookies.fetch(`${t.url}/oauth2/auth/${i.uid}`);
    expect(resume.headers.get('location')).toMatch(/^\/admin\/login\?uid=/);
  });

  it('missing Origin → 403 origin_mismatch', async () => {
    const i = await startInteraction(t.url);
    const res = await login(i, { email: 'admin@x.com', password: PW }, null);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'origin_mismatch' } });
  });

  it('invalid body → 422 validation_failed', async () => {
    const i = await startInteraction(t.url);
    const res = await login(i, { email: 'admin@x.com' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('a different interaction uid than the browser\'s cookie → login_expired', async () => {
    const mine = await startInteraction(t.url);
    const other = await startInteraction(t.url);
    const res = await mine.cookies.fetch(`${t.url}/oauth2/interaction/${other.uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@x.com', password: PW }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/admin/login?error=login_expired' });
  });

  it('6th attempt for the same email → 429 with Retry-After', async () => {
    const i = await startInteraction(t.url);
    for (let n = 0; n < 5; n++) {
      const r = await login(i, { email: 'victim@x.com', password: 'wrong password!!' });
      expect(r.status).toBe(401);
    }
    const res = await login(i, { email: ' Victim@X.com', password: 'wrong password!!' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    const last = (await events('login_failed')).at(-1)!;
    expect(last).toMatchObject({ user_id: null, user_agent: 'vitest-ua', meta: { reason: 'rate_limited' } });
    expect(last.ip).toBeTruthy();
  });
});

describe('expired interaction', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { auth: { ttl: { interaction: 1 } } });
    await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('POST and GET after the TTL → 200 { redirectTo: login_expired }', async () => {
    const i = await startInteraction(t.url);
    // Still valid right away, so what follows is the TTL, not a missing cookie.
    const fresh = await i.cookies.fetch(`${t.url}/oauth2/interaction/${i.uid}`);
    expect(await fresh.json()).toEqual({ idps: [] });
    await new Promise((r) => setTimeout(r, 2000));
    const res = await i.cookies.fetch(`${t.url}/oauth2/interaction/${i.uid}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@x.com', password: PW }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ redirectTo: '/admin/login?error=login_expired' });

    const get = await i.cookies.fetch(`${t.url}/oauth2/interaction/${i.uid}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ redirectTo: '/admin/login?error=login_expired' });
  });
});
