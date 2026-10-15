import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SessionStore } from '../bff/session.store';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, RATE_LIMITER } from '../constants';
import { AuthError } from '../errors';
import { CurrentUser, type RequestUser } from '../guard/current-user.decorator';
import type { AuthenticatedRequest } from '../guard/session-auth.service';
import { PasswordService } from '../security/password';
import type { RateLimiter } from '../security/rate-limiter';
import { parseBody } from '../security/validate';
import { UserService } from './user.service';

const bodySchema = z.object({ currentPassword: z.string(), newPassword: z.string() }).strict();

@Controller('api/auth/password')
export class PasswordController {
  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(UserService) private readonly users: UserService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  /** Any authenticated user (no role required): change own password, keep this session, drop the others. */
  @Post()
  @HttpCode(204)
  async change(@Body() body: unknown, @CurrentUser() me: RequestUser, @Req() req: AuthenticatedRequest): Promise<void> {
    const { limit, windowSec } = this.cfg.rateLimit.loginPerEmail;
    const hit = this.limiter.hit(`pwchange:${me.id}`, limit, windowSec);
    if (!hit.ok) throw new AuthError('rate_limited', 429, 'Too many attempts', { retryAfterSec: hit.retryAfterSec });

    const { currentPassword, newPassword } = parseBody(bodySchema, body);

    const user = await this.users.findById(me.id);
    if (!user) throw new AuthError('unauthenticated', 401, 'Not authenticated');
    const ok = user.passwordHash
      ? await this.passwords.verify(user.passwordHash, currentPassword)
      : await this.passwords.verifyDummy(currentPassword);
    if (!ok) throw new AuthError('invalid_credentials', 401, 'Invalid credentials');

    await this.users.setPassword(me.id, newPassword);
    const exceptSessionId = req.authSession?.idHash;
    const exceptGrantId = exceptSessionId ? await this.sessions.grantIdOf(exceptSessionId) : undefined;
    await this.users.revokeAll(me.id, { exceptSessionId, exceptGrantId });
    await this.audit.record({ type: 'password_changed', userId: me.id, actorId: me.id });
  }
}
