import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely, Migration } from 'kysely';
import { Pool } from 'pg';
import { allCoreMigrations, createDb, migrateUp, registerCoreMigrations } from '../src/index';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const noop: Migration = { async up() {}, async down() {} };
const NO_PROJECT_MIGRATIONS = '/nonexistent-opencms-migrations';

/**
 * I3: contributed migrations (e.g. `oauth2_0001_init`) sort after every `000N_*` built-in, so the next
 * built-in core migration lands "before" an already executed one. The core stream must still apply it.
 */
describe('core migration stream with contributed sources', () => {
  const name = `db_order_test_${randomBytes(6).toString('hex')}`;
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
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it('applies a later built-in 0005_* after oauth2_0001_init has already run', async () => {
    registerCoreMigrations({ oauth2_0001_init: noop });
    const first = await migrateUp(db, NO_PROJECT_MIGRATIONS);
    expect(first.map((r) => r.name)).toEqual([
      '0001_system_tables',
      '0002_region_locales',
      '0003_workflow',
      '0004_assets_storage',
      '0005_asset_folders',
      'oauth2_0001_init',
    ]);

    let ran = false;
    registerCoreMigrations({ '0006_future_core': { async up() { ran = true; }, async down() {} } });
    const second = await migrateUp(db, NO_PROJECT_MIGRATIONS);
    expect(second.map((r) => [r.name, r.status])).toEqual([['0006_future_core', 'Success']]);
    expect(ran).toBe(true);
  });

  it('lists 0005_asset_folders after 0004_assets_storage in allCoreMigrations()', () => {
    const keys = Object.keys(allCoreMigrations());
    expect(keys.indexOf('0004_assets_storage')).toBeLessThan(keys.indexOf('0005_asset_folders'));
  });
});
