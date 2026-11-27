import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allCoreMigrations, createDb } from '../src/index';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/** Rolling back 0008 must not turn private files into public assets (the visibility column goes away). */
describe('0008_private_assets down', () => {
  const name = `db_down_test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  let db: Kysely<any>;

  beforeAll(async () => {
    await admin.query(`create database ${name}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${name}`;
    db = createDb(u.toString());
  });
  afterAll(async () => {
    await db?.destroy();
    // Same wait as core-stream-order.test.ts before dropping WITH (FORCE).
    const deadline = Date.now() + 5_000;
    for (;;) {
      const { rows } = await admin.query('select count(*)::int as n from pg_stat_activity where datname = $1', [name]);
      if (rows[0].n === 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it('deletes private asset rows before dropping the columns; public rows stay', async () => {
    const migrations = allCoreMigrations();
    // Up to 0008 only: later migrations (0009_detail_pages, …) are not part of this rollback.
    const names = Object.keys(migrations).filter((n) => /^000\d_/.test(n) && n <= '0008_private_assets').sort();
    expect(names.at(-1)).toBe('0008_private_assets');
    for (const n of names) await migrations[n].up(db);
    await sql`insert into opencms_assets (filename, url, visibility) values ('pub.png', '/media/pub.png', 'public'), ('inv.pdf', '', 'private')`.execute(db);
    await migrations['0008_private_assets'].down!(db);
    const rows = await sql<{ filename: string }>`select filename from opencms_assets order by filename`.execute(db);
    expect(rows.rows).toEqual([{ filename: 'pub.png' }]);
  });
});
