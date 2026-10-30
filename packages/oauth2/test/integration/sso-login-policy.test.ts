import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { LoginPolicyService } from '../../src/sso-management/login-policy.service';
import { AuditService } from '../../src/audit/audit.service';
import { startTestDb, type TestDb } from '../support/db';

describe('SSO login policy', () => {
  let t: TestDb;
  let service: LoginPolicyService;
  beforeAll(async () => {
    t = await startTestDb();
    service = new LoginPolicyService(t.db, new AuditService(t.db));
  });
  afterAll(async () => { await t?.stop(); });

  it('defaults to disabled without affecting local login configuration', async () => {
    expect(await service.getPolicy()).toEqual({ enabled: false, revision: 0 });
    expect(await service.isSsoEnabled()).toBe(false);
  });

  it('updates with compare-and-swap and rejects stale writers', async () => {
    await service.setSsoEnabled(true, '00000000-0000-0000-0000-000000000001', 0);
    expect(await service.getPolicy()).toEqual({ enabled: true, revision: 1 });
    await expect(service.setSsoEnabled(false, '00000000-0000-0000-0000-000000000001', 0))
      .rejects.toBeInstanceOf(ConflictException);
    expect(await service.isSsoEnabled()).toBe(true);
    await service.setSsoEnabled(false, '00000000-0000-0000-0000-000000000001', 1);
    expect(await service.isSsoEnabled()).toBe(false);
  });
});
