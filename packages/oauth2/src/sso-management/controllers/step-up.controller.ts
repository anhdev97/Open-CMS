import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../../errors';
import type { AuthenticatedRequest } from '../../guard/session-auth.service';
import { parseBody } from '../../security/validate';
import { StepUpService } from '../step-up.service';

@Controller('api/admin/sso/step-up')
export class StepUpController {
  constructor(@Inject(StepUpService) private readonly stepUp: StepUpService) {}

  @Post()
  async verify(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!req.authSession) throw new AuthError('unauthenticated', 401);
    const { password } = parseBody(z.object({ password: z.string().min(1).max(1024) }).strict(), body);
    await this.stepUp.verifyPassword(req.authSession.idHash, password);
    return { ok: true, expiresInSeconds: 600 };
  }
}
