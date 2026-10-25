import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalServerProvider } from '../../src/provider/local.provider';
import type { StorageProvider } from '../../src/provider/storage-provider';
import { AssetsService } from '../../src/nest/assets.service';
import { FoldersService } from '../../src/nest/folders.service';
import type { AssetsModuleOptions } from '../../src/types';
import { FakeDb } from '../support/fake-db';

let root: string;
let db: FakeDb;

const opts = (): AssetsModuleOptions => ({
  provider: 'local',
  local: { root, publicBaseUrl: 'http://localhost:3000/uploads' },
});

const mk = (provider: StorageProvider | null = createLocalServerProvider(opts().local!), o: AssetsModuleOptions | null = opts()) =>
  new AssetsService(db as any, new FoldersService(db as any), provider, o);

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

async function file(buf: Buffer, name = 'Photo.PNG', mimetype = 'image/png') {
  return { buffer: buf, originalname: name, mimetype, size: buf.length };
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-svc-'));
  db = new FakeDb();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('AssetsService.upload', () => {
  it('uploads png and returns variants.original + seo.missingAlt', async () => {
    const res = await mk().upload(await file(await png(2000, 1000)));
    expect(res.seo.missingAlt).toBe(true);
    expect(res.data.mimeType).toBe('image/webp');
    expect(res.data.provider).toBe('local');
    expect(res.data.size).toBeTypeOf('number');
    expect(res.data.variants!.original.key).toBe(res.data.storageKey);
    expect(res.data.variants!.original.url).toBe(res.data.url);
    expect(Object.keys(res.data.variants!).sort()).toEqual(['large', 'medium', 'original', 'thumb']);
    for (const v of Object.values(res.data.variants!)) expect(await exists(path.join(root, v.key))).toBe(true);
    expect(res.data.url).toMatch(/^http:\/\/localhost:3000\/uploads\/\d{4}\/\d{2}\/photo-[0-9a-f]{8}\.webp$/);
  });

  it('missingAlt is false when alt is provided', async () => {
    const res = await mk().upload(await file(await png(10, 10)), { alt: 'A red square' });
    expect(res.data.alt).toBe('A red square');
    expect(res.seo.missingAlt).toBe(false);
  });

  it('rejects files over maxBytes with 413', async () => {
    const o = { ...opts(), limits: { maxBytes: 10 } };
    await expect(mk(createLocalServerProvider(o.local!), o).upload(await file(await png(10, 10)))).rejects.toMatchObject({ status: 413 });
    expect(db.rows).toHaveLength(0);
  });

  it('rejects types outside accept with 415', async () => {
    const o = { ...opts(), limits: { accept: ['image/png'] } };
    const svc = mk(createLocalServerProvider(o.local!), o);
    await expect(svc.upload(await file(Buffer.from('x'), 'a.pdf', 'application/pdf'))).rejects.toMatchObject({ status: 415 });
    await expect(svc.upload(await file(await png(5, 5)))).resolves.toBeDefined();
    const wild = { ...opts(), limits: { accept: ['image/*'] } };
    await expect(mk(createLocalServerProvider(wild.local!), wild).upload(await file(await png(5, 5)))).resolves.toBeDefined();
  });

  it('maps invalid images to 400', async () => {
    await expect(mk().upload(await file(Buffer.from('not an image')))).rejects.toMatchObject({ status: 400 });
  });

  it('maps too-large pixel counts to 400', async () => {
    const big = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(mk().upload(await file(big))).rejects.toMatchObject({ status: 400 });
    expect(db.rows).toHaveLength(0);
  });

  it('stores non-image files untouched', async () => {
    const res = await mk().upload(await file(Buffer.from('%PDF-1.4'), 'Report Q1.pdf', 'application/pdf'));
    expect(res.data.mimeType).toBe('application/pdf');
    expect(res.data.variants!.original.bytes).toBe(8);
    expect(res.seo.missingAlt).toBe(false);
  });

  it('cleans up stored objects when the DB insert fails', async () => {
    db.failInsert = true;
    await expect(mk().upload(await file(await png(10, 10)))).rejects.toThrow('db down');
    expect(await fs.readdir(root, { recursive: true }).then((l) => l.filter((f) => f.endsWith('.webp')))).toEqual([]);
  });

  it('returns 502 and cleans up when storage put fails', async () => {
    const real = createLocalServerProvider(opts().local!);
    let n = 0;
    const flaky: StorageProvider = {
      ...real,
      kind: 'local',
      put: async (k, b, c) => {
        if (++n === 2) throw new Error('disk full');
        return real.put(k, b, c);
      },
      delete: real.delete,
      publicUrl: real.publicUrl,
    };
    await expect(mk(flaky).upload(await file(await png(2000, 1000)))).rejects.toMatchObject({ status: 502 });
    expect(db.rows).toHaveLength(0);
    expect(await fs.readdir(root, { recursive: true }).then((l) => l.filter((f) => f.endsWith('.webp')))).toEqual([]);
  });
});

describe('AssetsService.delete', () => {
  it('delete removes files from disk then the row', async () => {
    const svc = mk();
    const { data } = await svc.upload(await file(await png(2000, 1000)));
    const keys = Object.values(data.variants!).map((v) => v.key);
    expect(keys.length).toBeGreaterThan(1);
    await svc.delete(data.id);
    for (const k of keys) expect(await exists(path.join(root, k))).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it('keeps the row and returns 502 when storage delete fails', async () => {
    const real = createLocalServerProvider(opts().local!);
    const svc = mk({ ...real, kind: 'local', put: real.put, publicUrl: real.publicUrl, delete: async () => { throw new Error('boom'); } });
    const { data } = await svc.upload(await file(await png(10, 10)));
    await expect(svc.delete(data.id)).rejects.toMatchObject({ status: 502 });
    expect(db.rows).toHaveLength(1);
  });

  it('deletes registered (external) assets without touching storage, even with no provider', async () => {
    const svc = mk(null, null);
    const { data } = await svc.register({ filename: 'a.png', url: 'https://cdn.example.com/a.png' });
    await expect(svc.delete(data.id)).resolves.toEqual({ data: { id: data.id } });
    expect(db.rows).toHaveLength(0);
  });

  it('404s on unknown / malformed ids', async () => {
    await expect(mk().delete('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
    await expect(mk().delete('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AssetsService register/list/patch', () => {
  it('registers an external asset (no variants / provider)', async () => {
    const res = await mk(null, null).register({ filename: 'a.png', url: 'https://x/a.png', mimeType: 'image/png', width: 3, height: 4 });
    expect(res.data).toMatchObject({ filename: 'a.png', url: 'https://x/a.png', mimeType: 'image/png', width: 3, height: 4, variants: null, provider: null, storageKey: null, folderId: null });
    expect(res.seo.missingAlt).toBe(true);
  });

  it('requires filename and url', async () => {
    await expect(mk(null, null).register({ filename: 'a' })).rejects.toMatchObject({ status: 400 });
  });

  it('lists newest first and clamps the limit', async () => {
    const svc = mk(null, null);
    await svc.register({ filename: 'one', url: 'u1' });
    await svc.register({ filename: 'two', url: 'u2' });
    expect((await svc.list(50)).data.map((a) => a.filename)).toEqual(['two', 'one']);
    expect((await svc.list(1)).data).toHaveLength(1);
  });

  it('patches alt, clears it on blank, 404s for unknown', async () => {
    const svc = mk(null, null);
    const { data } = await svc.register({ filename: 'a.png', url: 'u', mimeType: 'image/png' });
    const p = await svc.patch(data.id, { alt: 'Hello' });
    expect(p.data.alt).toBe('Hello');
    expect(p.seo.missingAlt).toBe(false);
    expect((await svc.patch(data.id, { alt: '  ' })).seo.missingAlt).toBe(true);
    await expect(svc.patch('00000000-0000-4000-8000-000000000000', { alt: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.patch(data.id, {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('folders + filter + bulk', () => {
  it('creates nested folders and filters assets by folder / root', async () => {
    const folders = new FoldersService(db as any);
    const svc = new AssetsService(db as any, folders, null, null);
    const root = await folders.create({ name: 'Products' });
    const child = await folders.create({ name: 'Phones', parentId: root.data.id });
    expect(child.data.parentId).toBe(root.data.id);
    expect((await folders.list()).data.map((f) => f.slug).sort()).toEqual(['phones', 'products']);

    await svc.register({ filename: 'unfiled', url: 'u0' });
    await svc.register({ filename: 'in-root-folder', url: 'u1', folderId: root.data.id });
    await svc.register({ filename: 'nested', url: 'u2', folderId: child.data.id });

    expect((await svc.list(50)).data).toHaveLength(3);
    expect((await svc.list(50, null)).data.map((a) => a.filename)).toEqual(['unfiled']);
    expect((await svc.list(50, root.data.id)).data.map((a) => a.filename)).toEqual(['in-root-folder']);
    expect((await svc.list(50, child.data.id)).data.map((a) => a.filename)).toEqual(['nested']);
  });

  it('prefixes storage key with folder path on upload', async () => {
    const folders = new FoldersService(db as any);
    const { data: folder } = await folders.create({ name: 'Heroes' });
    const res = await mk().upload(await file(await png(10, 10)), { folderId: folder.id });
    expect(res.data.folderId).toBe(folder.id);
    expect(res.data.storageKey).toMatch(/^heroes\/\d{4}\/\d{2}\//);
  });

  it('bulk move updates folderId; bulk delete removes rows', async () => {
    const folders = new FoldersService(db as any);
    const svc = new AssetsService(db as any, folders, null, null);
    const { data: folder } = await folders.create({ name: 'Docs' });
    const a = await svc.register({ filename: 'a', url: 'ua' });
    const b = await svc.register({ filename: 'b', url: 'ub' });
    await svc.bulk({ action: 'move', ids: [a.data.id, b.data.id], folderId: folder.id });
    expect((await svc.list(50, folder.id)).data).toHaveLength(2);
    await svc.bulk({ action: 'move', ids: [a.data.id], folderId: null });
    expect((await svc.list(50, null)).data.map((x) => x.filename)).toEqual(['a']);
    await svc.bulk({ action: 'delete', ids: [a.data.id, b.data.id] });
    expect((await svc.list(50)).data).toHaveLength(0);
  });

  it('refuses deleting a non-empty folder', async () => {
    const folders = new FoldersService(db as any);
    const svc = new AssetsService(db as any, folders, null, null);
    const { data: folder } = await folders.create({ name: 'Keep' });
    await svc.register({ filename: 'x', url: 'ux', folderId: folder.id });
    await expect(folders.delete(folder.id)).rejects.toMatchObject({ status: 409 });
    await folders.create({ name: 'Child', parentId: folder.id });
    // still has child even after moving asset out
    await svc.bulk({ action: 'move', ids: [(await svc.list(50, folder.id)).data[0].id], folderId: null });
    await expect(folders.delete(folder.id)).rejects.toMatchObject({ status: 409 });
  });

  it('blocks moving a folder into its descendant', async () => {
    const folders = new FoldersService(db as any);
    const a = await folders.create({ name: 'A' });
    const b = await folders.create({ name: 'B', parentId: a.data.id });
    await expect(folders.patch(a.data.id, { parentId: b.data.id })).rejects.toMatchObject({ status: 400 });
  });
});
