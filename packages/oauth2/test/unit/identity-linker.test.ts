import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { AuditService } from '../../src/audit/audit.service';
import type { AuthTables } from '../../src/db/types';
import { IdentityLinker } from '../../src/idp/identity-linker';
import { PasswordService } from '../../src/security/password';
import { UserService } from '../../src/users/user.service';
import { startTestDb } from '../support/db';

describe('IdentityLinker (spec §6.4 step 3)', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  let users: UserService;
  let linker: IdentityLinker;
  const revoker = { revokeAllGrants: vi.fn(async (_id: string) => {}) };
  const identities = (subject: string) =>
    db.selectFrom('auth_user_identities').selectAll().where('provider', '=', 'oidc').where('subject', '=', subject).execute();
  const events = (type: string) => db.selectFrom('auth_audit_events').selectAll().where('type', '=', type).execute();

  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
    const audit = new AuditService(db);
    users = new UserService(db, new PasswordService({ minLength: 12 }), audit, revoker);
    linker = new IdentityLinker(db, users, audit);
  });
  afterAll(() => ctx.stop());

  it('existing link → that user, even when the IdP email differs and is unverified', async () => {
    const u = await users.create({ email: 'linked@x.com', name: 'L' });
    await db.insertInto('auth_user_identities').values({ user_id: u.id, provider: 'oidc', subject: 'sub-linked', email: 'linked@x.com' }).execute();
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-linked', email: 'other@x.com', emailVerified: false }),
    ).resolves.toBe(u.id);
  });

  it('no link and emailVerified=false → idp_email_unverified, nothing linked', async () => {
    await users.create({ email: 'unverified@x.com', name: 'U' });
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-unv', email: 'unverified@x.com', emailVerified: false }),
    ).rejects.toMatchObject({ code: 'idp_email_unverified' });
    expect(await identities('sub-unv')).toHaveLength(0);
  });

  it('verified email that matches no user → idp_account_not_found (and no email at all)', async () => {
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-none', email: 'nobody@x.com', emailVerified: true }),
    ).rejects.toMatchObject({ code: 'idp_account_not_found' });
    await expect(linker.resolve({ provider: 'oidc', subject: 'sub-none', emailVerified: true })).rejects.toMatchObject({
      code: 'idp_account_not_found',
    });
    expect(await identities('sub-none')).toHaveLength(0);
  });

  it("' User@X.com ' matches user@x.com → link created (normalized email), audited idp_linked", async () => {
    const u = await users.create({ email: 'user@x.com', name: 'U' });
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-user', email: ' User@X.com ', emailVerified: true }),
    ).resolves.toBe(u.id);
    const rows = await identities('sub-user');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: u.id, email: 'user@x.com' });
    const linked = await events('idp_linked');
    expect(linked.filter((e) => e.user_id === u.id).map((e) => e.meta)).toEqual([{ provider: 'oidc' }]);
    // Second login reuses the link; no second audit event.
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-user', email: 'user@x.com', emailVerified: true }),
    ).resolves.toBe(u.id);
    expect((await events('idp_linked')).filter((e) => e.user_id === u.id)).toHaveLength(1);
  });

  it('linked user that is disabled → account_disabled', async () => {
    const u = await users.create({ email: 'off@x.com', name: 'O' });
    await db.insertInto('auth_user_identities').values({ user_id: u.id, provider: 'oidc', subject: 'sub-off', email: 'off@x.com' }).execute();
    await db.updateTable('auth_users').set({ status: 'disabled' }).where('id', '=', u.id).execute();
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-off', email: 'off@x.com', emailVerified: true }),
    ).rejects.toMatchObject({ code: 'account_disabled' });
  });

  it('unlinked disabled user matched by email → account_disabled, no link created', async () => {
    const u = await users.create({ email: 'off2@x.com', name: 'O' });
    await db.updateTable('auth_users').set({ status: 'disabled' }).where('id', '=', u.id).execute();
    await expect(
      linker.resolve({ provider: 'oidc', subject: 'sub-off2', email: 'off2@x.com', emailVerified: true }),
    ).rejects.toMatchObject({ code: 'account_disabled' });
    expect(await identities('sub-off2')).toHaveLength(0);
  });

  it('concurrent first logins of the same subject both resolve to the user, one link', async () => {
    const u = await users.create({ email: 'race@x.com', name: 'R' });
    const id = { provider: 'oidc', subject: 'sub-race', email: 'race@x.com', emailVerified: true };
    const out = await Promise.all([linker.resolve(id), linker.resolve(id), linker.resolve(id)]);
    expect(out).toEqual([u.id, u.id, u.id]);
    expect(await identities('sub-race')).toHaveLength(1);
    expect((await events('idp_linked')).filter((e) => e.user_id === u.id)).toHaveLength(1);
  });
});
