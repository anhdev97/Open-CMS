import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('e2e: setup → login → me → access expiry → refresh → logout → 401', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ OPENCMS_AUTH_TTL_ACCESS: '2' });
  });
  afterAll(async () => {
    await t?.close();
  });

  const origin = () => new URL(t.url).origin;
  const me = (cookie?: string) =>
    fetch(`${t.url}/api/auth/me`, { headers: cookie ? { cookie: `oc_session=${cookie}` } : {} });

  it('walks the whole chain', async () => {
    expect(await (await fetch(`${t.url}/api/auth/setup`)).json()).toEqual({ required: true });
    const setup = await fetch(`${t.url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin() },
      body: JSON.stringify({ email: 'Admin@X.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    expect(await (await fetch(`${t.url}/api/auth/setup`)).json()).toEqual({ required: false });

    const { sessionCookie } = await loginAs(t, 'admin@x.com', PW);
    expect(sessionCookie).toBeTruthy();
    const first = await me(sessionCookie);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ email: 'admin@x.com', roles: ['super_admin'] });

    await sleep(3000); // access token (2 s) has expired → transparent refresh
    const second = await me(sessionCookie);
    expect(second.status).toBe(200);

    const out = await fetch(`${t.url}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `oc_session=${sessionCookie}`, origin: origin() },
      redirect: 'manual',
    });
    expect(out.status).toBeLessThan(400);

    const after = await me(sessionCookie);
    expect(after.status).toBe(401);
    expect((await after.json()).error.code).toBe('unauthenticated');
  });
});
