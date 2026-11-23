import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs } from '../../../oauth2/test/support/login';
import type { LoadNext } from '../../src/web';
import { shadowedPagePaths } from '../../src/pages/shadowed';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';

const fakeNext = (() => ({
  prepare: async () => {},
  getRequestHandler: () => async (_req: unknown, res: any) => {
    res.statusCode = 200;
    res.end('next');
  },
  getUpgradeHandler: () => () => {},
  close: async () => {},
})) as unknown as LoadNext;

function touch(root: string, rel: string) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'export default function P() { return null; }\n');
}

async function signIn(t: CoreTestApp): Promise<string> {
  const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: t.url },
    body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
  });
  expect(setup.status).toBeLessThan(300);
  return `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
}

describe('shadowedPagePaths', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-shadow-'));
    touch(dir, 'app/(site)/page.tsx');
    touch(dir, 'app/(site)/blog/page.tsx');
    touch(dir, 'app/(site)/(marketing)/pricing/page.jsx');
    touch(dir, 'app/(site)/docs/getting-started/page.ts');
    touch(dir, 'app/(site)/[[...path]]/page.tsx');
    touch(dir, 'app/(site)/products/[slug]/page.tsx');
    touch(dir, 'app/(site)/shop/[...rest]/page.tsx');
    touch(dir, 'app/(site)/_private/page.tsx');
    touch(dir, 'app/(site)/%5F_opencloudcms/preview/route.ts');
    touch(dir, 'app/(site)/feed/route.ts');
    touch(dir, 'app/(site)/blog/layout.tsx');
    touch(dir, 'app/(admin)/admin/[[...slug]]/page.tsx');
    touch(dir, 'app/(site)/@modal/login/page.tsx');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists static page.* paths of app/(site): groups and slots stripped, dynamic, private and route handlers ignored', () => {
    expect(shadowedPagePaths(dir)).toEqual(['/', '/blog', '/docs/getting-started', '/login', '/pricing']);
  });

  it('is empty when the directory has no app/(site)', () => {
    expect(shadowedPagePaths(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('GET /api/admin/pages/shadowed', () => {
  let t: CoreTestApp | undefined;
  let dir: string;
  afterAll(async () => {
    await t?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the static file routes of the website (computed at boot), 401 without a session', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-shadow-web-'));
    touch(dir, 'app/(site)/blog/page.tsx');
    touch(dir, 'app/(site)/[[...path]]/page.tsx');
    t = await createCoreTestApp({ web: { enabled: true, dev: false, dir, loadNext: fakeNext } });
    const cookie = await signIn(t);
    // Computed once at boot: a file added later is not listed until restart.
    touch(dir, 'app/(site)/later/page.tsx');

    const r = await fetch(`${t.baseUrl}/api/admin/pages/shadowed`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ data: ['/blog'] });

    expect((await fetch(`${t.baseUrl}/api/admin/pages/shadowed`)).status).toBe(401);
  }, 120_000);

  it('is [] when web.enabled is false', async () => {
    await t?.close();
    t = await createCoreTestApp({ web: { enabled: false } });
    const cookie = await signIn(t);
    const r = await fetch(`${t.baseUrl}/api/admin/pages/shadowed`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: [] });
  }, 120_000);
});
