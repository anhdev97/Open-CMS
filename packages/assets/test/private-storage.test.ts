import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ForbiddenException, Global, Module, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY, OAUTH2_CONFIG, REQUIRED_PERMISSIONS_KEY } from '@opencloudcms/oauth2';
import { AssetsModule } from '../src/nest/assets.module';
import { AssetsService } from '../src/nest/assets.service';
import { createLocalServerProvider } from '../src/provider/local.provider';
import { createS3Provider } from '../src/provider/s3.provider';
import { createGcsProvider } from '../src/provider/gcs.provider';
import { FakeDb } from './support/fake-db';

const DB = Symbol('DB');
const USER = '5f0e9e1e-6c0e-4d6b-9c0a-1b2c3d4e5f60';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');

let app: INestApplication | undefined;
let dir: string | undefined;

const read = async (s: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('latin1');
};

/** Stand-in for AuthGuard's permission step: a request with a user must hold the handler's permissions. */
class PermGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const r = new Reflector();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (r.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const user = ctx.switchToHttp().getRequest().user as { permissions: string[] } | undefined;
    for (const p of r.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? []) {
      if (user && !user.permissions.includes(p)) throw new ForbiddenException(`Missing permission: ${p}`);
    }
    return true;
  }
}

/** `x-perms` header → `req.user` (stands in for the session guard); no header = anonymous. */
async function boot() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-private-'));
  const root = path.join(dir, 'public');
  const db = new FakeDb();
  @Global()
  @Module({
    providers: [
      { provide: DB, useValue: db },
      { provide: OAUTH2_CONFIG, useValue: { secret: randomBytes(32) } },
      { provide: APP_GUARD, useClass: PermGuard },
    ],
    exports: [DB, OAUTH2_CONFIG],
  })
  class DbModule {}
  const mod = await Test.createTestingModule({
    imports: [DbModule, AssetsModule.forRoot({ dbToken: DB, assets: { provider: 'local', local: { root, publicBaseUrl: '/media' } } })],
  }).compile();
  app = mod.createNestApplication();
  app.use((req: any, _res: unknown, next: () => void) => {
    const p = req.headers['x-perms'];
    if (typeof p === 'string') req.user = { id: USER, permissions: p ? p.split(',') : [] };
    next();
  });
  await app.init();
  const service = app.get(AssetsService);
  return { server: app.getHttpServer(), db, root, service };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('storage providers: private keys and get()', () => {
  it('local: private files live in <root>/../private-assets, outside the static root; get() streams', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-local-'));
    const root = path.join(d, 'public');
    const p = createLocalServerProvider({ root, publicBaseUrl: '/media' });
    await p.put('private/order/abc', Buffer.from('secret'), 'application/pdf', 'private');
    await p.put('2026/01/a.txt', Buffer.from('hello'), 'text/plain');
    expect(fs.existsSync(path.join(d, 'private-assets', 'order', 'abc'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'private'))).toBe(false);
    expect(await read(await p.get('private/order/abc', 'private'))).toBe('secret');
    expect(await read(await p.get('2026/01/a.txt'))).toBe('hello');
    await expect(p.get('private/order/missing', 'private')).rejects.toMatchObject({ code: 'ENOENT' });
    await p.delete('private/order/abc', 'private');
    expect(fs.existsSync(path.join(d, 'private-assets', 'order', 'abc'))).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('local: storage follows the explicit visibility, not the key (a public key may start with private/)', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-local-'));
    const root = path.join(d, 'public');
    const p = createLocalServerProvider({ root, publicBaseUrl: '/media' });
    await p.put('private/legacy.webp', Buffer.from('pub'), 'image/webp');
    expect(fs.readFileSync(path.join(root, 'private', 'legacy.webp')).toString()).toBe('pub');
    expect(fs.existsSync(path.join(d, 'private-assets', 'legacy.webp'))).toBe(false);
    expect(await read(await p.get('private/legacy.webp'))).toBe('pub');
    await p.delete('private/legacy.webp');
    expect(fs.existsSync(path.join(root, 'private', 'legacy.webp'))).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('local: privateRoot overrides the default directory and may not overlap root, also through symlinks', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-local-'));
    const p = createLocalServerProvider({ root: path.join(d, 'pub'), publicBaseUrl: '/media', privateRoot: path.join(d, 'vault') });
    await p.put('private/x/y', Buffer.from('1'), 'text/plain', 'private');
    expect(fs.existsSync(path.join(d, 'vault', 'x', 'y'))).toBe(true);

    const make = (root: string, privateRoot: string) => () => createLocalServerProvider({ root, publicBaseUrl: '/media', privateRoot });
    expect(make(path.join(d, 'pub'), path.join(d, 'pub', 'secret'))).toThrow(/must not contain each other/);
    expect(make(path.join(d, 'vault', 'pub'), path.join(d, 'vault'))).toThrow(/must not contain each other/);
    expect(make(path.join(d, 'pub'), path.join(d, 'pub'))).toThrow(/must not contain each other/);
    // A symlink that points into the static root.
    fs.mkdirSync(path.join(d, 'pub'), { recursive: true });
    fs.symlinkSync(path.join(d, 'pub'), path.join(d, 'link-to-pub'));
    expect(make(path.join(d, 'pub'), path.join(d, 'link-to-pub', 'private'))).toThrow(/must not contain each other/);
    fs.symlinkSync(path.join(d, 'vault'), path.join(d, 'link-to-vault'));
    expect(make(path.join(d, 'link-to-vault', 'pub'), path.join(d, 'vault'))).toThrow(/must not contain each other/);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('s3 and gcs: get() returns the object body stream', async () => {
    const send = vi.fn().mockResolvedValue({ Body: Readable.from([Buffer.from('s3-bytes')]) });
    const s3 = createS3Provider({ bucket: 'b', region: 'r' }, { client: { send } });
    expect(await read(await s3.get('private/o/k'))).toBe('s3-bytes');
    const cmd = send.mock.calls[0]![0];
    expect(cmd.constructor.name).toBe('GetObjectCommand');
    expect(cmd.input).toEqual({ Bucket: 'b', Key: 'private/o/k' });

    const file = vi.fn().mockReturnValue({ createReadStream: () => Readable.from([Buffer.from('gcs-bytes')]), save: vi.fn(), delete: vi.fn() });
    const gcs = createGcsProvider({ bucket: 'b' }, { bucket: { file } });
    expect(await read(await gcs.get('private/o/k'))).toBe('gcs-bytes');
    expect(file).toHaveBeenCalledWith('private/o/k');
  });
});

describe('private assets over HTTP', () => {
  it('a private upload is stored outside the static root, has no URL and is not listed anywhere', async () => {
    const { server, db, root, service } = await boot();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer();
    const pub = await request(server).post('/api/admin/assets/upload').attach('file', png, { filename: 'p.png', contentType: 'image/png' });
    expect(pub.status).toBe(201);

    const priv = await service.uploadPrivate({ buffer: PDF, filename: 'Invoice #1.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order', accept: ['application/pdf'] });
    expect(priv).toMatchObject({ url: '', mimeType: 'application/pdf', visibility: 'private', ownerApiId: 'order', ownerDocumentId: null, filename: 'Invoice #1.pdf' });
    expect(priv.storageKey).toMatch(/^private\/order\//);
    const row = db.rows.find((r) => r.id === priv.id)!;
    expect(row.visibility).toBe('private');

    const listed = await request(server).get('/api/admin/assets');
    expect(listed.body.data.map((a: { id: string }) => a.id)).toEqual([pub.body.data.id]);
    expect((await request(server).get('/api/admin/assets?folderId=root')).body.data).toHaveLength(1);
    expect((await request(server).get(`/api/admin/assets?ids=${priv.id},${pub.body.data.id}`)).body.data.map((a: { id: string }) => a.id)).toEqual([pub.body.data.id]);
    expect((await request(server).patch(`/api/admin/assets/${priv.id}`).send({ alt: 'x' })).status).toBe(404);
    expect((await request(server).delete(`/api/admin/assets/${priv.id}`)).status).toBe(404);
    expect((await request(server).post('/api/admin/assets/bulk').send({ action: 'delete', ids: [priv.id] })).status).toBe(404);
    expect(db.rows.some((r) => r.id === priv.id)).toBe(true);
    expect((await service.publicByIds([priv.id])).data).toEqual([]);

    // Anonymous guesses at the static path: the file is not under the static root, and any path with a
    // `private` segment is refused outright.
    expect(fs.readdirSync(root).includes('private')).toBe(false);
    for (const guess of [`/media/${priv.storageKey}`, `/media/../private-assets/${priv.storageKey!.slice('private/'.length)}`, '/media/private-assets/order/x', '/media/PRIVATE/x']) {
      expect((await request(server).get(guess)).status, guess).toBe(404);
    }
  });

  it('rejects a PNG named .pdf for a PDF-only field (415) and files over maxBytes (413)', async () => {
    const { service } = await boot();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer();
    await expect(service.uploadPrivate({ buffer: png, filename: 'invoice.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order', accept: ['application/pdf'] })).rejects.toMatchObject({ status: 415 });
    await expect(service.uploadPrivate({ buffer: Buffer.alloc(10_485_761, 0x41), filename: 'big.txt', contentType: 'text/plain' }, { ownerApiId: 'order' })).rejects.toMatchObject({ status: 413 });
  });

  it('download: 401 anonymous, 403 without content.read, 200 attachment stream with it', async () => {
    const { server, service } = await boot();
    const a = await service.uploadPrivate({ buffer: PDF, filename: 'Rechnung ä.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    expect((await request(server).get(`/api/admin/assets/${a.id}/file`)).status).toBe(401);
    expect((await request(server).get(`/api/admin/assets/${a.id}/file`).set('x-perms', 'content.update')).status).toBe(403);
    const ok = await request(server).get(`/api/admin/assets/${a.id}/file`).set('x-perms', 'content.read').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).equals(PDF)).toBe(true);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''Rechnung%20%C3%A4.pdf`);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['cache-control']).toBe('private, no-store');
    expect(ok.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    // Public assets and unknown ids have no download route.
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer();
    const pub = await request(server).post('/api/admin/assets/upload').attach('file', png, { filename: 'p.png', contentType: 'image/png' });
    expect((await request(server).get(`/api/admin/assets/${pub.body.data.id}/file`).set('x-perms', 'content.read')).status).toBe(404);
    expect((await request(server).get('/api/admin/assets/not-a-uuid/file').set('x-perms', 'content.read')).status).toBe(404);
  });

  it('signed links: content.read issues { url, expiresAt }; the token works without a session; tampered or expired → 403', async () => {
    const { server, service } = await boot();
    const a = await service.uploadPrivate({ buffer: PDF, filename: 'a.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    expect((await request(server).post(`/api/admin/assets/${a.id}/link`).set('x-perms', '')).status).toBe(403);
    const link = await request(server).post(`/api/admin/assets/${a.id}/link`).set('x-perms', 'content.read');
    expect(link.status).toBe(201);
    expect(link.body.url).toMatch(new RegExp(`^/api/admin/assets/${a.id}/file\\?token=[A-Za-z0-9_-]+$`));
    const exp = new Date(link.body.expiresAt).getTime();
    expect(exp - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(exp - Date.now()).toBeLessThanOrEqual(5 * 60_000);

    const ok = await request(server).get(link.body.url);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toMatch(/^attachment;/);

    const token = new URL(link.body.url, 'http://x').searchParams.get('token')!;
    const [id, expS, user, mac] = Buffer.from(token, 'base64url').toString().split('.');
    const tampered = Buffer.from([id, String(Number(expS) + 600), user, mac].join('.')).toString('base64url');
    expect((await request(server).get(`/api/admin/assets/${a.id}/file?token=${tampered}`)).status).toBe(403);
    expect((await request(server).get(`/api/admin/assets/${a.id}/file?token=garbage`)).status).toBe(403);
    const b = await service.uploadPrivate({ buffer: PDF, filename: 'b.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    expect((await request(server).get(`/api/admin/assets/${b.id}/file?token=${token}`)).status).toBe(403);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(exp + 1000);
      expect((await request(server).get(link.body.url)).status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stores active types: HTML, SVG and XML are kept as text/plain', async () => {
    const { service } = await boot();
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/xml']) {
      expect((await service.uploadPrivate({ buffer: html, filename: 'x', contentType: type }, { ownerApiId: 'order' })).mimeType, type).toBe('text/plain');
    }
    expect((await service.uploadPrivate({ buffer: html, filename: 'x.html', contentType: 'text/html' }, { ownerApiId: 'order', accept: ['text/html'] })).mimeType).toBe('text/plain');
    expect((await service.uploadPrivate({ buffer: Buffer.from('a,b\n'), filename: 'x.csv', contentType: 'text/csv' }, { ownerApiId: 'order' })).mimeType).toBe('text/csv');
  });

  it('deletePrivate only deletes a row still owned as expected (row first, then the file)', async () => {
    const { db, service } = await boot();
    const DOC = '0a4c5d64-73b2-4d55-8b3c-8bb4b0f7f0a2';
    const a = await service.uploadPrivate({ buffer: PDF, filename: 'a.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    const file = path.join(dir!, 'private-assets', a.storageKey!.slice('private/'.length));
    // Attached meanwhile: a delete that expected it unattached is a no-op and the file stays.
    db.rows.find((r) => r.id === a.id)!.owner_document_id = DOC;
    expect(await service.deletePrivate(a.id, { ownerDocumentId: null })).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    expect(await service.deletePrivate(a.id, { ownerDocumentId: '7d1b6c1e-0f43-4c39-9d0e-2b9a3f3b8f11' })).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    expect(await service.deletePrivate(a.id, { ownerDocumentId: DOC })).toBe(true);
    expect(db.rows.some((r) => r.id === a.id)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('sweeper deletes unattached private uploads older than 24 h (file and row) and keeps the rest', async () => {
    const { db, service } = await boot();
    const old = await service.uploadPrivate({ buffer: PDF, filename: 'old.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    const fresh = await service.uploadPrivate({ buffer: PDF, filename: 'new.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    const owned = await service.uploadPrivate({ buffer: PDF, filename: 'own.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order', ownerDocumentId: '0a4c5d64-73b2-4d55-8b3c-8bb4b0f7f0a2' });
    const now = new Date();
    for (const a of [old, owned]) db.rows.find((r) => r.id === a.id)!.created_at = new Date(now.getTime() - 25 * 3600_000);
    db.rows.find((r) => r.id === fresh.id)!.created_at = new Date(now.getTime() - 23 * 3600_000);
    const oldFile = path.join(dir!, 'private-assets', old.storageKey!.slice('private/'.length));
    expect(fs.existsSync(oldFile)).toBe(true);

    // An upload attached between listing and deleting is kept: the sweep is one conditional delete.
    const raced = await service.uploadPrivate({ buffer: PDF, filename: 'raced.pdf', contentType: 'application/pdf' }, { ownerApiId: 'order' });
    const racedRow = db.rows.find((r) => r.id === raced.id)!;
    racedRow.created_at = new Date(now.getTime() - 25 * 3600_000);
    racedRow.owner_document_id = '0a4c5d64-73b2-4d55-8b3c-8bb4b0f7f0a2';

    expect(await service.sweepUnattachedPrivateAssets(now)).toEqual([old.id]);
    expect(db.rows.map((r) => r.id).sort()).toEqual([fresh.id, owned.id, raced.id].sort());
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(dir!, 'private-assets', raced.storageKey!.slice('private/'.length)))).toBe(true);
  });
});
