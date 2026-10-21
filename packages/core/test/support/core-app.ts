import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql, type Kysely } from 'kysely';
import type { ContentGroupDefinition, ContentTypeDefinition } from '@opencms/schema';
import { startTestDb } from '../../../oauth2/test/support/db';
import { OpenCmsModule, type OpenCmsModuleOptions } from '../../src';

export interface CoreTestApp {
  app: INestApplication;
  /** OPENCMS_PUBLIC_URL, which is also the address the app listens on. */
  url: string;
  baseUrl: string;
  db: Kysely<any>;
  /** Writable project root (a temp dir). */
  root: string;
  close(): Promise<void>;
}

export interface CoreTestAppOptions {
  contentTypes?: ContentTypeDefinition[];
  contentGroups?: ContentGroupDefinition[];
  /** Default true. */
  schemaEditable?: boolean;
  /** Default `{ enabled: false }`: most tests have no Next app. */
  web?: OpenCmsModuleOptions['web'];
  cors?: OpenCmsModuleOptions['cors'];
  /** false: leave the database empty and without autoMigrate, so startup must refuse. Default true. */
  migrate?: boolean;
  env?: Record<string, string>;
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
 * Boots OpenCmsModule on a real HTTP port against a throwaway database. The database is migrated by core
 * itself (autoMigrate), never through a separately imported @opencms/db: vitest can load a second copy of it
 * with its own migration registry.
 */
export async function createCoreTestApp(opts: CoreTestAppOptions = {}): Promise<CoreTestApp> {
  const testDb = await startTestDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencms-core-'));
  let app: INestApplication | undefined;
  const cleanup = async () => {
    await app?.close().catch(() => {});
    await testDb.stop();
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    // startTestDb pre-migrates; start from an empty database so that core's own migration path is what is tested.
    await sql`drop schema public cascade`.execute(testDb.db);
    await sql`create schema public`.execute(testDb.db);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      OPENCMS_SECRET: randomBytes(32).toString('hex'),
      OPENCMS_PUBLIC_URL: base,
      PORT: String(port),
      ...opts.env,
    };
    @Module({
      imports: [
        OpenCmsModule.forRoot({
          root,
          config: { database: { url: testDb.url } },
          contentTypes: opts.contentTypes ?? [],
          env,
          web: opts.web ?? { enabled: false },
          cors: opts.cors,
          contentGroups: opts.contentGroups,
          schemaEditable: opts.schemaEditable ?? true,
          autoMigrate: opts.migrate !== false,
        }),
      ],
    })
    class TestRootModule {}
    app = await NestFactory.create(TestRootModule, { logger: false, abortOnError: false, bodyParser: false });
    await app.init();
    await app.listen(port, '127.0.0.1');
    const started = app;
    return { app: started, url: env.OPENCMS_PUBLIC_URL!.replace(/\/+$/, ''), baseUrl: base, db: testDb.db, root, close: cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
