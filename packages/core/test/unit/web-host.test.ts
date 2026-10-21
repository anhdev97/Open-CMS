import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebHost, type LoadNext, type NextAppLike } from '../../src/web/web-host';

const NOT_BUILT = 'Web UI chưa được build. Chạy `pnpm build` rồi khởi động lại.';

interface Harness {
  loadNext: ReturnType<typeof vi.fn>;
  app: NextAppLike & { handled: string[]; reqHeaders: Array<string | string[] | undefined>; upgrades: string[] };
  logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function harness(over: Partial<NextAppLike> = {}): Harness {
  const app = {
    handled: [] as string[],
    reqHeaders: [] as Array<string | string[] | undefined>,
    upgrades: [] as string[],
    prepare: vi.fn(async () => {}),
    getRequestHandler: () => async (req: http.IncomingMessage, res: http.ServerResponse) => {
      app.handled.push(req.url ?? '');
      app.reqHeaders.push(req.headers['content-security-policy']);
      res.statusCode = 200;
      res.end('next');
    },
    getUpgradeHandler: () => (req: http.IncomingMessage) => {
      app.upgrades.push(req.url ?? '');
    },
    close: vi.fn(async () => {}),
    ...over,
  };
  return {
    loadNext: vi.fn(() => app),
    app,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const servers: http.Server[] = [];
const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(buildId = false): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'webhost-'));
  tmpDirs.push(d);
  if (buildId) {
    fs.mkdirSync(path.join(d, '.next'));
    fs.writeFileSync(path.join(d, '.next', 'BUILD_ID'), 'x');
  }
  return d;
}

async function serve(h: Harness, opts: { dev: boolean; dir?: string }) {
  const host = createWebHost({ dir: opts.dir ?? tmpDir(), dev: opts.dev, logger: h.logger, loadNext: h.loadNext as unknown as LoadNext });
  const expressApp = express();
  expressApp.use(host.handler);
  expressApp.use((_req, res) => res.status(404).send('backend'));
  const server = http.createServer(expressApp);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
  return { host, server, get };
}

describe('createWebHost', () => {
  it('prepare loads next once with {dev, dir} and prepares once', async () => {
    const h = harness();
    const dir = tmpDir();
    const { host } = await serve(h, { dev: true, dir });
    await host.prepare();
    expect(h.loadNext).toHaveBeenCalledTimes(1);
    expect(h.loadNext).toHaveBeenCalledWith({ dev: true, dir });
    expect(h.app.prepare).toHaveBeenCalledTimes(1);
  });

  it('leaves backend paths to Express', async () => {
    const h = harness();
    const { host, get } = await serve(h, { dev: true });
    await host.prepare();
    const res = await get('/api/x');
    expect(await res.text()).toBe('backend');
    expect(h.app.handled).toEqual([]);
  });

  it('serves non-admin paths via next without a CSP', async () => {
    const h = harness();
    const { host, get } = await serve(h, { dev: true });
    await host.prepare();
    const res = await get('/');
    expect(await res.text()).toBe('next');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('gives admin paths a per-request nonce CSP on request and response, plus security headers', async () => {
    const h = harness();
    const s = await serve(h, { dev: false, dir: tmpDir(true) });
    await s.host.prepare();
    const a = await s.get('/admin/x');
    const b = await s.get('/admin/y');
    const nonce = (v: string | null | undefined) => /'nonce-([^']+)'/.exec(v ?? '')?.[1];
    const resCsp = a.headers.get('content-security-policy');
    expect(nonce(resCsp)).toBeTruthy();
    expect(h.app.reqHeaders[0]).toBe(resCsp);
    expect(nonce(resCsp)).not.toBe(nonce(b.headers.get('content-security-policy')));
    expect(a.headers.get('x-content-type-options')).toBe('nosniff');
    expect(a.headers.get('referrer-policy')).toBe('same-origin');
    expect(a.headers.get('x-frame-options')).toBe('DENY');
    expect(a.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('treats an encoded admin path as admin', async () => {
    const h = harness();
    const s = await serve(h, { dev: false, dir: tmpDir(true) });
    await s.host.prepare();
    const res = await s.get('/%61dmin/x');
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(h.app.reqHeaders[0]).toBe(res.headers.get('content-security-policy'));
  });

  it('answers 503 and warns once when production build is missing, never loading next', async () => {
    const h = harness();
    const { host, get } = await serve(h, { dev: false });
    await host.prepare();
    for (let i = 0; i < 3; i++) {
      const res = await get('/');
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe(NOT_BUILT);
    }
    expect(h.loadNext).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('prepare resolves and requests get 503 when loadNext throws', async () => {
    const h = harness();
    h.loadNext.mockImplementation(() => {
      throw new Error('cannot find next');
    });
    const { host, get } = await serve(h, { dev: true });
    await expect(host.prepare()).resolves.toBeUndefined();
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('cannot find next'));
    expect((await get('/')).status).toBe(503);
  });

  it('prepare resolves and requests get 503 when next.prepare rejects', async () => {
    const h = harness({ prepare: vi.fn(async () => { throw new Error('boom'); }) });
    const { host, get } = await serve(h, { dev: true });
    await expect(host.prepare()).resolves.toBeUndefined();
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect((await get('/')).status).toBe(503);
  });

  it('answers 500 and logs when the next handler rejects', async () => {
    const h = harness({ getRequestHandler: () => async () => { throw new Error('render failed'); } });
    const { host, get } = await serve(h, { dev: true });
    await host.prepare();
    expect((await get('/')).status).toBe(500);
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('render failed'));
  });

  it('attachUpgrade claims only /_next/ upgrades', async () => {
    const h = harness();
    const { host } = await serve(h, { dev: true });
    await host.prepare();
    const server = new EventEmitter() as unknown as http.Server;
    host.attachUpgrade(server);
    const socket = { destroy: vi.fn() };
    server.emit('upgrade', { url: '/_next/webpack-hmr' }, socket, Buffer.alloc(0));
    server.emit('upgrade', { url: '/socket' }, socket, Buffer.alloc(0));
    expect(h.app.upgrades).toEqual(['/_next/webpack-hmr']);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('close calls app.close, and is safe when prepare failed', async () => {
    const h = harness();
    const { host } = await serve(h, { dev: true });
    await host.prepare();
    await host.close();
    expect(h.app.close).toHaveBeenCalledTimes(1);

    const bad = harness();
    bad.loadNext.mockImplementation(() => { throw new Error('x'); });
    const s = await serve(bad, { dev: true });
    await s.host.prepare();
    await expect(s.host.close()).resolves.toBeUndefined();
  });
});
