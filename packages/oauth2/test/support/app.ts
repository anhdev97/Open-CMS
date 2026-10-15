import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { Global, Module, type INestApplication, type InjectionToken, type Provider, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';
import type { AuthFileConfig } from '../../src/config/schema';
import type { AuthTables } from '../../src/db/types';
import type { CoreReady } from '../../src/constants';
import { OAuth2Module } from '../../src/oauth2.module';
import { startTestDb, type TestDb } from './db';

export const TEST_DB = Symbol('TEST_DB');
export const TEST_CORE_READY = Symbol('TEST_CORE_READY');

export interface TestApp {
  app: INestApplication;
  db: Kysely<AuthTables>;
  /** OPENCMS_PUBLIC_URL (no trailing slash): the origin the browser sees. When the env sets it to '' this is the dev default, http://localhost:<port>. */
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
 * `opts.listenPort` is the port the app listens on (default: a free port, also used as PORT); pass `env.PORT`
 * separately to point the BFF's internal URL elsewhere.
 * `opts.coreReady` is the promise behind a `CoreReady` holder the module's `coreReady` token resolves to (what
 * @opencms/core provides in production); `opts.configureApp` runs on the Nest app before it listens (e.g. `app.useGlobalFilters(...)`).
 * `opts.controllers` mounts extra (test-only) controllers next to the module.
 * Error JSON comes from the module's own APP_FILTER (Task 11), so no global filter is added here.
 */
export async function createTestApp(
  env: Record<string, string> = {},
  opts: {
    db?: TestDb;
    auth?: Partial<AuthFileConfig>;
    controllers?: Type[];
    listenPort?: number;
    coreReady?: Promise<void>;
    /** Extra (test-only) providers next to the module, e.g. a stand-in for the host's onModuleInit. */
    providers?: Provider[];
    configureApp?: (app: INestApplication) => void;
  } = {},
): Promise<TestApp> {
  const testDb = opts.db ?? (await startTestDb());
  const ownsDb = !opts.db;
  let app: INestApplication | undefined;
  try {
    const listenPort = opts.listenPort ?? (await freePort());
    const base = `http://127.0.0.1:${listenPort}`;
    const fullEnv: Record<string, string> = {
      OPENCMS_SECRET: randomBytes(32).toString('hex'),
      OPENCMS_PUBLIC_URL: base,
      PORT: String(listenPort),
      ...env,
    };

    // A rejected promise must not trip Node's unhandled-rejection check before the module awaits it.
    const coreReady = opts.coreReady;
    coreReady?.catch(() => {});
    const coreReadyToken: InjectionToken | undefined = coreReady ? TEST_CORE_READY : undefined;

    @Global()
    @Module({
      controllers: opts.controllers ?? [],
      providers: [
        { provide: TEST_DB, useValue: testDb.db },
        ...(opts.providers ?? []),
        ...(coreReady ? [{ provide: TEST_CORE_READY, useValue: { wait: () => coreReady } satisfies CoreReady }] : []),
      ],
      exports: [TEST_DB, ...(coreReady ? [TEST_CORE_READY] : [])],
    })
    class TestDbModule {}

    const mod = await Test.createTestingModule({
      imports: [
        TestDbModule,
        OAuth2Module.forRoot({ dbToken: TEST_DB, env: fullEnv, auth: opts.auth, coreReady: coreReadyToken }),
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    opts.configureApp?.(app);
    await app.listen(listenPort, '127.0.0.1');
    const started = app;
    return {
      app: started,
      db: testDb.db,
      url: (fullEnv.OPENCMS_PUBLIC_URL || `http://localhost:${listenPort}`).replace(/\/+$/, ''),
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
