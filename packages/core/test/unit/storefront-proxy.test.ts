import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontProxy, STOREFRONT_UNAVAILABLE_MESSAGE } from '../../src/http/storefront-proxy.middleware';

function listen(app: express.Express | http.Server): Promise<{ base: string; server: http.Server; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app instanceof http.Server ? app : http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        server,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

describe('createStorefrontProxy', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  it('forwards / and /_next to the upstream and skips /admin /api /oauth2', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`up:${req.url}`);
    });
    const up = await listen(upstream);
    closers.push(up.close);

    const proxy = createStorefrontProxy({ targetUrl: up.base });
    const app = express();
    app.use(proxy.handler);
    app.get('/admin/x', (_req, res) => res.status(200).send('admin-local'));
    app.get('/api/x', (_req, res) => res.status(200).send('api-local'));
    app.get('/oauth2/x', (_req, res) => res.status(200).send('oauth-local'));
    const front = await listen(app);
    closers.push(async () => {
      proxy.close();
      await front.close();
    });

    const r0 = await fetch(`${front.base}/`);
    expect(r0.status).toBe(200);
    expect(await r0.text()).toBe('up:/');

    const rNext = await fetch(`${front.base}/_next/static/chunks/main.js`);
    expect(rNext.status).toBe(200);
    expect(await rNext.text()).toBe('up:/_next/static/chunks/main.js');

    expect(await (await fetch(`${front.base}/admin/x`)).text()).toBe('admin-local');
    expect(await (await fetch(`${front.base}/api/x`)).text()).toBe('api-local');
    expect(await (await fetch(`${front.base}/oauth2/x`)).text()).toBe('oauth-local');
    expect(seen.some((s) => s.includes('/admin'))).toBe(false);
    expect(seen.some((s) => s.includes('/api'))).toBe(false);
    expect(seen.some((s) => s.includes('/oauth2'))).toBe(false);
  });

  it('returns 502 with the stable message when upstream is down', async () => {
    const targetUrl = 'http://127.0.0.1:1'; // closed port
    const proxy = createStorefrontProxy({ targetUrl });
    const app = express();
    app.use(proxy.handler);
    const front = await listen(app);
    closers.push(async () => {
      proxy.close();
      await front.close();
    });

    const r = await fetch(`${front.base}/`);
    expect(r.status).toBe(502);
    const body = await r.text();
    expect(body).toBe(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
    expect(body).toContain('Storefront is unavailable (Next.js did not respond at');
  });
});
