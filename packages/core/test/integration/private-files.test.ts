import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencloudcms/schema';
import { AssetsService } from '@opencloudcms/assets';
import { UserService } from '@opencloudcms/oauth2';
import { loginAs } from '../../../oauth2/test/support/login';
import { PrivateEntriesService } from '../../src';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
const PDF2 = Buffer.from('%PDF-1.4\n% second\n%%EOF\n', 'latin1');

const invoiceDef = defineContentType({
  id: 'ct_pfinv',
  apiId: 'invoice',
  displayName: 'Invoice',
  private: true,
  fields: {
    code: f.text({ id: 'fld_pfcode', required: true }),
    file: f.asset({ id: 'fld_pffile', accept: ['application/pdf'] }),
    extras: f.asset({ id: 'fld_pfextr', multiple: true }),
  },
} as any);
const receiptDef = defineContentType({
  id: 'ct_pfrec',
  apiId: 'receipt',
  displayName: 'Receipt',
  private: true,
  fields: { file: f.asset({ id: 'fld_pfrfil' }) },
} as any);
const productDef = defineContentType({
  id: 'ct_pfprod',
  apiId: 'product',
  displayName: 'Product',
  fields: { title: f.text({ id: 'fld_pftitl' }), image: f.asset({ id: 'fld_pfimg' }), gallery: f.asset({ id: 'fld_pfgal', multiple: true }) },
} as any);

describe('private files (spec §7, decisions 9 and 15)', () => {
  let t: CoreTestApp;
  const cookies: Record<string, string> = {};
  const privateDir = () => path.join(t.root, 'private-assets');
  const fileOf = (key: string) => path.join(privateDir(), key.slice('private/'.length));

  const as = (who: string | null) => async (p: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { origin: t.url, ...(init.headers as Record<string, string>) };
    if (who) headers.cookie = cookies[who]!;
    if (typeof init.body === 'string') headers['content-type'] = 'application/json';
    const res = await fetch(`${t.baseUrl}${p}`, { ...init, headers });
    const buf = Buffer.from(await res.arrayBuffer());
    let body: any = buf;
    if ((res.headers.get('content-type') ?? '').includes('json')) body = buf.length ? JSON.parse(buf.toString()) : null;
    return { status: res.status, headers: res.headers, body };
  };
  const admin = as('admin');
  const nobody = as('nobody');
  const anon = as(null);
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
  const upload = (apiId: string, field: string, buf: Buffer, filename: string, type: string, who = admin) => {
    const form = new FormData();
    form.append('field', field);
    form.append('file', new Blob([buf], { type }), filename);
    return who(`/api/admin/content/${apiId}/assets`, { method: 'POST', body: form });
  };
  const assetRow = (id: string) => t.db.selectFrom('opencms_assets' as any).selectAll().where('id', '=', id).executeTakeFirst() as Promise<any>;

  beforeAll(async () => {
    t = await createCoreTestApp({ assets: (root) => ({ provider: 'local', local: { root: path.join(root, 'assets'), publicBaseUrl: '/media' } }) });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookies.admin = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    const u = await t.app.get(UserService).create({ email: 'nobody@example.com', name: 'n', password: PW });
    await t.db.deleteFrom('auth_user_groups' as any).where('user_id', '=', u.id).execute();
    cookies.nobody = `oc_session=${(await loginAs(t, 'nobody@example.com', PW)).sessionCookie}`;
    for (const def of [invoiceDef, receiptDef, productDef]) {
      const r = await admin('/api/admin/content-types', json('POST', { definition: def }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('admin upload: content sniffing against the field accept, stored privately, never listed or served statically', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const fake = await upload('invoice', 'file', png, 'invoice.pdf', 'application/pdf');
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('unsupported_file_type');
    expect((await upload('invoice', 'code', PDF, 'a.pdf', 'application/pdf')).status).toBe(400);
    expect((await upload('product', 'image', PDF, 'a.pdf', 'application/pdf')).status).toBe(400);
    expect((await upload('invoice', 'file', PDF, 'a.pdf', 'application/pdf', nobody)).status).toBe(403);

    const up = await upload('invoice', 'file', PDF, 'Invoice 1.pdf', 'application/pdf');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ url: '', mimeType: 'application/pdf', visibility: 'private', ownerApiId: 'invoice', ownerDocumentId: null, filename: 'Invoice 1.pdf' });
    const key = up.body.data.storageKey as string;
    expect(fs.readFileSync(fileOf(key)).equals(PDF)).toBe(true);
    expect(fs.existsSync(path.join(t.root, 'assets', 'private'))).toBe(false);

    const pub = await admin('/api/admin/assets', json('POST', { filename: 'p.png', url: 'https://cdn.example.com/p.png' }));
    expect(pub.status).toBe(201);
    const listed = await admin('/api/admin/assets');
    expect(listed.body.data.map((a: { id: string }) => a.id)).toEqual([pub.body.data.id]);
    expect((await admin(`/api/admin/assets?ids=${up.body.data.id}`)).body.data).toEqual([]);
    expect((await anon(`/api/content/assets?ids=${up.body.data.id}`)).body.data).toEqual([]);
    expect((await admin(`/api/admin/assets/${up.body.data.id}`, json('PATCH', { alt: 'x' }))).status).toBe(404);
    expect((await admin('/api/admin/assets/bulk', json('POST', { action: 'move', ids: [up.body.data.id], folderId: null }))).status).toBeLessThan(300);
    expect((await admin(`/api/admin/assets/${up.body.data.id}`, { method: 'DELETE' })).status).toBe(404);
    for (const guess of [`/media/${key}`, `/media/private-assets/${key.slice(8)}`, `/media/../private-assets/${key.slice(8)}`]) {
      expect((await anon(guess)).status, guess).toBe(404);
    }
  });

  it('entry save attaches the upload; another entry or type cannot take it (422 asset_not_owned)', async () => {
    const up = await upload('invoice', 'file', PDF, 'a.pdf', 'application/pdf');
    const created = await admin('/api/admin/content/invoice', json('POST', { code: 'I-1', file: up.body.data.id }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const docId = created.body.data.documentId as string;
    expect(created.body.data.file).toBe(up.body.data.id);
    expect((await assetRow(up.body.data.id)).owner_document_id).toBe(docId);

    const steal = await admin('/api/admin/content/invoice', json('POST', { code: 'I-2', file: up.body.data.id }));
    expect(steal.status).toBe(422);
    expect(steal.body.error).toMatchObject({ code: 'asset_not_owned', issues: [{ path: 'file' }] });
    const other = await upload('receipt', 'file', PDF, 'r.pdf', 'application/pdf');
    const wrongType = await admin('/api/admin/content/invoice', json('POST', { code: 'I-3', extras: [other.body.data.id] }));
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.code).toBe('asset_not_owned');
    // Saving the same entry again with its own file is fine.
    expect((await admin(`/api/admin/content/invoice/${docId}`, json('PATCH', { code: 'I-1b', file: up.body.data.id }))).status).toBe(200);
  });

  it('public types reject private asset ids (422 asset_private), single and multiple', async () => {
    const up = await upload('invoice', 'file', PDF, 'a.pdf', 'application/pdf');
    const one = await admin('/api/admin/content/product', json('POST', { title: 'x', image: up.body.data.id }));
    expect(one.status).toBe(422);
    expect(one.body.error).toMatchObject({ code: 'asset_private', issues: [{ path: 'image' }] });
    const many = await admin('/api/admin/content/product', json('POST', { title: 'x', gallery: [up.body.data.id] }));
    expect(many.status).toBe(422);
    const ok = await admin('/api/admin/content/product', json('POST', { title: 'x' }));
    const upd = await admin(`/api/admin/content/product/${ok.body.data.documentId}`, json('PATCH', { image: up.body.data.id }));
    expect(upd.status).toBe(422);
    expect(upd.body.error.code).toBe('asset_private');
  });

  it('download needs content.read (403 without, 401 anonymous) and streams as an attachment', async () => {
    const up = await upload('invoice', 'file', PDF, 'Facture é.pdf', 'application/pdf');
    await admin('/api/admin/content/invoice', json('POST', { code: 'D-1', file: up.body.data.id }));
    const url = `/api/admin/assets/${up.body.data.id}/file`;
    expect((await anon(url)).status).toBe(401);
    expect((await nobody(url)).status).toBe(403);
    expect((await nobody(`/api/admin/assets/${up.body.data.id}/link`, { method: 'POST' })).status).toBe(403);
    const ok = await admin(url);
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).equals(PDF)).toBe(true);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''Facture%20%C3%A9.pdf`);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
  });

  it('entry files: metadata of the files an entry owns (content.read; private types only; 404 otherwise)', async () => {
    const a = await upload('invoice', 'file', PDF, 'Main.pdf', 'application/pdf');
    const b = await upload('invoice', 'extras', PDF2, 'Extra.pdf', 'application/pdf');
    const created = await admin('/api/admin/content/invoice', json('POST', { code: 'F-1', file: a.body.data.id, extras: [b.body.data.id] }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const docId = created.body.data.documentId as string;
    // An unattached upload of the same type is not listed.
    await upload('invoice', 'file', PDF, 'Loose.pdf', 'application/pdf');

    const r = await admin(`/api/admin/content/invoice/${docId}/files`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const byName = [...r.body.data].sort((x: any, y: any) => x.filename.localeCompare(y.filename));
    expect(byName).toEqual([
      { id: b.body.data.id, filename: 'Extra.pdf', size: PDF2.length, mime: 'application/pdf' },
      { id: a.body.data.id, filename: 'Main.pdf', size: PDF.length, mime: 'application/pdf' },
    ]);

    expect((await anon(`/api/admin/content/invoice/${docId}/files`)).status).toBe(401);
    expect((await nobody(`/api/admin/content/invoice/${docId}/files`)).status).toBe(403);
    expect((await admin(`/api/admin/content/invoice/00000000-0000-4000-8000-000000000000/files`)).status).toBe(404);
    expect((await admin(`/api/admin/content/receipt/${docId}/files`)).status).toBe(404);
    const prod = await admin('/api/admin/content/product', json('POST', { title: 'P' }));
    expect((await admin(`/api/admin/content/product/${prod.body.data.documentId}/files`)).status).toBe(404);
    expect((await admin(`/api/admin/content/nope/${docId}/files`)).status).toBe(404);
  });

  it('signed links work without a session; tampered or expired tokens are 403', async () => {
    const up = await upload('invoice', 'file', PDF, 'a.pdf', 'application/pdf');
    const link = await admin(`/api/admin/assets/${up.body.data.id}/link`, { method: 'POST' });
    expect(link.status).toBe(201);
    expect(new Date(link.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const ok = await anon(link.body.url);
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).equals(PDF)).toBe(true);

    const token = new URL(link.body.url, t.baseUrl).searchParams.get('token')!;
    const [id, exp, user, mac] = Buffer.from(token, 'base64url').toString().split('.');
    const forged = (e: string) => Buffer.from([id, e, user, mac].join('.')).toString('base64url');
    expect((await anon(`/api/admin/assets/${id}/file?token=${forged(String(Number(exp) + 3600))}`)).status).toBe(403);
    // An expired link: correctly signed by the server's key, but in the past.
    const svc = t.app.get(AssetsService) as any;
    const { signAssetLink } = await import('@opencloudcms/assets');
    const past = signAssetLink(svc.linkKey, id!, user!, Date.now() - 10 * 60_000);
    expect((await anon(`/api/admin/assets/${id}/file?token=${past.token}`)).status).toBe(403);
  });

  it('replacing a file deletes the old one; deleting the entry deletes its files', async () => {
    const a = await upload('invoice', 'file', PDF, 'a.pdf', 'application/pdf');
    const x = await upload('invoice', 'extras', PDF, 'x.pdf', 'application/pdf');
    const created = await admin('/api/admin/content/invoice', json('POST', { code: 'R-1', file: a.body.data.id, extras: [x.body.data.id] }));
    const docId = created.body.data.documentId as string;
    const b = await upload('invoice', 'file', PDF2, 'b.pdf', 'application/pdf');
    const replaced = await admin(`/api/admin/content/invoice/${docId}`, json('PATCH', { file: b.body.data.id }));
    expect(replaced.status).toBe(200);
    expect(await assetRow(a.body.data.id)).toBeUndefined();
    expect(fs.existsSync(fileOf(a.body.data.storageKey))).toBe(false);
    expect((await assetRow(x.body.data.id)).owner_document_id).toBe(docId);

    expect((await admin(`/api/admin/content/invoice/${docId}`, { method: 'DELETE' })).status).toBe(200);
    for (const asset of [b.body.data, x.body.data]) {
      expect(await assetRow(asset.id)).toBeUndefined();
      expect(fs.existsSync(fileOf(asset.storageKey))).toBe(false);
    }
  });

  it('concurrent replaces of the same file keep the file the entry ends up with', async () => {
    const svc = t.app.get(PrivateEntriesService);
    const file = (name: string) => ({ buffer: PDF, filename: name, contentType: 'application/pdf' });
    const created = await svc.create('invoice', { code: 'C-1', file: file('start.pdf') });
    const docId = created.data.documentId as string;
    for (let round = 0; round < 12; round++) {
      // Uploads first, so that both saves race on the entry row only.
      const ups = await Promise.all([1, 2, 3].map((n) => upload('invoice', 'file', PDF, `r${round}-${n}.pdf`, 'application/pdf')));
      const results = await Promise.all(ups.map((u) => admin(`/api/admin/content/invoice/${docId}`, json('PATCH', { file: u.body.data.id }))));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const live = (await admin(`/api/admin/content/invoice/${docId}`)).body.data.file as string;
      const row = await assetRow(live);
      expect(row, `round ${round}: live file row`).toMatchObject({ owner_document_id: docId });
      expect(fs.existsSync(fileOf(row.storage_key)), `round ${round}: live file on disk`).toBe(true);
      for (const u of ups) {
        if (u.body.data.id === live) continue;
        expect(await assetRow(u.body.data.id), `round ${round}: replaced row`).toBeUndefined();
        expect(fs.existsSync(fileOf(u.body.data.storageKey))).toBe(false);
      }
    }
  });

  it('PrivateEntriesService accepts { buffer, filename, contentType } and stores the file privately, owned at once', async () => {
    const svc = t.app.get(PrivateEntriesService);
    const r = await svc.create('invoice', { code: 'S-1', file: { buffer: PDF, filename: 'server.pdf', contentType: 'application/pdf' } });
    const assetId = r.data.file as string;
    const row = await assetRow(assetId);
    expect(row).toMatchObject({ visibility: 'private', url: '', owner_api_id: 'invoice', owner_document_id: r.data.documentId, filename: 'server.pdf' });
    expect(fs.readFileSync(fileOf(row.storage_key)).equals(PDF)).toBe(true);

    const u = await svc.update('invoice', r.data.documentId as string, { extras: [{ buffer: PDF2, filename: 'e.pdf', contentType: 'application/pdf' }] });
    expect((u.data.extras as string[]).length).toBe(1);
    expect((await assetRow((u.data.extras as string[])[0]!)).owner_document_id).toBe(r.data.documentId);

    // Type check by content; a failed upload leaves nothing behind.
    const before = (await sql<{ n: number }>`select count(*)::int as n from opencms_assets`.execute(t.db)).rows[0]!.n;
    await expect(svc.create('invoice', { code: 'S-2', file: { buffer: Buffer.from('hello'), filename: 'x.pdf', contentType: 'application/pdf' } })).rejects.toMatchObject({ status: 415 });
    // A save that fails after the upload removes the uploaded file.
    await expect(svc.create('invoice', { code: 42 as never, file: { buffer: PDF, filename: 'y.pdf', contentType: 'application/pdf' } })).rejects.toMatchObject({ status: 400 });
    expect((await sql<{ n: number }>`select count(*)::int as n from opencms_assets`.execute(t.db)).rows[0]!.n).toBe(before);
  });

  it('the sweeper removes a 25 h old unattached upload and keeps attached and recent ones', async () => {
    const old = await upload('invoice', 'file', PDF, 'old.pdf', 'application/pdf');
    const recent = await upload('invoice', 'file', PDF, 'new.pdf', 'application/pdf');
    const kept = await upload('invoice', 'file', PDF, 'kept.pdf', 'application/pdf');
    await admin('/api/admin/content/invoice', json('POST', { code: 'W-1', file: kept.body.data.id }));
    await t.db
      .updateTable('opencms_assets' as any)
      .set({ created_at: sql`now() - interval '25 hours'` })
      .where('id', 'in', [old.body.data.id, kept.body.data.id])
      .execute();
    const swept = await t.app.get(AssetsService).sweepUnattachedPrivateAssets();
    expect(swept).toContain(old.body.data.id);
    expect(swept).not.toContain(recent.body.data.id);
    expect(swept).not.toContain(kept.body.data.id);
    expect(await assetRow(old.body.data.id)).toBeUndefined();
    expect(fs.existsSync(fileOf(old.body.data.storageKey))).toBe(false);
    expect(await assetRow(recent.body.data.id)).toBeDefined();
    expect(await assetRow(kept.body.data.id)).toBeDefined();
  });
});
