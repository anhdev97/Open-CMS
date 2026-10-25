import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';

describe('OAuth2Module wired into OpenCloudCmsModule', () => {
  let t: CoreTestApp;
  let cookie: string;

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${t.baseUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>) } });

  beforeAll(async () => {
    t = await createCoreTestApp();
    const setup = await call('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    const login = await loginAs(t, EMAIL, PW);
    expect(login.sessionCookie).toBeTruthy();
    cookie = `oc_session=${login.sessionCookie}`;
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it('rejects admin APIs without a session', async () => {
    const res = await call('/api/admin/content-types');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
  });

  it('serves admin APIs to a logged-in Super Admin', async () => {
    const res = await call('/api/admin/content-types', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('keeps the delivery API public', async () => {
    const res = await call('/api/content/unknown');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('answers an invalid content type definition with 400 and issues', async () => {
    const res = await call('/api/admin/content-types', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ definition: { id: 'x', apiId: 'Not Valid', fields: [] } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it('refuses to start on a database with pending migrations', async () => {
    const err = await createCoreTestApp({ migrate: false }).then(
      async (x) => {
        await x.close();
        return undefined;
      },
      (e: Error) => e,
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain('opencms migrate:up');
    expect(err!.message).not.toContain('relation');
  }, 60_000);
});
