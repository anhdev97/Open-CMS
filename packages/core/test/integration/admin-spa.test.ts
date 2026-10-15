import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminSpaHandler } from '../../src/http/admin-spa.middleware';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'admin-dist');

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Sends the request line exactly as given: no URL normalisation (fetch would resolve `..`). */
function raw(base: string, method: string, rawPath: string): Promise<Raw> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(app: express.Express): Promise<{ base: string; close(): void }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => void server.close() }));
  });
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};
const BASE_CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
const sha = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

describe('admin SPA served by OpenCmsModule', () => {
  let t: CoreTestApp;
  beforeAll(async () => {
    t = await createCoreTestApp({ admin: { distDir: FIXTURE } });
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it('redirects /admin to /admin/ with 308', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin');
    expect(r.status).toBe(308);
    expect(r.headers.location).toBe('/admin/');
  });

  it('keeps the query string when redirecting', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin?x=1');
    expect(r.status).toBe(308);
    expect(r.headers.location).toBe('/admin/?x=1');
  });

  it('serves an existing asset as immutable JavaScript', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin/assets/app-abc123.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.body).toContain('admin fixture');
  });

  it('404s a missing asset', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin/assets/nope.js');
    expect(r.status).toBe(404);
    expect(r.body).not.toContain('<div id="root">');
  });

  it('serves index.html for /admin/ and for client-side routes, with no-store and security headers', async () => {
    for (const p of ['/admin/', '/admin/content/product?status=draft']) {
      const r = await raw(t.baseUrl, 'GET', p);
      expect(r.status, p).toBe(200);
      expect(r.body).toContain('<div id="root"></div>');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      for (const [k, v] of Object.entries(SECURITY)) expect(r.headers[k], k).toBe(v);
    }
  });

  it('allows exactly the inline scripts of index.html (and no others) through script-src', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin/');
    expect(r.headers['content-security-policy']).toBe(`${BASE_CSP}; script-src 'self' ${sha('document.documentElement.className="x";')}`);
  });

  it('adds one hash per inline script and none for external scripts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencms-admin-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<script>a()</script><script src="/admin/assets/x.js"></script><script type="module">b()</script>');
      const app = express();
      app.use('/admin', createAdminSpaHandler({ distDir: dir, logger: { warn() {} } }));
      const { base, close } = await listen(app);
      try {
        const r = await raw(base, 'GET', '/admin/');
        expect(r.headers['content-security-policy']).toBe(`${BASE_CSP}; script-src 'self' ${sha('a()')} ${sha('b()')}`);
      } finally {
        await close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers HEAD like GET without a body', async () => {
    const r = await raw(t.baseUrl, 'HEAD', '/admin/content/product');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toBe('');
  });

  it('never returns a file outside the dist directory for traversal attempts', async () => {
    const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
    const name = JSON.parse(pkg).name as string;
    for (const p of ['/admin/%2e%2e/package.json', '/admin/assets/../../package.json', '/admin/assets/%2e%2e/%2e%2e/package.json', '/admin/assets/..%2f..%2fpackage.json', '/admin/..%2fpackage.json', '/admin/assets/%00']) {
      const r = await raw(t.baseUrl, 'GET', p);
      expect(r.body, p).not.toContain(name);
      expect([200, 400, 404], p).toContain(r.status);
      if (r.status === 200) expect(r.body, p).toContain('<div id="root"></div>');
    }
  });

  it('answers other methods with 405', async () => {
    const r = await raw(t.baseUrl, 'POST', '/admin/x');
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('GET, HEAD');
  });

  it('does not require authentication', async () => {
    const r = await raw(t.baseUrl, 'GET', '/admin/');
    expect(r.status).toBe(200);
  });
});

describe('admin SPA edge cases', () => {
  it('404s a symlink under assets/ that points outside the dist directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencms-admin-'));
    const secret = path.join(os.tmpdir(), `opencms-secret-${process.pid}.txt`);
    try {
      fs.cpSync(FIXTURE, dir, { recursive: true });
      fs.writeFileSync(secret, 'TOP-SECRET');
      fs.symlinkSync(secret, path.join(dir, 'assets', 'leak.js'));
      const app = express();
      app.use('/admin', createAdminSpaHandler({ distDir: dir, logger: { warn() {} } }));
      const { base, close } = await listen(app);
      try {
        const leak = await raw(base, 'GET', '/admin/assets/leak.js');
        expect(leak.status).toBe(404);
        expect(leak.body).not.toContain('TOP-SECRET');
        expect((await raw(base, 'GET', '/admin/assets/app-abc123.js')).status).toBe(200);
      } finally {
        close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(secret, { force: true });
    }
  });

  it('answers 503 HTML when index.html is missing and warns only once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencms-admin-empty-'));
    const warn = vi.fn();
    const app = express();
    app.use('/admin', createAdminSpaHandler({ distDir: dir, logger: { warn } }));
    const { base, close } = await listen(app);
    try {
      for (const p of ['/admin/', '/admin/content/x']) {
        const r = await raw(base, 'GET', p);
        expect(r.status).toBe(503);
        expect(r.headers['content-type']).toMatch(/text\/html/);
        expect(r.body).toContain('pnpm build');
        expect(r.body).toContain('Admin UI chưa được build.');
      }
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves 503 from the module when the default dist/admin is absent', async () => {
    const t = await createCoreTestApp();
    try {
      const r = await raw(t.baseUrl, 'GET', '/admin/');
      expect(r.status).toBe(503);
    } finally {
      await t.close();
    }
  }, 60_000);

  it('does not register /admin when admin.enabled is false', async () => {
    const t = await createCoreTestApp({ admin: { enabled: false, distDir: FIXTURE } });
    try {
      const r = await raw(t.baseUrl, 'GET', '/admin/');
      expect(r.status).toBe(404);
      expect(r.body).not.toContain('<div id="root">');
    } finally {
      await t.close();
    }
  }, 60_000);
});
