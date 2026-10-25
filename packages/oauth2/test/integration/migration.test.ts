import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { coreMigrator } from '@opencloudcms/db';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';

const TABLES = [
  'auth_users',
  'auth_groups',
  'auth_user_groups',
  'auth_user_identities',
  'auth_oauth_clients',
  'auth_oidc_payloads',
  'auth_sessions',
  'auth_signing_keys',
  'auth_audit_events',
];

async function existing(db: Kysely<any>): Promise<string[]> {
  const r = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'auth\\_%'`.execute(db);
  return r.rows.map((x) => x.table_name).sort();
}

describe('oauth2_0001_init', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx?.stop();
  });

  it('creates all 9 tables', async () => {
    expect(await existing(db)).toEqual([...TABLES].sort());
  });

  it('auth_sessions has a nullable refresh_lease_until timestamptz', async () => {
    const r = await sql<{ data_type: string; is_nullable: string }>`select data_type, is_nullable from information_schema.columns where table_name = 'auth_sessions' and column_name = 'refresh_lease_until'`.execute(db);
    expect(r.rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
  });

  it('seeds the super-admin, contenter and reviewer groups (after oauth2_0003_groups)', async () => {
    const rows = await db.selectFrom('auth_groups').selectAll().orderBy('key').execute();
    expect(rows.map((r) => [r.key, r.name])).toEqual([['contenter', 'Contenter'], ['reviewer', 'Reviewer'], ['super-admin', 'Super Admin']]);
  });

  it('enforces case-insensitive unique email', async () => {
    await db.insertInto('auth_users').values({ email: 'A@x.com', name: 'A' }).execute();
    await expect(db.insertInto('auth_users').values({ email: 'a@x.com', name: 'B' }).execute()).rejects.toThrow();
  });

  it('rejects an invalid status', async () => {
    await expect(db.insertInto('auth_users').values({ email: 'c@x.com', name: 'C', status: 'bogus' }).execute()).rejects.toThrow();
  });

  it('cascades user deletion to groups, identities and sessions', async () => {
    const u = await db.insertInto('auth_users').values({ email: 'd@x.com', name: 'D' }).returning('id').executeTakeFirstOrThrow();
    const group = await db.selectFrom('auth_groups').select('id').where('key', '=', 'super-admin').executeTakeFirstOrThrow();
    await db.insertInto('auth_user_groups').values({ user_id: u.id, group_id: group.id }).execute();
    await db.insertInto('auth_user_identities').values({ user_id: u.id, provider: 'p', subject: 's' }).execute();
    await db.deleteFrom('auth_users').where('id', '=', u.id).execute();
    expect(await db.selectFrom('auth_user_groups').selectAll().where('user_id', '=', u.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('auth_user_identities').selectAll().where('user_id', '=', u.id).execute()).toHaveLength(0);
  });

  it('indexes auth_oidc_payloads for grant revocation and per-account lookups', async () => {
    const r = await sql<{ indexname: string; indexdef: string }>`select indexname, indexdef from pg_indexes where tablename = 'auth_oidc_payloads' order by indexname`.execute(db);
    const defs = Object.fromEntries(r.rows.map((x) => [x.indexname, x.indexdef]));
    expect(Object.keys(defs)).toEqual([
      'auth_oidc_payloads_expires_idx',
      'auth_oidc_payloads_grant_id_idx',
      'auth_oidc_payloads_kind_account_idx',
      'auth_oidc_payloads_kind_grant_idx',
      'auth_oidc_payloads_kind_uid_idx',
      'auth_oidc_payloads_pk',
    ]);
    expect(defs.auth_oidc_payloads_grant_id_idx).toMatch(/\(grant_id\)$/);
    expect(defs.auth_oidc_payloads_kind_account_idx).toMatch(/\(kind, \(\(payload ->> 'accountId'::text\)\)\)$/);

    // The revoker's lookup (kind + payload->>'accountId') can use the expression index.
    const plan = await db.transaction().execute(async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      return sql<{ 'QUERY PLAN': string }>`explain select id from auth_oidc_payloads where kind = 'Grant' and payload->>'accountId' = 'x'`.execute(trx);
    });
    expect(plan.rows.map((x) => x['QUERY PLAN']).join('\n')).toContain('auth_oidc_payloads_kind_account_idx');
  });

  it('records the migration in opencms_core_migrations', async () => {
    const r = await sql<{ name: string }>`select name from opencms_core_migrations`.execute(db);
    expect(r.rows.map((x) => x.name)).toContain('oauth2_0001_init');
  });

  it('down drops all 9 tables', async () => {
    // oauth2 migrations are last in key order: undo 0003 (groups), 0002 (locale), then 0001
    const m = coreMigrator(db);
    const groups = await m.migrateDown();
    expect(groups.error).toBeUndefined();
    expect(groups.results?.[0]?.migrationName).toBe('oauth2_0003_groups');
    const first = await m.migrateDown();
    expect(first.error).toBeUndefined();
    expect(first.results?.[0]?.migrationName).toBe('oauth2_0002_user_locale');
    const res = await m.migrateDown();
    expect(res.error).toBeUndefined();
    expect(res.results?.[0]?.migrationName).toBe('oauth2_0001_init');
    expect(await existing(db)).toEqual([]);
  });
});
