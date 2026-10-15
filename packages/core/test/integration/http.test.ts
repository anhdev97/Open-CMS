import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';
const ALLOWED = 'https://site.example.com';

describe('HTTP layer owned by core', () => {
  let t: CoreTestApp;
  let cookie: string;

  const call = (path: string, init: RequestInit = {}) => fetch(`${t.baseUrl}${path}`, init);
  const postJson = (path: string, body: string) =>
    call(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: t.url }, body });

  beforeAll(async () => {
    t = await createCoreTestApp({ cors: { origins: [ALLOWED] } });
    const setup = await call('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, EMAIL, PW)).sessionCookie}`;
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  describe('body parsing', () => {
    it('parses a JSON body on an admin route', async () => {
      const res = await postJson('/api/admin/content-types/plan', JSON.stringify({ removeId: 'nope' }));
      expect(res.status).not.toBe(422);
      expect(res.status).not.toBe(413);
      expect(res.status).toBeLessThan(500);
    });

    it('answers malformed JSON with 422 validation_failed', async () => {
      const res = await postJson('/api/admin/content-types/plan', '{"definition":');
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe('validation_failed');
    });

    it('answers a 2 MB JSON body with 413 payload_too_large', async () => {
      const res = await postJson('/api/admin/content-types/plan', JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe('payload_too_large');
    });

    it('leaves /oauth2 to oidc-provider: login works and nothing warns about a parsed body', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const emit = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
      try {
        const login = await loginAs(t, EMAIL, PW);
        expect(login.sessionCookie).toBeTruthy();
        const texts = [...warn.mock.calls, ...emit.mock.calls].map((c) => String(c[0]));
        expect(texts.filter((x) => /already parsed request body/i.test(x))).toEqual([]);
      } finally {
        warn.mockRestore();
        emit.mockRestore();
      }
    });
  });

  describe('CORS for the delivery API', () => {
    it('allows a configured origin on GET /api/content/*', async () => {
      const res = await call('/api/content/x', { headers: { origin: ALLOWED } });
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
      expect(res.headers.get('vary')).toMatch(/Origin/i);
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
      expect(res.headers.get('access-control-max-age')).toBe('600');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('answers a preflight with 204 and the headers', async () => {
      const res = await call('/api/content/x', { method: 'OPTIONS', headers: { origin: ALLOWED } });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    });

    it('adds nothing for an unknown origin (preflight still 204)', async () => {
      const get = await call('/api/content/x', { headers: { origin: 'https://evil.example.com' } });
      expect(get.headers.get('access-control-allow-origin')).toBeNull();
      const pre = await call('/api/content/x', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('adds no CORS headers outside /api/content', async () => {
      const res = await call('/api/admin/content-types', { method: 'OPTIONS', headers: { origin: ALLOWED } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
