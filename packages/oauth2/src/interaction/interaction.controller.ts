import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, RATE_LIMITER } from '../constants';
import { AuthError } from '../errors';
import { Public } from '../guard/public.decorator';
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
      return { loginHint: typeof hint === 'string' ? hint : undefined, idps: [] };
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

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AuthError('validation_failed', 422, msg);
    }
    const email = normalizeEmail(parsed.data.email);
    const { password } = parsed.data;
    const ip = req.ip ?? 'unknown';
    const userAgent = req.headers['user-agent'];

    const { loginPerEmail, loginPerIp } = this.cfg.rateLimit;
    const byEmail = this.limiter.hit(`login:email:${email}`, loginPerEmail.limit, loginPerEmail.windowSec);
    const byIp = this.limiter.hit(`login:ip:${ip}`, loginPerIp.limit, loginPerIp.windowSec);
    if (!byEmail.ok || !byIp.ok) {
      const retryAfterSec = Math.max(byEmail.retryAfterSec, byIp.retryAfterSec);
      throw new AuthError('rate_limited', 429, 'Too many attempts', { retryAfterSec });
    }

    try {
      await this.interactions.details(req, res, uid);
    } catch (e) {
      if (e instanceof InteractionExpired) return expired();
      throw e;
    }

    const fail = async (reason: 'invalid_credentials' | 'account_disabled', userId?: string) => {
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
