import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { coreMigrator } from '@opencloudcms/db';
import { startTestDb, type TestDb } from '../support/db';

const tables = async (db: Kysely<any>): Promise<string[]> =>
  (await sql<{ t: string }>`select table_name as t from information_schema.tables where table_schema = 'public' and table_name like 'auth\\_%' order by 1`.execute(db)).rows.map((r) => r.t);

describe('oauth2_0003_groups', () => {
  let ctx: TestDb;
  let db: Kysely<any>;
  let userId: string;

  beforeAll(async () => {
    ctx = await startTestDb({ upTo: 'oauth2_0002_user_locale' });
    db = ctx.db as Kysely<any>;
    const u = await db.insertInto('auth_users').values({ email: 'old@x.com', name: 'Old' }).returning('id').executeTakeFirstOrThrow();
    userId = u.id;
    await sql`insert into auth_user_roles (user_id, role_id) select ${userId}, id from auth_roles where key = 'super_admin'`.execute(db);
    const { error } = await coreMigrator(db).migrateTo('oauth2_0003_groups');
    if (error) throw error;
  }, 60_000);
  afterAll(async () => {
    await ctx?.stop();
  });

  it('renames the tables', async () => {
    const t = await tables(db);
    expect(t).toContain('auth_groups');
    expect(t).toContain('auth_user_groups');
    expect(t).not.toContain('auth_roles');
    expect(t).not.toContain('auth_user_roles');
  });

  it('keeps the existing user in super-admin (system, no stored roles)', async () => {
    const rows = await db
      .selectFrom('auth_user_groups as ug')
      .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
      .select(['g.key', 'g.name', 'g.system', 'g.roles'])
      .where('ug.user_id', '=', userId)
      .execute();
    expect(rows).toEqual([{ key: 'super-admin', name: 'Super Admin', system: true, roles: [] }]);
  });

  it('seeds contenter and reviewer with their exact roles', async () => {
    const rows = await db.selectFrom('auth_groups').select(['key', 'name', 'system', 'roles']).orderBy('key').execute();
    expect(rows).toEqual([
      { key: 'contenter', name: 'Contenter', system: false, roles: ['content.create', 'content.delete', 'content.read', 'content.submit', 'content.update'] },
      { key: 'reviewer', name: 'Reviewer', system: false, roles: ['content.publish', 'content.read', 'content.update'] },
      { key: 'super-admin', name: 'Super Admin', system: true, roles: [] },
    ]);
  });

  it('renames the user→group primary key and column', async () => {
    const r = await sql<{ conname: string }>`select conname from pg_constraint where conrelid = 'auth_user_groups'::regclass order by 1`.execute(db);
    expect(r.rows.map((x) => x.conname)).toEqual(['auth_user_groups_group_id_fkey', 'auth_user_groups_pk', 'auth_user_groups_user_id_fkey']);
    const g = await sql<{ conname: string }>`select conname from pg_constraint where conrelid = 'auth_groups'::regclass order by 1`.execute(db);
    expect(g.rows.map((x) => x.conname)).toEqual(['auth_groups_key_ck', 'auth_groups_key_key', 'auth_groups_pkey']);
  });

  it('rejects a key that is not a slug', async () => {
    await expect(db.insertInto('auth_groups').values({ key: 'Bad Key', name: 'x' }).execute()).rejects.toThrow();
  });

  it('down restores auth_roles / auth_user_roles and the user link', async () => {
    const { error } = await coreMigrator(db).migrateDown();
    expect(error).toBeUndefined();
    const t = await tables(db);
    expect(t).toContain('auth_roles');
    expect(t).toContain('auth_user_roles');
    expect(t).not.toContain('auth_groups');
    const roles = await db.selectFrom('auth_roles').selectAll().execute();
    expect(roles.map((r: any) => [r.key, r.name])).toEqual([['super_admin', 'Super Admin']]);
    expect(Object.keys(roles[0]).sort()).toEqual(['id', 'key', 'name']);
    const links = await db
      .selectFrom('auth_user_roles as ur')
      .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
      .select('r.key')
      .where('ur.user_id', '=', userId)
      .execute();
    expect(links).toEqual([{ key: 'super_admin' }]);
    const pk = await sql<{ conname: string }>`select conname from pg_constraint where conrelid = 'auth_user_roles'::regclass and contype = 'p'`.execute(db);
    expect(pk.rows).toEqual([{ conname: 'auth_user_roles_pk' }]);
    // and up again works
    const again = await coreMigrator(db).migrateToLatest();
    expect(again.error).toBeUndefined();
  });
});
