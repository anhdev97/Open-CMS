import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';

describe('oauth2_0002_roles', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx?.stop();
  });

  it('auth_roles has name unique, description, is_system, timestamps; no key column', async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>`
      select column_name, data_type, is_nullable, column_default::text
      from information_schema.columns
      where table_schema = 'public' and table_name = 'auth_roles'
      order by column_name
    `.execute(db);
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'created_at',
      'description',
      'id',
      'is_system',
      'name',
      'updated_at',
    ]);
    expect(cols.rows.find((c) => c.column_name === 'is_system')).toMatchObject({
      data_type: 'boolean',
      is_nullable: 'NO',
    });
  });

  it('seeds only super_admin as system role with description from old display name', async () => {
    const rows = await db.selectFrom('auth_roles').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'super_admin',
      description: 'Super Admin',
      is_system: true,
    });
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].updated_at).toBeInstanceOf(Date);
  });

  it('enforces unique name', async () => {
    await expect(
      db.insertInto('auth_roles').values({ name: 'super_admin', description: 'x' }).execute(),
    ).rejects.toThrow();
  });

  it('records oauth2_0002_roles in opencms_core_migrations', async () => {
    const r = await sql<{ name: string }>`select name from opencms_core_migrations`.execute(db);
    expect(r.rows.map((x) => x.name)).toEqual(expect.arrayContaining(['oauth2_0001_init', 'oauth2_0002_roles']));
  });
});
