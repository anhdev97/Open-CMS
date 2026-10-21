import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';

async function boot(opts: Parameters<typeof createCoreTestApp>[0] = {}) {
  const t = await createCoreTestApp(opts);
  const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: t.url },
    body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
  });
  expect(setup.status).toBeLessThan(300);
  const login = await loginAs(t, EMAIL, PW);
  const cookie = `oc_session=${login.sessionCookie}`;
  const call = (p: string, init: RequestInit = {}) =>
    fetch(`${t.baseUrl}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', origin: t.url, ...(init.headers as object) } });
  const put = (groups: unknown) => call('/api/admin/content-groups', { method: 'PUT', body: JSON.stringify({ groups }) });
  return { t, call, put };
}

const shop = { key: 'shop', title: { 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' }, order: 10 };

describe('content groups API', () => {
  let t: CoreTestApp;
  let call: Awaited<ReturnType<typeof boot>>['call'];
  let put: Awaited<ReturnType<typeof boot>>['put'];

  beforeAll(async () => {
    ({ t, call, put } = await boot());
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it('starts empty and editable', async () => {
    const res = await call('/api/admin/content-groups');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [], editable: true });
  });

  it('writes src/content-groups.ts and serves the new groups (also in meta)', async () => {
    const res = await put([shop]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [shop] });
    const file = path.join(t.root, 'src', 'content-groups.ts');
    expect(fs.readFileSync(file, 'utf8')).toContain("key: 'shop'");
    expect(await (await call('/api/admin/content-groups')).json()).toEqual({ groups: [shop], editable: true });
    expect((await (await call('/api/admin/meta')).json()).groups).toEqual([shop]);
  });

  it('rejects an invalid slug with 422 and leaves the file alone', async () => {
    const before = fs.readFileSync(path.join(t.root, 'src', 'content-groups.ts'), 'utf8');
    const res = await put([{ key: 'Bad Key', title: { 'en-US': 'x' } }]);
    expect(res.status).toBe(422);
    expect((await res.json()).error.issues.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(t.root, 'src', 'content-groups.ts'), 'utf8')).toBe(before);
  });

  it('rejects an unknown group on a content type', async () => {
    const def = defineContentType({ id: 'ct_aaaaaa', apiId: 'widget', displayName: 'Widget', group: 'nope', fields: { title: f.text({ id: 'fld_aaaaaa' }) } } as any);
    const res = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(await res.json())).toContain('nope');
  });

  it('refuses to drop a group that a content type uses (409 group_in_use)', async () => {
    const def = defineContentType({ id: 'ct_bbbbbb', apiId: 'gadget', displayName: 'Gadget', group: 'shop', fields: { title: f.text({ id: 'fld_bbbbbb' }) } } as any);
    const saved = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(saved.status).toBe(200);
    const res = await put([]);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('group_in_use');
    expect(body.error.issues).toEqual([{ path: ['shop'], message: 'gadget' }]);
    expect((await (await call('/api/admin/content-groups')).json()).groups).toEqual([shop]);
  }, 60_000);
});

describe('content groups API in production mode', () => {
  it('is read-only (403) when schemaEditable is false', async () => {
    const { t, call, put } = await boot({ schemaEditable: false, contentGroups: [shop] });
    try {
      const got = await call('/api/admin/content-groups');
      expect(await got.json()).toEqual({ groups: [shop], editable: false });
      expect((await put([])).status).toBe(403);
    } finally {
      await t.close();
    }
  }, 60_000);
});
