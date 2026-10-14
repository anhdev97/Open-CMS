import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { Global, Module, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';
import type { AuthFileConfig } from '../../src/config/schema';
import type { AuthTables } from '../../src/db/types';
import { OAuth2Module } from '../../src/oauth2.module';
import { startTestDb, type TestDb } from './db';

export const TEST_DB = Symbol('TEST_DB');

export interface TestApp {
  app: INestApplication;
  db: Kysely<AuthTables>;
  /** OPENCMS_PUBLIC_URL (no trailing slash): the origin the browser sees. */
  url: string;
  /** The address the app actually listens on (http://127.0.0.1:<port>). */
  baseUrl: string;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Boots the full OAuth2Module on a real HTTP port (R7). `opts.db` reuses an existing test database
 * (its lifetime then stays with the caller); otherwise a fresh database is created and dropped on close().
 * `opts.auth` is passed through as the file `auth` config (e.g. `{ ttl: { interaction: 1 } }`).
 * `opts.controllers` mounts extra (test-only) controllers next to the module.
 * Error JSON comes from the module's own APP_FILTER (Task 11), so no global filter is added here.
 */
export async function createTestApp(
  env: Record<string, string> = {},
  opts: { db?: TestDb; auth?: Partial<AuthFileConfig>; controllers?: Type[] } = {},
): Promise<TestApp> {
  const testDb = opts.db ?? (await startTestDb());
  const ownsDb = !opts.db;
  let app: INestApplication | undefined;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const fullEnv: Record<string, string> = {
      OPENCMS_SECRET: randomBytes(32).toString('hex'),
      OPENCMS_PUBLIC_URL: base,
      OPENCMS_INTERNAL_URL: base,
      PORT: String(port),
      ...env,
    };

    @Global()
    @Module({
      controllers: opts.controllers ?? [],
      providers: [{ provide: TEST_DB, useValue: testDb.db }],
      exports: [TEST_DB],
    })
    class TestDbModule {}

    const mod = await Test.createTestingModule({
      imports: [TestDbModule, OAuth2Module.forRoot({ dbToken: TEST_DB, env: fullEnv, auth: opts.auth })],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    await app.listen(port, '127.0.0.1');
    const started = app;
    return {
      app: started,
      db: testDb.db,
      url: fullEnv.OPENCMS_PUBLIC_URL.replace(/\/+$/, ''),
      baseUrl: base,
      async close() {
        await started.close();
        if (ownsDb) await testDb.stop();
      },
    };
  } catch (e) {
    await app?.close().catch(() => {});
    if (ownsDb) await testDb.stop();
    throw e;
  }
}
