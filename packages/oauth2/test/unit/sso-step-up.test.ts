import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from '../../src/security/rate-limiter';
import { StepUpService, STEP_UP_TTL_MS } from '../../src/sso-management/step-up.service';
import type { SessionStore } from '../../src/bff/session.store';
import type { UserService } from '../../src/users/user.service';
import type { PasswordService } from '../../src/security/password';
import type { AuditService } from '../../src/audit/audit.service';

describe('session-scoped SSO password step-up', () => {
  const idHash = 'auth-session-hash';
  const verifiedPassword = 'correct CMS password';
  function setup(passwordHash: string | null = 'hashed') {
    let stepUpAt: Date | undefined;
    const sessions = {
      getByHash: vi.fn(async (id: string) => id === idHash ? {
        userId: 'user-1', authMethod: 'oidc', stepUpVerifiedAt: stepUpAt,
      } : undefined),
      setStepUpVerifiedAt: vi.fn(async (_id: string, at: Date) => { stepUpAt = at; }),
    } as unknown as SessionStore;
    const users = { findById: vi.fn(async () => ({
      id: 'user-1', status: 'active', passwordHash,
    })) } as unknown as UserService;
    const passwords = {
      verify: vi.fn(async (_hash: string, input: string) => input === verifiedPassword),
      verifyDummy: vi.fn(async (_input: string) => false),
    } as unknown as PasswordService;
    const audit = { record: vi.fn(async () => {}) } as unknown as AuditService;
    return {
      stepUp: new StepUpService(sessions, users, passwords, new InMemoryRateLimiter(), audit),
      sessions, passwords, audit,
      getVerifiedAt: () => stepUpAt,
    };
  }

  it('rejects access before CMS password verification', async () => {
    const { stepUp } = setup();
    await expect(stepUp.assertRecent(idHash)).rejects.toMatchObject({ code: 'step_up_required' });
  });

  it('requires actual CMS password and records only a sanitized audit event', async () => {
    const { stepUp, audit } = setup();
    await expect(stepUp.verifyPassword(idHash, 'incorrect'))
      .rejects.toMatchObject({ code: 'step_up_invalid' });
    expect(audit.record).toHaveBeenCalledWith({
      type: 'sso.step_up.failed', userId: 'user-1',
    });
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain('incorrect');
  });

  it('permits privileged operations for only ten minutes after verification', async () => {
    const { stepUp, getVerifiedAt } = setup();
    await stepUp.verifyPassword(idHash, verifiedPassword);
    const verifiedAt = getVerifiedAt();
    expect(verifiedAt).toBeInstanceOf(Date);
    await expect(stepUp.assertRecent(idHash, new Date(verifiedAt!.getTime() + STEP_UP_TTL_MS - 1)))
      .resolves.toBeUndefined();
    await expect(stepUp.assertRecent(idHash, new Date(verifiedAt!.getTime() + STEP_UP_TTL_MS)))
      .rejects.toMatchObject({ code: 'step_up_required' });
  });

  it('fails closed if SSO admin has no CMS password', async () => {
    const { stepUp, passwords } = setup(null);
    await expect(stepUp.verifyPassword(idHash, verifiedPassword))
      .rejects.toMatchObject({ code: 'step_up_invalid' });
    expect(passwords.verifyDummy).toHaveBeenCalled();
  });

  it('rate limits guesses per session', async () => {
    const { stepUp } = setup();
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(stepUp.verifyPassword(idHash, 'incorrect'))
        .rejects.toMatchObject({ code: 'step_up_invalid' });
    }
    await expect(stepUp.verifyPassword(idHash, verifiedPassword))
      .rejects.toMatchObject({ code: 'rate_limited' });
  });
});
