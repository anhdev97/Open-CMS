import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Headers,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, RequirePermission, type RequestUser } from '@opencloudcms/oauth2';
import { PAGE_API_ID } from '@opencloudcms/schema';
import { EntriesService, type ListParams } from './entries.service';
import { ContentRegistry } from './registry.service';
import { WorkflowService } from './workflow.service';

/** Accepts both `filter[name]=x` flat keys (Express 5) and nested objects (qs). */
export function parseListQuery(query: Record<string, unknown>): ListParams {
  const filter: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    const m = /^filter\[([A-Za-z0-9]+)\]$/.exec(k);
    if (m) {
      filter[m[1]] = String(v);
      continue;
    }
    const inm = /^filter\[([A-Za-z0-9]+)\]\[in\]$/.exec(k);
    if (inm) filter[`${inm[1]}[in]`] = String(v);
  }
  if (query.filter && typeof query.filter === 'object') {
    for (const [k, v] of Object.entries(query.filter as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'in' in v) filter[`${k}[in]`] = String((v as { in: unknown }).in);
      else filter[k] = String(v);
    }
  }
  return {
    locale: query.locale as string | undefined,
    fallback: query.fallback as string | undefined,
    sort: query.sort as string | undefined,
    limit: query.limit as string | undefined,
    offset: query.offset as string | undefined,
    filter,
  };
}

/** `If-Match: "<iso>"` or `<iso>` -> the ISO string; absent header = no optimistic check. */
function ifMatchValue(header: string | undefined): string | undefined {
  const v = header?.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return v ? v : undefined;
}

/**
 * Storefront / delivery API: published content only, no auth. Private types answer exactly like an unknown apiId
 * (`ContentRegistry.getPublic`); `ContentCorsMiddleware` does the same for preflights.
 */
@Controller('api/content')
export class ContentController {
  constructor(
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
  ) {}

  @Get(':apiId')
  list(@Param('apiId') apiId: string, @Query() query: Record<string, unknown>) {
    this.registry.getPublic(apiId);
    // Base pages are read publicly only through `opencloudcmsPage/base`.
    const mainWhere = apiId === PAGE_API_ID ? { kind: 'page' } : undefined;
    return this.entries.list(apiId, { ...parseListQuery(query), status: 'published', mainWhere });
  }

  @Get(':apiId/:documentId')
  async get(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('locale') locale?: string,
    @Query('fallback') fallback?: string,
  ) {
    this.registry.getPublic(apiId);
    const r = await this.entries.get(apiId, documentId, 'published', locale, fallback);
    if (apiId === PAGE_API_ID && r.data.kind === 'base') throw new NotFoundException(`${apiId} ${documentId} not found`);
    return r;
  }
}

/**
 * Management API: drafts, publishing, versions. Permissions are per method (spec B §4.2); publish/unpublish
 * depend on the type's `review` flag and are checked in EntriesService.
 */
@Controller('api/admin/content')
export class AdminContentController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @RequirePermission('content.read')
  @Get(':apiId')
  list(@Param('apiId') apiId: string, @Query() query: Record<string, unknown>) {
    const status = query.status === 'published' ? 'published' : 'draft';
    const workflow = query.workflow === undefined ? undefined : String(query.workflow);
    return this.entries.list(apiId, { ...parseListQuery(query), status, workflow });
  }

  @RequirePermission('content.read')
  @Get(':apiId/:documentId')
  get(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('locale') locale?: string,
    @Query('status') status?: string,
  ) {
    return this.entries.get(apiId, documentId, status === 'published' ? 'published' : 'draft', locale);
  }

  @RequirePermission('content.create')
  @Post(':apiId')
  create(@Param('apiId') apiId: string, @Body() body: unknown, @Query('locale') locale?: string) {
    return this.entries.create(apiId, body, locale);
  }

  /** Partial update of the draft; `If-Match: <updatedAt ISO>` enables the stale-draft check (409 `stale_draft`). */
  @RequirePermission('content.update')
  @Patch(':apiId/:documentId')
  update(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @Query('locale') locale?: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.entries.update(apiId, documentId, body, locale, user, { expectedUpdatedAt: ifMatchValue(ifMatch) });
  }

  @Post(':apiId/:documentId/publish')
  @HttpCode(200)
  publish(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
    @Body() body?: { force?: unknown } | null,
  ) {
    return this.entries.publish(apiId, documentId, user, 'publish', { force: body?.force === true });
  }

  /** Publish an entry that is In review (spec B §6.4 "Approve & publish"). */
  @RequirePermission('content.publish')
  @Post(':apiId/:documentId/approve')
  @HttpCode(200)
  approve(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentUser() user: RequestUser) {
    return this.entries.publish(apiId, documentId, user, 'approve');
  }

  @Post(':apiId/:documentId/unpublish')
  @HttpCode(200)
  unpublish(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: RequestUser,
    @Query('force') force?: string,
  ) {
    return this.entries.unpublish(apiId, documentId, user, { force: force === 'true' });
  }

  @RequirePermission('content.submit')
  @Post(':apiId/:documentId/submit')
  @HttpCode(200)
  submit(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentUser() user: RequestUser) {
    return this.entries.transition(apiId, documentId, 'submit', user);
  }

  /** The submitter or a user with `content.publish` (checked in WorkflowService). */
  @Post(':apiId/:documentId/withdraw')
  @HttpCode(200)
  withdraw(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentUser() user: RequestUser) {
    return this.entries.transition(apiId, documentId, 'withdraw', user);
  }

  @RequirePermission('content.publish')
  @Post(':apiId/:documentId/reject')
  @HttpCode(200)
  reject(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: { note?: unknown } | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.entries.transition(apiId, documentId, 'reject', user, body?.note);
  }

  @RequirePermission('content.delete')
  @Delete(':apiId/:documentId')
  remove(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.remove(apiId, documentId);
  }

  @RequirePermission('content.read')
  @Get(':apiId/:documentId/versions')
  versions(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.versions(apiId, documentId);
  }
}

/** Review queue (spec B §5.3). */
@Controller('api/admin/workflow')
export class WorkflowController {
  constructor(@Inject(WorkflowService) private readonly workflow: WorkflowService) {}

  @RequirePermission('content.publish')
  @Get('pending-count')
  pendingCount() {
    return this.workflow.pendingCount();
  }
}
