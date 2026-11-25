import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  const put = (body: unknown) => call('/api/admin/theme', { method: 'PUT', body: JSON.stringify(body) });
  return { t, call, put };
}

const theme = {
  colors: { surface: { label: 'Surface' }, ink: {} },
  palettes: { olive: { label: 'Olive', values: { surface: '#f5f5dc', ink: '#222' } } },
  activePalette: 'olive',
};

describe('theme API (editable)', () => {
  let t: CoreTestApp;
  let call: Awaited<ReturnType<typeof boot>>['call'];
  let put: Awaited<ReturnType<typeof boot>>['put'];
  beforeAll(async () => {
    ({ t, call, put } = await boot());
  }, 90_000);
  afterAll(async () => {
    await t?.close();
  });

  it('GET with no file returns a null theme', async () => {
    const res = await call('/api/admin/theme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: null, editable: true });
  });

  it('422 for an invalid hex with the issue path, and nothing is written', async () => {
    const bad = { ...theme, palettes: { olive: { values: { surface: 'red', ink: '#222' } } } };
    const res = await put(bad);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.issues).toContainEqual(expect.objectContaining({ path: ['palettes', 'olive', 'values', 'surface'] }));
    expect(fs.existsSync(path.join(t.root, 'src', 'theme.ts'))).toBe(false);
  });

  it('PUT writes the file and GET returns it', async () => {
    const res = await put(theme);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme, editable: true });
    expect(fs.readFileSync(path.join(t.root, 'src', 'theme.ts'), 'utf8')).toContain('defineTheme');
    expect((await (await call('/api/admin/theme')).json()).theme).toEqual(theme);
  });

  it('two concurrent PUTs both succeed and the file ends equal to one of the bodies', async () => {
    const mk = (v: string) => ({ ...theme, palettes: { olive: { values: { surface: v, ink: '#222' } } } });
    try {
      const [a, b] = await Promise.all([put(mk('#111111')), put(mk('#222222'))]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const final = (await (await call('/api/admin/theme')).json()).theme;
      expect([mk('#111111'), mk('#222222')]).toContainEqual(final);
    } finally {
      await put(theme);
    }
  });

  it('GET returns 500 with the issues when the file is hand-broken', async () => {
    const file = path.join(t.root, 'src', 'theme.ts');
    const good = fs.readFileSync(file);
    fs.writeFileSync(file, "export default { colors: {}, palettes: {}, activePalette: 'nope' };\n");
    const res = await call('/api/admin/theme');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain('activePalette');
    fs.writeFileSync(file, good);
  });
});

describe('theme API (not editable)', () => {
  let t: CoreTestApp;
  let put: Awaited<ReturnType<typeof boot>>['put'];
  let call: Awaited<ReturnType<typeof boot>>['call'];
  beforeAll(async () => {
    ({ t, put, call } = await boot({ schemaEditable: false }));
  }, 90_000);
  afterAll(async () => {
    await t?.close();
  });

  it('PUT is 403 and GET reports editable false', async () => {
    expect((await put(theme)).status).toBe(403);
    expect((await (await call('/api/admin/theme')).json()).editable).toBe(false);
  });
});
