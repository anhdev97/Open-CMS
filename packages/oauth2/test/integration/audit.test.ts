import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { AuditService } from '../../src/audit/audit.service';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';

describe('AuditService', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  let audit: AuditService;
  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
    audit = new AuditService(db);
  });
  afterAll(() => ctx.stop());

  it('records a row with at', async () => {
    await audit.record({ type: 'logout', ip: '1.2.3.4', userAgent: 'ua', meta: { a: 1 } });
    const rows = await db.selectFrom('auth_audit_events').selectAll().where('type', '=', 'logout').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBeInstanceOf(Date);
    expect(rows[0].ip).toBe('1.2.3.4');
    expect(rows[0].meta).toEqual({ a: 1 });
  });

  it('strips sensitive meta keys (case-insensitive, substring)', async () => {
    await audit.record({
      type: 'login_failed',
      meta: { password: 'x', Token: 'x', cookie: 'x', refreshToken: 'x', newPassword: 'x', SessionCookie: 'x', reason: 'bad', nested: 1 },
    });
    const row = await db.selectFrom('auth_audit_events').select('meta').where('type', '=', 'login_failed').executeTakeFirstOrThrow();
    expect(row.meta).toEqual({ reason: 'bad', nested: 1 });
  });

  it('works inside a transaction and defaults meta to {}', async () => {
    await db.transaction().execute((trx) => audit.record({ type: 'setup_completed' }, trx));
    const row = await db.selectFrom('auth_audit_events').select('meta').where('type', '=', 'setup_completed').executeTakeFirstOrThrow();
    expect(row.meta).toEqual({});
  });
});
