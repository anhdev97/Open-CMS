import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';

async function boot(opts: Parameters<typeof createCoreTestApp>[0] = {}, withFile = true) {
  const t = await createCoreTestApp(opts);
  if (withFile) {
    fs.mkdirSync(path.join(t.root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'src', 'locales.ts'), '// initial\n');
  }
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
  const put = (body: unknown) => call('/api/admin/locales', { method: 'PUT', body: JSON.stringify(body) });
  return { t, call, put };
}

describe('website locales API', () => {
  let t: CoreTestApp;
  let call: Awaited<ReturnType<typeof boot>>['call'];
  let put: Awaited<ReturnType<typeof boot>>['put'];

  beforeAll(async () => {
    ({ t, call, put } = await boot({ locales: ['en-US', 'vi-VN'], defaultLocale: 'en-US' }));
    const def = defineContentType({ id: 'ct_aaaaaa', apiId: 'note', displayName: 'Note', fields: { title: f.text({ id: 'fld_aaaaaa', localizable: true }) } } as any);
    const saved = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(saved.status).toBe(200);
    const en = await call('/api/admin/content/note?locale=en-US', { method: 'POST', body: JSON.stringify({ title: 'Hello' }) });
    expect(en.status).toBeLessThan(300);
    const vi = await call('/api/admin/content/note?locale=vi-VN', { method: 'POST', body: JSON.stringify({ title: 'Xin chao' }) });
    expect(vi.status).toBeLessThan(300);
  }, 90_000);
  afterAll(async () => {
    await t?.close();
  });

  it('GET reports settings, editable and per-locale entry counts', async () => {
    const body = await (await call('/api/admin/locales')).json();
    expect(body.supported.map((l: { code: string }) => l.code)).toEqual(['en-US', 'vi-VN', 'fr-FR', 'id-ID']);
    expect(body.locales).toEqual(['en-US', 'vi-VN']);
    expect(body.defaultLocale).toBe('en-US');
    expect(body.editable).toBe(true);
    expect(body.entryCounts['en-US']).toBe(1);
    expect(body.entryCounts['vi-VN']).toBe(1);
    expect(body.entryCounts['fr-FR']).toBe(0);
  });

  it('rejects a locale that is not enabled (400 locale_not_enabled), also in fallback', async () => {
    for (const q of ['locale=fr-FR', 'locale=en-US&fallback=id-ID']) {
      const res = await fetch(`${t.baseUrl}/api/content/note?${q}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('locale_not_enabled');
    }
  });

  it('enables fr-FR and a new default without a restart, writing src/locales.ts', async () => {
    const res = await put({ locales: ['en-US', 'vi-VN', 'fr-FR'], defaultLocale: 'vi-VN' });
    expect(res.status).toBe(200);
    const file = fs.readFileSync(path.join(t.root, 'src', 'locales.ts'), 'utf8');
    expect(file).toContain("defaultLocale: 'vi-VN'");
    expect(file).toContain("'fr-FR'");
    expect((await fetch(`${t.baseUrl}/api/content/note?locale=fr-FR`)).status).toBe(200);
    const got = await (await call('/api/admin/locales')).json();
    expect(got.defaultLocale).toBe('vi-VN');
    expect(got.locales).toEqual(['en-US', 'vi-VN', 'fr-FR']);
  });

  it('422 when the default is outside the list or a code is unsupported', async () => {
    expect((await put({ locales: ['en-US'], defaultLocale: 'vi-VN' })).status).toBe(422);
    expect((await put({ locales: ['en-US', 'de-DE'], defaultLocale: 'en-US' })).status).toBe(422);
  });

  it('409 locale_has_entries when removing a locale with entries, 200 with confirmDisable, rows kept', async () => {
    const res = await put({ locales: ['en-US', 'fr-FR'], defaultLocale: 'en-US' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('locale_has_entries');
    expect(body.error.issues).toEqual([{ path: ['vi-VN'], message: '1' }]);
    const ok = await put({ locales: ['en-US', 'fr-FR'], defaultLocale: 'en-US', confirmDisable: ['vi-VN'] });
    expect(ok.status).toBe(200);
    const rows = await t.db.selectFrom('ct_note_l10n').select('locale').execute();
    expect(rows.map((r: any) => r.locale)).toContain('vi-VN');
    expect((await fetch(`${t.baseUrl}/api/content/note?locale=vi-VN`)).status).toBe(400);
  });
});

describe('website locales API, read-only modes', () => {
  it('403 when schemaEditable is false', async () => {
    const { t, call, put } = await boot({ schemaEditable: false });
    try {
      expect((await (await call('/api/admin/locales')).json()).editable).toBe(false);
      expect((await put({ locales: ['en-US'], defaultLocale: 'en-US' })).status).toBe(403);
    } finally {
      await t.close();
    }
  }, 60_000);

  it('editable is false and PUT is 403 without src/locales.ts', async () => {
    const { t, call, put } = await boot({}, false);
    try {
      expect((await (await call('/api/admin/locales')).json()).editable).toBe(false);
      expect((await put({ locales: ['en-US'], defaultLocale: 'en-US' })).status).toBe(403);
    } finally {
      await t.close();
    }
  }, 60_000);
});
