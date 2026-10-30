import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SessionStore } from '../bff/session.store';
import { RATE_LIMITER } from '../constants';
import { AuthError } from '../errors';
import { PasswordService } from '../security/password';
import type { RateLimiter } from '../security/rate-limiter';
import { UserService } from '../users/user.service';

export const STEP_UP_TTL_MS = 600_000;

@Injectable()
export class StepUpService {
  constructor(
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(UserService) private readonly users: UserService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async verifyPassword(sessionIdHash: string, password: string): Promise<void> {
    const attempt = this.limiter.hit(`sso:step-up:${sessionIdHash}`, 5, 900);
    if (!attempt.ok) throw new AuthError('rate_limited', 429, 'Too many step-up attempts', {
      retryAfterSec: attempt.retryAfterSec,
    });
    const session = await this.sessions.getByHash(sessionIdHash);
    if (!session || session.authMethod === 'unknown') throw new AuthError('unauthenticated', 401);
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'active' || !user.passwordHash) {
      await this.passwords.verifyDummy(password);
      await this.audit.record({ type: 'sso.step_up.failed', userId: session.userId });
      throw new AuthError('step_up_invalid', 403, 'CMS password verification required');
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.audit.record({ type: 'sso.step_up.failed', userId: user.id });
      throw new AuthError('step_up_invalid', 403, 'CMS password verification required');
    }
    // Audit BEFORE granting sensitive authority: failure must fail closed.
    await this.audit.record({ type: 'sso.step_up.success', userId: user.id });
    await this.sessions.setStepUpVerifiedAt(sessionIdHash, new Date());
  }

  async assertRecent(sessionIdHash: string, now: Date = new Date()): Promise<void> {
    const session = await this.sessions.getByHash(sessionIdHash);
    const verified = session?.stepUpVerifiedAt;
    if (!verified || now.getTime() < verified.getTime() ||
      now.getTime() - verified.getTime() >= STEP_UP_TTL_MS) {
      throw new AuthError('step_up_required', 403, 'Verify your CMS password to continue');
    }
  }
}
