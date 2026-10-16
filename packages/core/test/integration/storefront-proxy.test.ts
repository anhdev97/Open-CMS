import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STOREFRONT_UNAVAILABLE_MESSAGE } from '../../src/http/storefront-proxy.middleware';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

describe('OpenCmsModule storefront proxy', () => {
  describe('enabled with mock Next', () => {
    let upstream: http.Server;
    let targetUrl: string;
    let t: CoreTestApp;
    const hits: string[] = [];

    beforeAll(async () => {
      upstream = http.createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('next-ok');
      });
      await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
      targetUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      t = await createCoreTestApp({
        storefront: { enabled: true, targetUrl },
        admin: { enabled: false },
      });
    }, 60_000);

    afterAll(async () => {
      await t?.close();
      await new Promise<void>((r) => upstream.close(() => r()));
    });

    it('proxies / to Next', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('next-ok');
      expect(hits.some((h) => h === 'GET /' || h.startsWith('GET /?'))).toBe(true);
    });

    it('does not proxy /api/auth/me', async () => {
      hits.length = 0;
      const r = await fetch(`${t.baseUrl}/api/auth/me`);
      expect(r.status).toBe(409); // setup_required on empty DB — Nest/oauth answered
      expect(hits.length).toBe(0);
    });

    it('does not proxy /oauth2/… to Next (Nest/provider or 404, not next-ok)', async () => {
      hits.length = 0;
      const r = await fetch(`${t.baseUrl}/oauth2/jwks`);
      const text = await r.text();
      expect(text).not.toBe('next-ok');
      expect(hits.length).toBe(0);
    });
  });

  describe('enabled with dead upstream', () => {
    let t: CoreTestApp;
    const targetUrl = 'http://127.0.0.1:1';
    beforeAll(async () => {
      t = await createCoreTestApp({ storefront: { enabled: true, targetUrl }, admin: { enabled: false } });
    }, 60_000);
    afterAll(async () => {
      await t?.close();
    });

    it('answers 502 with stable message', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(502);
      expect(await r.text()).toBe(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
    });
  });

  describe('disabled', () => {
    let t: CoreTestApp;
    beforeAll(async () => {
      t = await createCoreTestApp({ storefront: { enabled: false }, admin: { enabled: false } });
    }, 60_000);
    afterAll(async () => {
      await t?.close();
    });

    it('does not proxy; GET / is 404', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(404);
    });
  });
});
