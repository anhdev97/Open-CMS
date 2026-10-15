import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, RATE_LIMITER } from '../constants';
import { AuthError } from '../errors';
import { Public } from '../guard/public.decorator';
import { IDENTITY_PROVIDERS, type IdentityProvider } from '../idp/identity-provider';
import { parseBody } from '../security/validate';
import { normalizeEmail } from '../security/email';
import { assertSameOrigin } from '../security/origin';
import { PasswordService } from '../security/password';
import type { RateLimiter } from '../security/rate-limiter';
import { UserService } from '../users/user.service';
import { InteractionExpired, InteractionService, LOGIN_EXPIRED_REDIRECT } from './interaction.service';

const loginSchema = z.object({
  email: z.string().min(1).max(320),
  // Never trimmed: leading/trailing spaces are part of the password.
  password: z.string().min(1).max(1024),
});

type Expired = { redirectTo: string };
type LoginFailReason = 'invalid_credentials' | 'account_disabled' | 'rate_limited';
const expired = (): Expired => ({ redirectTo: LOGIN_EXPIRED_REDIRECT });

/**
 * Spec §6.3 steps 4–5. Registered as a Nest route, so it is matched before oidc-provider, which is
 * mounted at /oauth2 only in ProviderService.onModuleInit.
 */
@Public()
@Controller('oauth2/interaction')
export class InteractionController {
  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(InteractionService) private readonly interactions: InteractionService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(IDENTITY_PROVIDERS) private readonly idps: IdentityProvider[],
  ) {}

  @Get(':uid')
  async details(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('uid') uid: string,
  ): Promise<{ loginHint?: string; idps: { id: string; label: string }[] } | Expired> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const interaction = await this.interactions.details(req, res, uid);
      const hint = interaction.params?.login_hint;
      return {
        loginHint: typeof hint === 'string' ? hint : undefined,
        idps: this.idps.map(({ id, label }) => ({ id, label })),
      };
    } catch (e) {
      if (e instanceof InteractionExpired) return expired();
      throw e;
    }
  }

  @Post(':uid/login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ): Promise<{ redirectTo: string }> {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    assertSameOrigin(Array.isArray(origin) ? origin[0] : origin, this.cfg.publicUrl);

    const parsed = parseBody(loginSchema, body);
    const email = normalizeEmail(parsed.email);
    const { password } = parsed;
    const ip = req.ip ?? 'unknown';
    const userAgent = req.headers['user-agent'];

    const { loginPerEmail, loginPerIp } = this.cfg.rateLimit;
    // M4: IP first; the email key is only created for an IP that is not limited, so a limited client
    // spraying emails adds no entries.
    const byIp = this.limiter.hit(`login:ip:${ip}`, loginPerIp.limit, loginPerIp.windowSec);
    const byEmail = byIp.ok
      ? this.limiter.hit(`login:email:${email}`, loginPerEmail.limit, loginPerEmail.windowSec)
      : { ok: true, retryAfterSec: 0 };
    if (!byIp.ok || !byEmail.ok) {
      // R14: audited without a user lookup (no userId), so blocked attempts leak nothing about accounts.
      const reason: LoginFailReason = 'rate_limited';
      await this.audit.record({ type: 'login_failed', ip, userAgent, meta: { reason } });
      const retryAfterSec = Math.max(byEmail.retryAfterSec, byIp.retryAfterSec);
      throw new AuthError('rate_limited', 429, 'Too many attempts', { retryAfterSec });
    }

    try {
      await this.interactions.details(req, res, uid);
    } catch (e) {
      if (e instanceof InteractionExpired) return expired();
      throw e;
    }

    const fail = async (reason: Exclude<LoginFailReason, 'rate_limited'>, userId?: string) => {
      await this.audit.record({ type: 'login_failed', userId, ip, userAgent, meta: { reason } });
      return reason === 'account_disabled'
        ? new AuthError('account_disabled', 403, 'Account is disabled')
        : new AuthError('invalid_credentials', 401, 'Invalid email or password');
    };

    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) {
      await this.passwords.verifyDummy(password);
      throw await fail('invalid_credentials', user?.id);
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw await fail('invalid_credentials', user.id);
    }
    if (user.status !== 'active') throw await fail('account_disabled', user.id);

    try {
      const out = await this.interactions.finishLogin(req, res, uid, user.id);
      await this.audit.record({ type: 'login_succeeded', userId: user.id, ip, userAgent });
      return out;
    } catch (e) {
      if (e instanceof InteractionExpired) return expired();
      throw e;
    }
  }
}
