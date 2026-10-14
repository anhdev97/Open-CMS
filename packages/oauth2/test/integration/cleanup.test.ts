import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CleanupService } from '../../src/maintenance/cleanup.service';
import { startTestDb, type TestDb } from '../support/db';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';

const NOW = new Date('2026-01-01T00:00:00Z');
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);

describe('CleanupService', () => {
  let tdb: TestDb;
  let svc: CleanupService;
  let userId: string;

  beforeAll(async () => {
    tdb = await startTestDb();
    svc = new CleanupService(tdb.db);
    const u = await tdb.db
      .insertInto('auth_users')
      .values({ email: 'c@x.com', name: 'C', password_hash: null, created_at: NOW, updated_at: NOW })
      .returning('id')
      .executeTakeFirstOrThrow();
    userId = u.id;
  });
  afterAll(async () => {
    await tdb?.stop();
  });

  const payload = (id: string, expires: Date | null) =>
    tdb.db.insertInto('auth_oidc_payloads').values({ kind: 'Session', id, payload: {}, expires_at: expires }).execute();
  const session = (id: string, idle: Date, abs: Date) =>
    tdb.db
      .insertInto('auth_sessions')
      .values({ id_hash: id, user_id: userId, idle_expires_at: idle, absolute_expires_at: abs, created_at: NOW, last_seen_at: NOW })
      .execute();

  it('deletes expired payloads and sessions, keeps live rows, returns counts', async () => {
    await payload('p-old', at(-10));
    await payload('p-live', at(10));
    await payload('p-null', null);
    await session('s-idle', at(-1), at(1000));
    await session('s-abs', at(1000), at(-1));
    await session('s-live', at(1000), at(1000));

    const r = await svc.run(NOW);
    expect(r).toEqual({ payloads: 1, sessions: 2 });

    const p = await tdb.db.selectFrom('auth_oidc_payloads').select('id').orderBy('id').execute();
    expect(p.map((x) => x.id)).toEqual(['p-live', 'p-null']);
    const s = await tdb.db.selectFrom('auth_sessions').select('id_hash').execute();
    expect(s.map((x) => x.id_hash)).toEqual(['s-live']);
    expect(await svc.run(NOW)).toEqual({ payloads: 0, sessions: 0 });
  });

  it('runs on module init (one sweep) and stops its timer on destroy', async () => {
    await payload('p-boot', new Date(Date.now() - 60_000));
    const t: TestApp = await createTestApp({}, { db: tdb });
    try {
      await new Promise((r) => setTimeout(r, 500));
      const left = await tdb.db.selectFrom('auth_oidc_payloads').select('id').where('id', '=', 'p-boot').execute();
      expect(left).toEqual([]);
      expect(t.app.get(UserService)).toBeDefined();
    } finally {
      await t.close();
    }
  });
});
