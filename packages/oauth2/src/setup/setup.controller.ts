import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, RATE_LIMITER } from '../constants';
import { AuthError } from '../errors';
import { Public } from '../guard/public.decorator';
import { assertSameOrigin } from '../security/origin';
import type { RateLimiter } from '../security/rate-limiter';
import { normalizeEmail } from '../security/email';
import { UserService } from '../users/user.service';
import { SetupState } from './setup-state';

const bodySchema = z.object({
  email: z.string().transform(normalizeEmail).pipe(z.string().email().max(320)),
  name: z.string().min(1).max(255),
  password: z.string(),
});

@Controller('api/auth/setup')
export class SetupController {
  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(UserService) private readonly users: UserService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(SetupState) private readonly state: SetupState,
  ) {}

  @Public()
  @Get()
  async status(): Promise<{ required: boolean }> {
    return { required: await this.state.isRequired() };
  }

  @Public()
  @Post()
  @HttpCode(201)
  async setup(
    @Req() req: { headers: Record<string, string | string[] | undefined>; ip?: string },
    @Body() body: unknown,
  ): Promise<{ id: string; email: string }> {
    const origin = req.headers.origin;
    assertSameOrigin(Array.isArray(origin) ? origin[0] : origin, this.cfg.publicUrl);
    const { limit, windowSec } = this.cfg.rateLimit.loginPerIp;
    const hit = this.limiter.hit(`setup:${req.ip ?? 'unknown'}`, limit, windowSec);
    if (!hit.ok) throw new AuthError('rate_limited', 429, 'Too many attempts', { retryAfterSec: hit.retryAfterSec });

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AuthError('validation_failed', 422, msg);
    }
    const { email, name, password } = parsed.data;

    const user = await this.users.withSetupLock(async (trx) => {
      if ((await this.users.countUsers(trx)) > 0) {
        throw new AuthError('setup_already_completed', 409, 'Setup has already been completed');
      }
      const u = await this.users.create({ email, name, password }, trx);
      await this.audit.record({ type: 'setup_completed', userId: u.id, ip: req.ip, meta: { email } }, trx);
      return u;
    });
    this.state.markCompleted();
    return { id: user.id, email: user.email };
  }
}
