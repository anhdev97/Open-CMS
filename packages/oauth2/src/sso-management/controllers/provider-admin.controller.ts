import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../../guard/current-user.decorator';
import type { AuthenticatedRequest } from '../../guard/session-auth.service';
import { parseBody } from '../../security/validate';
import { ProviderConfigService } from '../provider-config.service';
import { ProviderRecoveryService } from '../provider-recovery.service';
import { ProviderHealthService } from '../provider-health.service';
import { StepUpService } from '../step-up.service';

const id = z.string().uuid();
const createSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  displayName: z.string().trim().min(1).max(100),
  issuer: z.string().url(), clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(4096),
  scopes: z.array(z.string()).max(32).optional(),
}).strict();
const draftPatch = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  issuer: z.string().url().optional(),
  clientId: z.string().min(1).max(512).optional(),
  clientSecret: z.string().min(1).max(4096).optional(),
  scopes: z.array(z.string()).max(32).optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
const publishBody = z.object({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const recoveryBody = z.object({ sourceVersionId: z.string().uuid() }).strict();

@RequirePermission('settings.sso.read')
@Controller('api/admin/sso/providers')
export class ProviderAdminController {
  constructor(
    @Inject(ProviderConfigService) private readonly providers: ProviderConfigService,
    @Inject(ProviderRecoveryService) private readonly recovery: ProviderRecoveryService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
    @Inject(ProviderHealthService) private readonly health: ProviderHealthService,
  ) {}

  private async recent(req: AuthenticatedRequest): Promise<void> {
    if (!req.authSession) throw new AuthError('unauthenticated', 401);
    await this.stepUp.assertRecent(req.authSession.idHash);
  }

  @Get()
  async list(): Promise<{ data: Awaited<ReturnType<ProviderConfigService['listProviders']>> }> {
    return { data: await this.providers.listProviders() };
  }

  @Get(':id')
  async detail(@Param('id') providerId: string) {
    const validId = parseBody(id, providerId);
    const provider = (await this.providers.listProviders()).find((p) => p.id === validId);
    if (!provider) throw new AuthError('not_found', 404);
    return { data: { ...provider, versions: await this.providers.listVersions(validId) } };
  }

  @Get(':id/versions')
  async versions(@Param('id') providerId: string) {
    return { data: await this.providers.listVersions(parseBody(id, providerId)) };
  }

  @Get(':id/health')
  async healthHistory(@Param('id') providerId: string) {
    return { data: await this.health.getHistory(parseBody(id, providerId)) };
  }

  @Post(':id/probe')
  @RequirePermission('settings.sso.manage')
  async probe(@Param('id') providerId: string) {
    return { data: { status: await this.health.probe(parseBody(id, providerId)) } };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('settings.sso.manage')
  async create(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return { data: await this.providers.createDraft(parseBody(createSchema, body), user.id) };
  }

  @Patch(':id/draft')
  @RequirePermission('settings.sso.manage')
  async patch(@Param('id') providerId: string, @Body() body: unknown, @CurrentUser() user: RequestUser) {
    const { expectedUpdatedAt, ...config } = parseBody(draftPatch, body);
    await this.providers.updateDraft(parseBody(id, providerId), config, new Date(expectedUpdatedAt), user.id);
    return { ok: true };
  }

  @Post(':id/test')
  @RequirePermission('settings.sso.manage')
  async test(@Param('id') providerId: string, @CurrentUser() user: RequestUser) {
    return { data: await this.providers.testDraft(parseBody(id, providerId), user.id) };
  }

  @Post(':id/publish')
  @RequirePermission('settings.sso.manage')
  async publish(@Param('id') providerId: string, @Body() body: unknown,
    @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    const { expectedFingerprint } = parseBody(publishBody, body);
    return { data: { versionId: await this.providers.publish(parseBody(id, providerId), expectedFingerprint, user.id) } };
  }

  @Post(':id/disable')
  @RequirePermission('settings.sso.manage')
  async disable(@Param('id') providerId: string, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    await this.providers.disable(parseBody(id, providerId), user.id);
    return { ok: true };
  }

  @Post(':id/restore')
  @RequirePermission('settings.sso.manage')
  async restore(@Param('id') providerId: string, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    await this.providers.restore(parseBody(id, providerId), user.id);
    return { ok: true };
  }

  @Post(':id/archive')
  @RequirePermission('settings.sso.manage')
  async archive(@Param('id') providerId: string, @CurrentUser() user: RequestUser, @Req() req: AuthenticatedRequest) {
    await this.recent(req);
    await this.providers.archive(parseBody(id, providerId), user.id);
    return { ok: true };
  }

  @Post(':id/recovery-draft')
  @RequirePermission('settings.sso.manage')
  async recover(@Param('id') providerId: string, @Body() body: unknown, @CurrentUser() user: RequestUser) {
    const { sourceVersionId } = parseBody(recoveryBody, body);
    return { data: await this.recovery.createFromVersion(parseBody(id, providerId), sourceVersionId, user.id) };
  }
}
