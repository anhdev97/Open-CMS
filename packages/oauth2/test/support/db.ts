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

/**
 * `Pool.end()` (so `db.destroy()`) resolves once the clients have been sent Terminate, not once their backends
 * have exited. Dropping the database `WITH (FORCE)` straight away can SIGTERM a backend that has not yet read
 * Terminate; the client then receives FATAL 57P01 after the pool has detached its error listener, which surfaces
 * as an uncaught exception. So wait until no session is left on the database before dropping it.
 */
async function dropDatabase(admin: Pool, name: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const { rows } = await admin.query('select count(*)::int as n from pg_stat_activity where datname = $1', [name]);
    if (rows[0].n === 0 || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await admin.query(`drop database if exists ${name} with (force)`);
}

/**
 * Creates a throwaway database, runs all core migrations (incl. oauth2), and returns a Kysely on it.
 * `opts.upTo` stops after that migration (to test a later migration against existing data).
 */
export async function startTestDb(opts: { upTo?: string } = {}): Promise<TestDb> {
  registerCoreMigrations(oauth2CoreMigrations);
  const name = `oauth2_test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`create database ${name}`);
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const url = u.toString();
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = new Kysely<AuthTables>({ dialect: new PostgresDialect({ pool }) });
  try {
    const migrator = coreMigrator(db);
    const { error } = opts.upTo ? await migrator.migrateTo(opts.upTo) : await migrator.migrateToLatest();
    if (error) throw error instanceof Error ? error : new Error(String(error));
  } catch (e) {
    await db.destroy();
    try {
      await dropDatabase(admin, name);
    } finally {
      await admin.end();
    }
    throw e;
  }
  return {
    db,
    url,
    async stop() {
      await db.destroy();
      try {
        await dropDatabase(admin, name);
      } finally {
        await admin.end();
      }
    },
  };
}
