import 'reflect-metadata';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app';
import { startTestDb, type TestDb } from '../support/db';

const env = { OPENCMS_SECRET: 'x'.repeat(64) };

describe('CORE_READY gate', () => {
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  it('a rejected coreReady aborts startup before the provider touches the database', async () => {
    await expect(
      createTestApp(env, { db: testDb, coreReady: () => Promise.reject(new Error('run opencms migrate:up')) }),
    ).rejects.toThrow('run opencms migrate:up');
    const rows = await sql<{ n: number }>`select count(*)::int as n from auth_signing_keys`.execute(testDb.db);
    expect(rows.rows[0].n).toBe(0);
  });

  it('a resolved coreReady lets startup continue', async () => {
    const t = await createTestApp(env, { db: testDb, coreReady: async () => {} });
    await t.close();
  });

  it('resolves immediately when no coreReady is given', async () => {
    const t = await createTestApp(env, { db: testDb });
    await t.close();
  });
});
