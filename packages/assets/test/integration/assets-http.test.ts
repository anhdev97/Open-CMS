import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetsModule } from '../../src/nest/assets.module';
import { FakeDb } from '../support/fake-db';

const DB = Symbol('DB');
let app: INestApplication | undefined;
let root: string | undefined;

async function boot(assets: Parameters<typeof AssetsModule.forRoot>[0]['assets']) {
  const db = new FakeDb();
  @Global()
  @Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
  class DbModule {}
  const mod = await Test.createTestingModule({
    imports: [DbModule, AssetsModule.forRoot({ dbToken: DB, assets })],
  }).compile();
  app = mod.createNestApplication();
  await app.init();
  return { server: app.getHttpServer(), db };
}

const png = () => sharp({ create: { width: 20, height: 20, channels: 3, background: '#f00' } }).png().toBuffer();

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('AssetsModule HTTP', () => {
  it('uploads via multipart, serves files statically, deletes', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-http-'));
    const { server, db } = await boot({ provider: 'local', local: { root, publicBaseUrl: 'http://localhost:3000/uploads' } });

    const up = await request(server).post('/api/admin/assets/upload').field('alt', 'red').attach('file', await png(), { filename: 'Red Dot.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.seo.missingAlt).toBe(false);
    const { url, id } = up.body.data;

    const served = await request(server).get(new URL(url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/webp/);
    expect((await request(server).get('/uploads/../etc/passwd')).status).toBe(404);
    expect((await request(server).get('/uploads/2000/01/missing.webp')).status).toBe(404);

    expect((await request(server).get('/api/admin/assets')).body.data).toHaveLength(1);
    const patched = await request(server).patch(`/api/admin/assets/${id}`).send({ alt: 'new' });
    expect(patched.body.data.alt).toBe('new');

    expect((await request(server).delete(`/api/admin/assets/${id}`)).status).toBe(200);
    expect(db.rows).toHaveLength(0);
    expect((await request(server).get(new URL(url).pathname)).status).toBe(404);
  });

  it('returns 413 over the limit and 400 without a file', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-http-'));
    const { server } = await boot({ provider: 'local', local: { root, publicBaseUrl: 'http://localhost:3000/uploads' }, limits: { maxBytes: 50 } });
    const big = await request(server).post('/api/admin/assets/upload').attach('file', Buffer.alloc(500, 1), { filename: 'a.bin', contentType: 'application/octet-stream' });
    expect(big.status).toBe(413);
    const none = await request(server).post('/api/admin/assets/upload').field('alt', 'x');
    expect(none.status).toBe(400);
  });

  it('omits upload route and static serving when assets is null, keeps register/list', async () => {
    const { server } = await boot(null);
    expect((await request(server).post('/api/admin/assets/upload').attach('file', await png(), 'a.png')).status).toBe(404);
    const reg = await request(server).post('/api/admin/assets').send({ filename: 'a.png', url: 'https://cdn/a.png' });
    expect(reg.status).toBe(201);
    expect((await request(server).get('/api/admin/assets')).body.data).toHaveLength(1);
    expect((await request(server).delete(`/api/admin/assets/${reg.body.data.id}`)).status).toBe(200);
  });
});
