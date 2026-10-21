import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadNext } from '../../src/web';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

function fakeNext() {
  const close = vi.fn(async () => {});
  const loadNext = vi.fn(() => ({
    prepare: async () => {},
    getRequestHandler: () => async (req: any, res: any) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end(`next:${req.url}`);
    },
    getUpgradeHandler: () => () => {},
    close,
  })) as unknown as LoadNext & ReturnType<typeof vi.fn>;
  return { loadNext, close };
}

describe('web host mounted in OpenCmsModule', () => {
  let t: CoreTestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });
  const get = (p: string) => fetch(`${t!.baseUrl}${p}`);

  it('serves non-backend paths from Next, keeps /api in Nest, closes Next on shutdown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-web-'));
    const { loadNext, close } = fakeNext();
    t = await createCoreTestApp({ web: { enabled: true, dev: true, dir, loadNext } });

    const root = await get('/');
    expect(root.status).toBe(200);
    expect(await root.text()).toBe('next:/');

    const admin = await get('/admin/x');
    expect(await admin.text()).toBe('next:/admin/x');
    expect(admin.headers.get('content-security-policy')).toMatch(/nonce-/);

    const nope = await get('/api/nope');
    expect(nope.status).toBe(404);
    expect(((await nope.json()) as any).error.code).toBeTruthy();

    const me = await get('/api/auth/me');
    expect(me.status).toBe(409);
    expect(JSON.stringify(await me.json())).toContain('setup_required');

    expect(close).not.toHaveBeenCalled();
    await t.close();
    t = undefined;
    expect(close).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('is off by default: Nest answers 404 and Next is never loaded', async () => {
    const { loadNext } = fakeNext();
    t = await createCoreTestApp({ web: { enabled: false, loadNext } });
    expect((await get('/')).status).toBe(404);
    expect(loadNext).not.toHaveBeenCalled();
    await t.close();
    t = await createCoreTestApp();
    expect((await get('/')).status).toBe(404);
  }, 60_000);
});
