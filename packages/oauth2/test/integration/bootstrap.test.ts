import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { AuditService } from '../../src/audit/audit.service';
import { loadConfig } from '../../src/config/schema';
import { PasswordService } from '../../src/security/password';
import { BootstrapError, BootstrapService } from '../../src/setup/bootstrap.service';
import { UserService } from '../../src/users/user.service';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';

const SECRET = Buffer.alloc(32, 7).toString('base64');

describe('BootstrapService', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  const revoker = { revokeAllGrants: vi.fn(async (_id: string) => {}) };
  const logger = { log: vi.fn(), warn: vi.fn() };
  const passwords = new PasswordService({ minLength: 12 });

  const make = (env: Record<string, string>) => {
    const cfg = loadConfig({ OPENCMS_SECRET: SECRET, OPENCMS_PUBLIC_URL: 'http://cms.test/', ...env });
    const audit = new AuditService(db);
    const users = new UserService(db, passwords, audit, revoker);
    return { users, svc: new BootstrapService(cfg, users, passwords, audit, logger) };
  };
  const events = (type: string) => db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).execute();

  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
  });
  afterAll(() => ctx.stop());
  beforeEach(async () => {
    await db.deleteFrom('auth_audit_events').execute();
    await db.deleteFrom('auth_users').execute();
    vi.clearAllMocks();
  });

  it('seeds from env once and is idempotent', async () => {
    const { users, svc } = make({ OPENCMS_ADMIN_EMAIL: ' Root@X.com ', OPENCMS_ADMIN_PASSWORD: 'correct horse battery' });
    await svc.run();
    expect(await users.countUsers()).toBe(1);
    const u = await users.findByEmail('root@x.com');
    expect(u?.roles).toEqual(['super_admin']);
    expect(u?.name).toBe('Admin');
    expect(await events('admin_seeded_from_env')).toHaveLength(1);
    await svc.run();
    expect(await users.countUsers()).toBe(1);
    expect(logger.log.mock.calls.flat().join(' ')).toMatch(/ignored/i);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects a weak env password', async () => {
    const { svc } = make({ OPENCMS_ADMIN_EMAIL: 'a@x.com', OPENCMS_ADMIN_PASSWORD: 'short' });
    await expect(svc.run()).rejects.toBeInstanceOf(BootstrapError);
  });

  it('warns when there is no admin and no env', async () => {
    const { svc } = make({});
    await svc.run();
    const msg = logger.warn.mock.calls.flat().join(' ');
    expect(msg).toContain('http://cms.test/admin/setup');
    expect(msg).toContain('Bất kỳ ai truy cập');
    expect(msg).toContain('Chưa có tài khoản admin.');
  });

  it('force reset resets password, status, role, sessions and audits', async () => {
    const { users } = make({});
    const u = await users.create({ email: 'a@x.com', name: 'A', password: 'old password long' });
    await db.updateTable('auth_users').set({ status: 'disabled' }).where('id', '=', u.id).execute();
    await db.deleteFrom('auth_user_roles').where('user_id', '=', u.id).execute();
    const { users: users2, svc } = make({
      OPENCMS_ADMIN_EMAIL: 'A@x.com',
      OPENCMS_ADMIN_PASSWORD: 'brand new password',
      OPENCMS_ADMIN_FORCE_RESET: 'true',
    });
    revoker.revokeAllGrants.mockClear();
    await svc.run();
    const after = await users2.findByEmail('a@x.com');
    expect(await passwords.verify(after!.passwordHash!, 'brand new password')).toBe(true);
    expect(after!.status).toBe('active');
    expect(after!.roles).toEqual(['super_admin']);
    expect(revoker.revokeAllGrants).toHaveBeenCalledWith(u.id);
    expect(await events('admin_force_reset')).toHaveLength(1);
    expect(logger.warn.mock.calls.flat().join(' ')).toContain('OPENCMS_ADMIN_FORCE_RESET');
  });

  it('force reset with unknown email fails', async () => {
    const { svc } = make({
      OPENCMS_ADMIN_EMAIL: 'nobody@x.com',
      OPENCMS_ADMIN_PASSWORD: 'brand new password',
      OPENCMS_ADMIN_FORCE_RESET: 'true',
    });
    await expect(svc.run()).rejects.toBeInstanceOf(BootstrapError);
  });
});
