import { randomBytes } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { coreMigrator, registerCoreMigrations } from '@opencms/db';
import { oauth2CoreMigrations } from '../../src/db/migrations';
import type { AuthTables } from '../../src/db/types';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export interface TestDb {
  db: Kysely<AuthTables>;
  url: string;
  stop(): Promise<void>;
}

/** Creates a throwaway database, runs all core migrations (incl. oauth2), and returns a Kysely on it. */
export async function startTestDb(): Promise<TestDb> {
  registerCoreMigrations(oauth2CoreMigrations);
  const name = `oauth2_test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`create database ${name}`);
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const url = u.toString();
  const pool = new Pool({ connectionString: url, max: 10 });
  // `drop database ... with (force)` can race pool shutdown and kill an idle client; that is expected.
  pool.on('error', () => {});
  const db = new Kysely<AuthTables>({ dialect: new PostgresDialect({ pool }) });
  try {
    const { error } = await coreMigrator(db).migrateToLatest();
    if (error) throw error instanceof Error ? error : new Error(String(error));
  } catch (e) {
    await db.destroy();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    throw e;
  }
  return {
    db,
    url,
    async stop() {
      await db.destroy();
      try {
        await admin.query(`drop database if exists ${name} with (force)`);
      } finally {
        await admin.end();
      }
    },
  };
}
