import 'reflect-metadata';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app';
import { startTestDb, type TestDb } from '../support/db';

const env = { OPENCMS_SECRET: 'x'.repeat(64) };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CORE_READY gate', () => {
  let testDb: TestDb;
  const keyCount = async () =>
    (await sql<{ n: number }>`select count(*)::int as n from auth_signing_keys`.execute(testDb.db)).rows[0].n;

  beforeAll(async () => {
    testDb = await startTestDb();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  it('a rejected coreReady aborts startup before the provider touches the database', async () => {
    await expect(createTestApp(env, { db: testDb, coreReady: Promise.reject(new Error('run opencms migrate:up')) })).rejects.toThrow(
      'run opencms migrate:up',
    );
    expect(await keyCount()).toBe(0);
  });

  it('a pending coreReady holds onModuleInit (DI completes, no auth_* access) until it resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let ready = false;
    const starting = createTestApp(env, { db: testDb, coreReady: gate }).then((t) => ((ready = true), t));

    await sleep(500);
    expect(ready).toBe(false);
    expect(await keyCount()).toBe(0);

    release();
    const t = await starting;
    expect(await keyCount()).toBe(1);
    await t.close();
  });

  it('resolves immediately when no coreReady is given', async () => {
    const t = await createTestApp(env, { db: testDb });
    await t.close();
  });
});
