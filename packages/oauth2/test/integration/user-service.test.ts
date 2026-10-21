import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { AuditService } from '../../src/audit/audit.service';
import { PasswordService } from '../../src/security/password';
import { UserService } from '../../src/users/user.service';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';
import { PERMISSIONS } from '../../src/permissions';

/** A super-admin actor. */
const su = (id: string) => ({ id, isSuperAdmin: true, permissions: [...PERMISSIONS] });

describe('UserService', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  let users: UserService;
  const revoker = { revokeAllGrants: vi.fn(async (_id: string) => {}) };
  let n = 0;
  const mk = (extra: Record<string, unknown> = {}) =>
    users.create({ email: `u${++n}@x.com`, name: 'U', password: 'correct horse battery', ...extra } as any);
  const events = (type: string) => db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).execute();

  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
    users = new UserService(db, new PasswordService({ minLength: 12 }), new AuditService(db), revoker);
  });
  afterAll(() => ctx.stop());

  it('normalizes email, assigns super-admin, rejects duplicates', async () => {
    const u = await users.create({ email: ' A@X.com ', name: 'A', password: 'correct horse battery', actorId: undefined });
    expect(u.email).toBe('a@x.com');
    expect(u.groups).toEqual([{ key: 'super-admin', name: 'Super Admin' }]);
    expect(u.isSuperAdmin).toBe(true);
    expect(u.status).toBe('active');
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(users.create({ email: 'a@x.com', name: 'B' })).rejects.toMatchObject({ code: 'email_taken', status: 409 });
    expect((await users.findByEmail('  A@x.COM'))?.id).toBe(u.id);
    expect((await users.findById(u.id))?.email).toBe('a@x.com');
    expect(await users.findById('00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });

  it('create without password has null hash; weak password rejected; audit has actor', async () => {
    const actor = await mk();
    const u = await users.create({ email: 'idp@x.com', name: 'I', actorId: actor.id });
    expect(u.passwordHash).toBeNull();
    await expect(users.create({ email: 'w@x.com', name: 'W', password: 'short' })).rejects.toMatchObject({ code: 'weak_password' });
    expect(await users.findByEmail('w@x.com')).toBeUndefined();
    const ev = (await events('user_created')).find((e) => e.user_id === u.id);
    expect(ev?.actor_id).toBe(actor.id);
  });

  it('setPassword validates and hashes; touchLogin sets last_login_at; countUsers', async () => {
    const u = await mk();
    await expect(users.setPassword(u.id, 'short')).rejects.toMatchObject({ code: 'weak_password' });
    await users.setPassword(u.id, 'another long password');
    const after = await users.findById(u.id);
    expect(after!.passwordHash).not.toBe(u.passwordHash);
    expect(after!.lastLoginAt).toBeNull();
    await users.touchLogin(u.id);
    expect((await users.findById(u.id))!.lastLoginAt).toBeInstanceOf(Date);
    expect(await users.countUsers()).toBeGreaterThan(0);
  });

  describe('last super_admin', () => {
    it('blocks disabling/deleting the last active super_admin, allows otherwise', async () => {
      const lone = await startTestDb();
      try {
        const s = new UserService(lone.db, new PasswordService({ minLength: 12 }), new AuditService(lone.db), revoker);
        const a = await s.create({ email: 'a@x.com', name: 'A' });
        await expect(s.setStatus(a.id, 'disabled', su(a.id))).rejects.toMatchObject({ code: 'last_super_admin', status: 409 });
        const b = await s.create({ email: 'b@x.com', name: 'B' });
        await expect(s.delete(a.id, su(b.id))).resolves.toBeUndefined();
        await expect(s.delete(b.id, su(a.id))).rejects.toMatchObject({ code: 'last_super_admin' });
      } finally {
        await lone.stop();
      }
    });

    it('two concurrent disables of the last two admins: exactly one succeeds', async () => {
      const c = await startTestDb();
      try {
        const s = new UserService(c.db, new PasswordService({ minLength: 12 }), new AuditService(c.db), revoker);
        const a = await s.create({ email: 'a@x.com', name: 'A' });
        const b = await s.create({ email: 'b@x.com', name: 'B' });
        const r = await Promise.allSettled([s.setStatus(a.id, 'disabled', su(b.id)), s.setStatus(b.id, 'disabled', su(a.id))]);
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        const rej = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
        expect(rej).toHaveLength(1);
        expect(rej[0].reason).toMatchObject({ code: 'last_super_admin' });
      } finally {
        await c.stop();
      }
    });

    it('two concurrent deletes of the last two admins (each by the other): exactly one succeeds', async () => {
      const c = await startTestDb();
      try {
        const s = new UserService(c.db, new PasswordService({ minLength: 12 }), new AuditService(c.db), revoker);
        const a = await s.create({ email: 'a@x.com', name: 'A' });
        const b = await s.create({ email: 'b@x.com', name: 'B' });
        const r = await Promise.allSettled([s.delete(a.id, su(b.id)), s.delete(b.id, su(a.id))]);
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        const rej = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
        expect(rej).toHaveLength(1);
        expect(rej[0].reason).toMatchObject({ code: 'last_super_admin' });
        expect(await s.countUsers()).toBe(1);
      } finally {
        await c.stop();
      }
    });
  });

  it('setStatus disabled revokes + audits; enabled audits', async () => {
    const a = await mk();
    const b = await mk();
    revoker.revokeAllGrants.mockClear();
    await db.insertInto('auth_sessions').values({ id_hash: `h-${b.id}`, user_id: b.id, idle_expires_at: new Date(Date.now() + 1e6), absolute_expires_at: new Date(Date.now() + 1e6) }).execute();
    await users.setStatus(b.id, 'disabled', su(a.id));
    expect((await users.findById(b.id))!.status).toBe('disabled');
    expect(await db.selectFrom('auth_sessions').selectAll().where('user_id', '=', b.id).execute()).toHaveLength(0);
    expect(revoker.revokeAllGrants).toHaveBeenCalledWith(b.id);
    expect((await events('user_disabled')).some((e) => e.user_id === b.id && e.actor_id === a.id)).toBe(true);
    await users.setStatus(b.id, 'active', su(a.id));
    expect((await users.findById(b.id))!.status).toBe('active');
    expect((await events('user_enabled')).some((e) => e.user_id === b.id)).toBe(true);
  });

  it('delete: self forbidden; audit recorded with actor; user removed', async () => {
    const a = await mk();
    const b = await mk();
    await expect(users.delete(a.id, su(a.id))).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    revoker.revokeAllGrants.mockClear();
    await users.delete(b.id, su(a.id));
    expect(revoker.revokeAllGrants).toHaveBeenCalledWith(b.id);
    expect(await users.findById(b.id)).toBeUndefined();
    expect((await events('user_deleted')).some((e) => e.user_id === b.id && e.actor_id === a.id)).toBe(true);
  });

  it('unknown user id -> not_found 404, no false audit', async () => {
    const a = await mk();
    const ghost = '00000000-0000-0000-0000-000000000001';
    await expect(users.setPassword(ghost, 'another long password')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(users.setStatus(ghost, 'disabled', su(a.id))).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(users.delete(ghost, su(a.id))).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect((await events('user_deleted')).some((e) => e.user_id === ghost)).toBe(false);
    expect((await events('user_disabled')).some((e) => e.user_id === ghost)).toBe(false);
  });

  it('revokeAll keeps exceptSessionId and calls revoker once', async () => {
    const u = await mk();
    const exp = new Date(Date.now() + 1e6);
    for (const h of ['s1', 's2', 's3'].map((x) => `${x}-${u.id}`)) {
      await db.insertInto('auth_sessions').values({ id_hash: h, user_id: u.id, idle_expires_at: exp, absolute_expires_at: exp }).execute();
    }
    revoker.revokeAllGrants.mockClear();
    await users.revokeAll(u.id, { exceptSessionId: `s1-${u.id}` });
    const left = await db.selectFrom('auth_sessions').select('id_hash').where('user_id', '=', u.id).execute();
    expect(left.map((x) => x.id_hash)).toEqual([`s1-${u.id}`]);
    expect(revoker.revokeAllGrants).toHaveBeenCalledTimes(1);
    await users.revokeAll(u.id);
    expect(await db.selectFrom('auth_sessions').selectAll().where('user_id', '=', u.id).execute()).toHaveLength(0);
  });
});
