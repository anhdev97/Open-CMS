import { Body, Controller, Get, Inject, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../../guard/current-user.decorator';
import type { AuthenticatedRequest } from '../../guard/session-auth.service';
import { parseBody } from '../../security/validate';
import { LoginPolicyService } from '../login-policy.service';
import { StepUpService } from '../step-up.service';

const patchSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

@RequirePermission('settings.sso.read')
@Controller('api/admin/sso/policy')
export class PolicyAdminController {
  constructor(
    @Inject(LoginPolicyService) private readonly policy: LoginPolicyService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
  ) {}

  @Get()
  async get() { return { data: await this.policy.getPolicy() }; }

  @Patch()
  @RequirePermission('settings.sso.manage')
  async patch(@Body() body: unknown, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    if (!req.authSession) throw new AuthError('unauthenticated', 401);
    await this.stepUp.assertRecent(req.authSession.idHash);
    const { enabled, expectedRevision } = parseBody(patchSchema, body);
    await this.policy.setSsoEnabled(enabled, user.id, expectedRevision);
    return { data: await this.policy.getPolicy() };
  }
}
