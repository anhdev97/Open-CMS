import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { AuthTables } from '../../src/db/types';
import { createKyselyAdapter } from '../../src/provider/kysely.adapter';
import { startTestDb } from '../support/db';

describe('KyselyAdapter', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  let nowMs = Date.parse('2026-10-14T00:00:00Z');
  const Adapter = () => createKyselyAdapter(db, { now: () => new Date(nowMs) });

  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx?.stop();
  });
  beforeEach(async () => {
    nowMs = Date.parse('2026-10-14T00:00:00Z');
    await db.deleteFrom('auth_oidc_payloads').execute();
  });

  it('upsert then find returns the payload; same id overwrites', async () => {
    const a = new (Adapter())('Session');
    await a.upsert('s1', { foo: 1, nested: { x: ['a'] } }, 60);
    expect(await a.find('s1')).toEqual({ foo: 1, nested: { x: ['a'] } });
    await a.upsert('s1', { foo: 2 }, 60);
    expect(await a.find('s1')).toEqual({ foo: 2 });
    expect(await a.find('missing')).toBeUndefined();
  });

  it('find returns undefined after expiry (injected clock)', async () => {
    const a = new (Adapter())('AccessToken');
    await a.upsert('t1', { v: 1 }, 1);
    expect(await a.find('t1')).toEqual({ v: 1 });
    nowMs += 2000;
    expect(await a.find('t1')).toBeUndefined();
  });

  it('upsert without expiresIn never expires', async () => {
    const a = new (Adapter())('Client');
    await a.upsert('c1', { v: 1 });
    nowMs += 10 * 365 * 86400 * 1000;
    expect(await a.find('c1')).toEqual({ v: 1 });
  });

  it('consume sets consumed to epoch seconds', async () => {
    const a = new (Adapter())('AuthorizationCode');
    await a.upsert('code', { v: 1 }, 60);
    expect((await a.find('code'))?.consumed).toBeUndefined();
    await a.consume('code');
    expect((await a.find('code'))?.consumed).toBe(Math.floor(nowMs / 1000));
  });

  it('destroy removes only the given kind/id', async () => {
    const a = new (Adapter())('Session');
    const b = new (Adapter())('Interaction');
    await a.upsert('x', { v: 1 }, 60);
    await b.upsert('x', { v: 2 }, 60);
    await a.destroy('x');
    expect(await a.find('x')).toBeUndefined();
    expect(await b.find('x')).toEqual({ v: 2 });
  });

  it('revokeByGrantId removes every kind with that grant_id', async () => {
    const Ctor = Adapter();
    const at = new Ctor('AccessToken');
    const rt = new Ctor('RefreshToken');
    const other = new Ctor('AccessToken');
    await at.upsert('a', { grantId: 'g' }, 60);
    await rt.upsert('r', { grantId: 'g' }, 60);
    await other.upsert('o', { grantId: 'h' }, 60);
    await at.revokeByGrantId('g');
    expect(await at.find('a')).toBeUndefined();
    expect(await rt.find('r')).toBeUndefined();
    expect(await other.find('o')).toEqual({ grantId: 'h' });
  });

  it('findByUid and findByUserCode are scoped to the kind', async () => {
    const Ctor = Adapter();
    const s = new Ctor('Session');
    const i = new Ctor('Interaction');
    const d = new Ctor('DeviceCode');
    await s.upsert('s', { uid: 'u1' }, 60);
    await i.upsert('i', { uid: 'u1' }, 60);
    await d.upsert('d', { userCode: 'ABCD' }, 60);
    expect(await s.findByUid('u1')).toEqual({ uid: 'u1' });
    expect(await i.findByUid('u1')).toEqual({ uid: 'u1' });
    expect(await new Ctor('AccessToken').findByUid('u1')).toBeUndefined();
    expect(await d.findByUserCode('ABCD')).toEqual({ userCode: 'ABCD' });
    expect(await s.findByUserCode('ABCD')).toBeUndefined();
    nowMs += 61_000;
    expect(await s.findByUid('u1')).toBeUndefined();
  });
});
