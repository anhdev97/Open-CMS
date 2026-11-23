import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffSchemas, executeStatement, loadDefinitions, planMigration } from '@opencloudcms/codegen';
import { resolveConfig, defineContentType, f } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';
import { pageType } from '../../src/pages/page.type';

const PW = 'correct horse battery';
const API = '/api/admin/content/opencloudcmsPage';

describe('core-owned opencloudcmsPage type', () => {
  let t: CoreTestApp;
  let cookie: string;

  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { cookie, 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const create = (body: unknown, locale = 'en-US') => call(`${API}?locale=${locale}`, { method: 'POST', body: JSON.stringify(body) });

  beforeAll(async () => {
    t = await createCoreTestApp({ locales: ['en-US', 'vi-VN'] });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it('migration creates both tables', async () => {
    const r = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'ct_opencloudcms_page%' order by 1`.execute(t.db);
    expect(r.rows.map((x) => x.table_name)).toEqual(['ct_opencloudcms_page', 'ct_opencloudcms_page_l10n']);
  });

  it('migration matches what codegen DDL produces for pageType (no drift)', async () => {
    const plan = planMigration(diffSchemas([], [pageType]).operations, '20260101000000');
    const snapshot = async (schema: string) => {
      const cols = await sql<any>`select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
        from information_schema.columns where table_schema = ${schema} order by table_name, column_name`.execute(t.db);
      const idx = await sql<{ indexdef: string }>`select indexdef from pg_indexes where schemaname = ${schema} order by indexname`.execute(t.db);
      return { cols: cols.rows, idx: idx.rows.map((r) => r.indexdef.replace(new RegExp(`\\b${schema}\\.`, 'g'), '')) };
    };
    const migrated = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema='public' and table_name like 'ct_opencloudcms_page%'`.execute(t.db);
    expect(migrated.rows.length).toBe(2);
    await sql`create schema drift_check`.execute(t.db);
    await t.db.connection().execute(async (c) => {
      await sql`set search_path to drift_check`.execute(c);
      for (const s of plan.up) await executeStatement(c, s);
      await sql`set search_path to public`.execute(c);
    });
    const [a, b] = [await snapshot('public'), await snapshot('drift_check')];
    const only = (s: typeof a) => ({ cols: s.cols.filter((c: any) => String(c.table_name).startsWith('ct_opencloudcms_page')), idx: s.idx.filter((i) => i.includes('ct_opencloudcms_page')) });
    expect(only(b)).toEqual(only(a));
    expect(only(b).cols.length).toBeGreaterThan(10);
    await sql`drop schema drift_check cascade`.execute(t.db);
  });

  it('is hidden from the content type list but stays addressable', async () => {
    const meta = await call('/api/admin/meta');
    expect(JSON.stringify(meta.body)).not.toContain('opencloudcmsPage');
    const list = await call('/api/admin/content-types');
    expect(list.status).toBe(200);
    expect(list.body.data.map((d: any) => d.apiId)).not.toContain('opencloudcmsPage');
  });

  it('CRUD + publish works and draft responses expose updatedAt', async () => {
    const c = await create({ title: 'Home', path: '/', content: { format: 'puck', formatVersion: 1, data: { root: {}, content: [] } } });
    expect(c.status).toBe(201);
    const id = c.body.data.documentId;
    expect(typeof c.body.data.updatedAt).toBe('string');
    const pub = await call(`${API}/${id}/publish`, { method: 'POST' });
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');
    const live = await fetch(`${t.baseUrl}/api/content/opencloudcmsPage/${id}`);
    expect(live.status).toBe(200);
    expect((await call(`${API}/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('same path twice in one locale fails, in two locales succeeds', async () => {
    const a = await create({ title: 'A', path: '/dup' });
    expect(a.status).toBe(201);
    const b = await create({ title: 'B', path: '/dup' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('unique_violation');
    expect(b.body.error.issues).toEqual([{ path: ['path'], message: 'already used' }]);
    const dupDraft = await create({ title: 'B', path: '/dup' }, 'vi-VN');
    expect(dupDraft.status).toBe(201);
  });

  it('a published row alone does not block a draft with the same path; a draft collides only with another draft (unique per locale and status)', async () => {
    const a = await create({ title: 'X', path: '/x' });
    expect((await call(`${API}/${a.body.data.documentId}/publish`, { method: 'POST' })).status).toBe(200);
    // A's own draft row still holds /x, so a new draft collides with it, not with the published row.
    const b = await create({ title: 'X2', path: '/x' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('unique_violation');
    // Free the draft path of A: the published row alone no longer blocks a new draft.
    expect((await call(`${API}/${a.body.data.documentId}`, { method: 'PUT', body: JSON.stringify({ path: '/x-old' }) })).status).toBe(200);
    const c = await create({ title: 'X3', path: '/x' });
    expect(c.status).toBe(201);
  });

  it('publishing a page whose path is held by another published row in the same locale -> 409 unique_violation', async () => {
    const a = await create({ title: 'PA', path: '/pub' });
    const aId = a.body.data.documentId;
    expect((await call(`${API}/${aId}/publish`, { method: 'POST' })).status).toBe(200);
    expect((await call(`${API}/${aId}`, { method: 'PUT', body: JSON.stringify({ path: '/pub-old' }) })).status).toBe(200);
    const b = await create({ title: 'PB', path: '/pub' });
    expect(b.status).toBe(201);
    const res = await call(`${API}/${b.body.data.documentId}/publish`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('unique_violation');
    expect(res.body.error.issues).toEqual([{ path: ['path'], message: 'already used' }]);
  });

  it('rejects reserved and malformed paths with 422', async () => {
    const reserved = await create({ title: 'x', path: '/admin' });
    expect(reserved.status).toBe(422);
    expect(reserved.body.error.code).toBe('path_reserved');
    const bad = await create({ title: 'x', path: '/A_b' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('invalid_path');
    const id = (await create({ title: 'ok', path: '/okpath' })).body.data.documentId;
    const upd = await call(`${API}/${id}`, { method: 'PUT', body: JSON.stringify({ path: '/api/x' }) });
    expect(upd.status).toBe(422);
    expect(upd.body.error.code).toBe('path_reserved');
  });

  it('If-Match: stale -> 409 stale_draft, current -> 200, absent -> 200', async () => {
    const c = await create({ title: 'Opt', path: '/opt' });
    const id = c.body.data.documentId;
    const first = c.body.data.updatedAt as string;
    const put = (body: unknown, ifMatch?: string) =>
      call(`${API}/${id}`, { method: 'PUT', body: JSON.stringify(body), headers: ifMatch ? { 'if-match': ifMatch } : {} });

    const ok = await put({ title: 'Opt 2' }, first);
    expect(ok.status).toBe(200);
    expect(ok.body.data.title).toBe('Opt 2');
    const next = ok.body.data.updatedAt as string;
    expect(next).not.toBe(first);

    const stale = await put({ title: 'Opt 3' }, first);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_draft');
    expect((await call(`${API}/${id}`)).body.data.title).toBe('Opt 2');

    expect((await put({ title: 'Opt 4' }, next)).status).toBe(200);
    expect((await put({ title: 'Opt 5' })).status).toBe(200);
  });

  it('the schema builder refuses core apiIds with 409 core_type', async () => {
    const def = { ...pageType, displayName: 'Hacked' };
    const save = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(save.status).toBe(409);
    expect(save.body.error.code).toBe('core_type');
    const plan = await call('/api/admin/content-types/plan', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(plan.status).toBe(409);
    expect(plan.body.error.code).toBe('core_type');
    const renamed = defineContentType({ id: pageType.id, apiId: 'somethingElse', displayName: 'x', fields: { a: f.text({ id: 'fld_zz' }) } } as any);
    expect((await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: renamed }) })).status).toBe(409);
    expect((await call(`/api/admin/content-types/${pageType.id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('a project schema file with apiId opencloudcmsPage fails to load', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-reserved-'));
    try {
      const dir = path.join(root, 'src', 'content-types', 'page');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'page.schema.ts'), `export default { id: 'ct_mine', apiId: 'opencloudcmsPage', displayName: 'Mine', fields: [] };\n`);
      const config = resolveConfig({ database: { url: 'postgres://x' } }, root);
      await expect(loadDefinitions(config)).rejects.toThrow('apiId "opencloudcmsPage" is reserved by OpenCloudCMS');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
