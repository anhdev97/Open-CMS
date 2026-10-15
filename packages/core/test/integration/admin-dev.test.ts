import { afterAll, describe, expect, it } from 'vitest';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

describe('OPENCMS_ADMIN_DEV', () => {
  let dev: CoreTestApp | undefined;
  let prod: CoreTestApp | undefined;

  afterAll(async () => {
    await dev?.close();
    await prod?.close();
  }, 30_000);

  it('serves the SPA through Vite middleware (index.html and transformed modules)', async () => {
    dev = await createCoreTestApp({ env: { OPENCMS_ADMIN_DEV: '1' } });
    const index = await fetch(`${dev.baseUrl}/admin/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('/@vite/client');

    const main = await fetch(`${dev.baseUrl}/admin/src/main.tsx`);
    expect(main.status).toBe(200);
    expect(main.headers.get('content-type')).toContain('javascript');
  }, 60_000);

  it('does not start Vite without the flag', async () => {
    prod = await createCoreTestApp({ admin: { distDir: '/nonexistent-admin-dist' } });
    const res = await fetch(`${prod.baseUrl}/admin/`);
    expect(await res.text()).not.toContain('/@vite/client');
  });
});
