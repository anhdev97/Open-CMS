import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditService } from '../../src/audit/audit.service';
import { loadConfig } from '../../src/config/schema';
import { GRANT_REVOKER, OAUTH2_CONFIG, OAUTH2_DB, RATE_LIMITER } from '../../src/constants';
import { AuthExceptionFilter } from '../../src/errors';
import { PasswordService } from '../../src/security/password';
import { InMemoryRateLimiter } from '../../src/security/rate-limiter';
import { SetupController } from '../../src/setup/setup.controller';
import { SetupState } from '../../src/setup/setup-state';
import { UserService } from '../../src/users/user.service';
import { startTestDb } from '../support/db';

const ORIGIN = 'http://cms.test';
const PW = 'correct horse battery';

describe('setup wizard API', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let app: INestApplication;
  const cfg = loadConfig({ OPENCMS_SECRET: Buffer.alloc(32, 7).toString('base64'), OPENCMS_PUBLIC_URL: ORIGIN });

  beforeAll(async () => {
    ctx = await startTestDb();
    const mod = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        { provide: OAUTH2_DB, useValue: ctx.db },
        { provide: OAUTH2_CONFIG, useValue: cfg },
        { provide: GRANT_REVOKER, useValue: { revokeAllGrants: vi.fn(async () => {}) } },
        { provide: RATE_LIMITER, useValue: new InMemoryRateLimiter() },
        { provide: PasswordService, useValue: new PasswordService({ minLength: 12 }) },
        AuditService,
        {
          provide: UserService,
          useFactory: (db: any, a: AuditService) =>
            new UserService(db, new PasswordService({ minLength: 12 }), a, { revokeAllGrants: async () => {} }),
          inject: [OAUTH2_DB, AuditService],
        },
        SetupState,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await ctx.stop();
  });

  const post = (body: unknown, origin: string | null = ORIGIN) => {
    const r = request(app.getHttpServer()).post('/api/auth/setup');
    if (origin) r.set('Origin', origin);
    return r.send(body as object);
  };

  it('rejects missing origin, weak password, invalid body', async () => {
    const a = await post({ email: 'a@x.com', name: 'A', password: PW }, null);
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe('origin_mismatch');
    const b = await post({ email: 'a@x.com', name: 'A', password: '12345678901' });
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe('weak_password');
    const c = await post({ email: 'nope', name: 'A', password: PW });
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe('validation_failed');
  });

  it('concurrent POSTs: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      post({ email: 'one@x.com', name: 'One', password: PW }),
      post({ email: 'two@x.com', name: 'Two', password: PW }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('setup_already_completed');
  });
});

describe('setup wizard flow', () => {
  // Boots its own DB + Nest app inside the test (not beforeAll); needs headroom under CI load.
  it(
    'GET required true -> POST normalized email 201 -> GET required false',
    async () => {
      const ctx = await startTestDb();
      const cfg = loadConfig({ OPENCMS_SECRET: Buffer.alloc(32, 7).toString('base64'), OPENCMS_PUBLIC_URL: ORIGIN });
      const mod = await Test.createTestingModule({
        controllers: [SetupController],
        providers: [
          { provide: OAUTH2_DB, useValue: ctx.db },
          { provide: OAUTH2_CONFIG, useValue: cfg },
          { provide: GRANT_REVOKER, useValue: { revokeAllGrants: vi.fn(async () => {}) } },
          { provide: RATE_LIMITER, useValue: new InMemoryRateLimiter() },
          { provide: PasswordService, useValue: new PasswordService({ minLength: 12 }) },
          AuditService,
          {
            provide: UserService,
            useFactory: (db: any, a: AuditService) =>
              new UserService(db, new PasswordService({ minLength: 12 }), a, { revokeAllGrants: async () => {} }),
            inject: [OAUTH2_DB, AuditService],
          },
          SetupState,
        ],
      }).compile();
      const app = mod.createNestApplication();
      app.useGlobalFilters(new AuthExceptionFilter());
      await app.init();
      try {
        const s = () => request(app.getHttpServer());
        expect((await s().get('/api/auth/setup')).body).toEqual({ required: true });
        const r = await s().post('/api/auth/setup').set('Origin', ORIGIN).send({ email: 'Admin@X.com ', name: 'Root', password: PW });
        expect(r.status).toBe(201);
        expect(r.body.email).toBe('admin@x.com');
        expect(typeof r.body.id).toBe('string');
        expect((await s().get('/api/auth/setup')).body).toEqual({ required: false });
        const ev = await ctx.db.selectFrom('auth_audit_events').select('type').where('type', '=', 'setup_completed').execute();
        expect(ev).toHaveLength(1);
      } finally {
        await app.close();
        await ctx.stop();
      }
    },
    20_000,
  );
});
