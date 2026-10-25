import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';
import { loginAs } from '../support/login';

const PW = 'correct horse battery';

/**
 * Dev default: no OPENCLOUDCMS_PUBLIC_URL, so the public URL is http://localhost:<port> while the app listens on
 * 127.0.0.1 and the BFF reaches its own provider there. Provider URLs must still be on the public origin.
 */
describe('dev default public URL (http://localhost:<port>, no OPENCLOUDCMS_PUBLIC_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ OPENCLOUDCMS_PUBLIC_URL: '' });
    await t.app.get(UserService).create({ email: 'admin@x.com', name: 'Admin', password: PW });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('the test app really runs the dev default', () => {
    expect(t.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(t.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('full login stays on the public origin and ends with a session', async () => {
    const r = await loginAs(t, 'admin@x.com', PW);
    expect(r.sessionCookie).toBeTruthy();
  });

  it('X-Forwarded-Proto does not flip provider URLs to https (no blanket proxy trust on an http public URL)', async () => {
    const res = await fetch(`${t.baseUrl}/oauth2/.well-known/openid-configuration`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const doc = (await res.json()) as Record<string, string>;
    expect(res.status).toBe(200);
    expect(doc.authorization_endpoint.startsWith('http://')).toBe(true);
    expect(doc.token_endpoint.startsWith('http://')).toBe(true);
  });
});
