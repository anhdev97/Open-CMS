import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../../guard/current-user.decorator';
import type { AuthenticatedRequest } from '../../guard/session-auth.service';
import { parseBody } from '../../security/validate';
import { IdentityBlockService } from '../identity-block.service';
import { StepUpService } from '../step-up.service';

const identitySchema = z.object({
  providerCode: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  subject: z.string().min(1).max(2048),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

@RequirePermission('settings.sso.identities')
@Controller('api/admin/sso/identities')
export class IdentityAdminController {
  constructor(
    @Inject(IdentityBlockService) private readonly identities: IdentityBlockService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
  ) {}

  private async recent(req: AuthenticatedRequest): Promise<void> {
    if (!req.authSession) throw new AuthError('unauthenticated', 401);
    await this.stepUp.assertRecent(req.authSession.idHash);
  }

  @Post('block')
  async block(@Body() body: unknown, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    const input = parseBody(identitySchema, body);
    if (!input.reason) throw new AuthError('validation_error', 400, 'Block reason is required');
    return { data: { revokedSessions: await this.identities.block({
      providerCode: input.providerCode, subject: input.subject, reason: input.reason, actorId: user.id,
    }) } };
  }

  @Post('unblock')
  async unblock(@Body() body: unknown, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    const input = parseBody(identitySchema, body);
    await this.identities.unblock({
      providerCode: input.providerCode, subject: input.subject, actorId: user.id,
    });
    return { ok: true };
  }

  @Post(':id/unlink')
  async unlink(@Param('id') identityId: string, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    await this.identities.unlink(parseBody(z.string().uuid(), identityId), user.id, user.isSuperAdmin);
    return { ok: true };
  }
}
