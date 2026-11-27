import {
  Body,
  Catch,
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
  BadRequestException,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { AssetsService, AssetUploadInterceptor, decodeMultipartFilename, type UploadedFileInput } from '@opencloudcms/assets';
import { CurrentUser, RequirePermission, type RequestUser } from '@opencloudcms/oauth2';
import { PAGE_API_ID } from '@opencloudcms/schema';
import { EntriesService, type ListParams } from './entries.service';
import { ContentRegistry } from './registry.service';
import { PrivateAssetOwnership } from './private-assets';
import { pageHidesDetail } from './pages/detail';
import { SlugError } from './slugs';
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
    // Base pages and detail templates are read publicly only through `opencloudcmsPage/base` and `by-path`.
    if (apiId === PAGE_API_ID && (r.data.kind === 'base' || r.data.kind === 'detail')) throw new NotFoundException(`${apiId} ${documentId} not found`);
    return r;
  }
}

/**
 * `{ error: { code, message, path, locale?, issues } }` for slug errors: the global API filter keeps only code, message
 * and issues, and the entry form needs `path` (spec §2: typed duplicate → 422 `slug_taken` with the field path).
 */
@Catch(SlugError)
export class SlugErrorFilter implements ExceptionFilter<SlugError> {
  catch(err: SlugError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(err.getStatus()).json({ error: err.getResponse() });
  }
}

/**
 * Management API: drafts, publishing, versions. Permissions are per method (spec B §4.2); publish/unpublish
 * depend on the type's `review` flag and are checked in EntriesService.
 */
@Controller('api/admin/content')
@UseFilters(SlugErrorFilter)
export class AdminContentController {
  constructor(
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
  ) {}

  /**
   * Page saves: `warnings` (only when there are any) when the saved ordinary page's path matches a detail pattern
   * (spec §3 routing 4). Other responses are unchanged.
   */
  private withPageWarnings<T extends { data: Record<string, unknown> }>(apiId: string, r: T): T | (T & { warnings: unknown[] }) {
    if (apiId !== PAGE_API_ID || r.data.kind !== 'page') return r;
    const defs = this.registry.all().filter((d) => !this.registry.isCore(d.apiId));
    const warnings = pageHidesDetail(defs, r.data.path);
    return warnings.length ? { ...r, warnings } : r;
  }

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
  async create(@Param('apiId') apiId: string, @Body() body: unknown, @Query('locale') locale?: string) {
    return this.withPageWarnings(apiId, await this.entries.create(apiId, body, locale));
  }

  /** Partial update of the draft; `If-Match: <updatedAt ISO>` enables the stale-draft check (409 `stale_draft`). */
  @RequirePermission('content.update')
  @Patch(':apiId/:documentId')
  async update(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @Query('locale') locale?: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.withPageWarnings(apiId, await this.entries.update(apiId, documentId, body, locale, user, { expectedUpdatedAt: ifMatchValue(ifMatch) }));
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

/**
 * Metadata (`{ id, filename, size, mime }[]`) of the private files an entry of a private type owns, for the admin
 * entry pages. 404 for unknown and public types and for unknown entries.
 */
@Controller('api/admin/content')
export class PrivateEntryFilesController {
  constructor(
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(PrivateAssetOwnership) private readonly ownership: PrivateAssetOwnership,
  ) {}

  @RequirePermission('content.read')
  @Get(':apiId/:documentId/files')
  async files(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    const def = this.registry.get(apiId);
    if (!def.private) throw new NotFoundException(`"${apiId}" has no entry files`);
    await this.entries.get(apiId, documentId, 'draft');
    return { data: await this.ownership.files(def, documentId) };
  }
}

/**
 * Upload into an asset field of a private type (spec §7, decision 9): multipart `file` + `field` (the asset field's
 * name). The file is sniffed against the field's `accept`, limited by the assets `maxBytes`, stored privately and
 * owned by the uploader until an entry save attaches it (unattached uploads are swept after 24 h). Registered only
 * when asset uploads are configured.
 */
@Controller('api/admin/content')
export class PrivateAssetUploadController {
  constructor(
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(AssetsService) private readonly assets: AssetsService,
  ) {}

  @RequirePermission('content.update')
  @Post(':apiId/assets')
  @UseInterceptors(AssetUploadInterceptor)
  async upload(
    @Param('apiId') apiId: string,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body('field') fieldName: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const def = this.registry.get(apiId);
    if (!def.private) {
      throw new BadRequestException({ code: 'not_private', message: `"${apiId}" is not a private content type: use the media library` });
    }
    const field = def.fields.find((f) => f.name === fieldName && f.kind === 'asset');
    if (!field) throw new BadRequestException({ code: 'invalid_field', message: `"${String(fieldName)}" is not an asset field of ${apiId}` });
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    const data = await this.assets.uploadPrivate(
      { buffer: file.buffer, filename: decodeMultipartFilename(file.originalname), contentType: file.mimetype },
      { ownerApiId: apiId, accept: (field.options as { accept?: string[] }).accept, uploadedBy: user?.id ?? null },
    );
    return { data };
  }
}
