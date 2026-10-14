import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { EntriesService, type ListParams } from './entries.service';
import { OPENCMS_OPTIONS, type ResolvedOpenCmsOptions } from './options';

/** Accepts both `filter[name]=x` flat keys (Express 5) and nested objects (qs). */
export function parseListQuery(query: Record<string, unknown>): ListParams {
  const filter: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    const m = /^filter\[([A-Za-z0-9]+)\]$/.exec(k);
    if (m) filter[m[1]] = String(v);
  }
  if (query.filter && typeof query.filter === 'object') {
    for (const [k, v] of Object.entries(query.filter as Record<string, unknown>)) filter[k] = String(v);
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

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (!this.options.adminToken) return true;
    const header = ctx.switchToHttp().getRequest().headers?.authorization ?? '';
    if (header === `Bearer ${this.options.adminToken}`) return true;
    throw new UnauthorizedException('Missing or invalid admin token');
  }
}

/** Storefront / delivery API: published content only, no auth. */
@Controller('api/content')
export class ContentController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get(':apiId')
  list(@Param('apiId') apiId: string, @Query() query: Record<string, unknown>) {
    return this.entries.list(apiId, { ...parseListQuery(query), status: 'published' });
  }

  @Get(':apiId/:documentId')
  get(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('locale') locale?: string,
    @Query('fallback') fallback?: string,
  ) {
    return this.entries.get(apiId, documentId, 'published', locale, fallback);
  }
}

/** Management API: drafts, publishing, versions. */
@UseGuards(AdminGuard)
@Controller('api/admin/content')
export class AdminContentController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get(':apiId')
  list(@Param('apiId') apiId: string, @Query() query: Record<string, unknown>) {
    const status = query.status === 'published' ? 'published' : 'draft';
    return this.entries.list(apiId, { ...parseListQuery(query), status });
  }

  @Get(':apiId/:documentId')
  get(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('locale') locale?: string,
    @Query('status') status?: string,
  ) {
    return this.entries.get(apiId, documentId, status === 'published' ? 'published' : 'draft', locale);
  }

  @Post(':apiId')
  create(@Param('apiId') apiId: string, @Body() body: unknown, @Query('locale') locale?: string) {
    return this.entries.create(apiId, body, locale);
  }

  @Patch(':apiId/:documentId')
  update(
    @Param('apiId') apiId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
    @Query('locale') locale?: string,
  ) {
    return this.entries.update(apiId, documentId, body, locale);
  }

  @Post(':apiId/:documentId/publish')
  @HttpCode(200)
  publish(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.publish(apiId, documentId);
  }

  @Post(':apiId/:documentId/unpublish')
  @HttpCode(200)
  unpublish(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.unpublish(apiId, documentId);
  }

  @Delete(':apiId/:documentId')
  remove(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.remove(apiId, documentId);
  }

  @Get(':apiId/:documentId/versions')
  versions(@Param('apiId') apiId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.entries.versions(apiId, documentId);
  }
}
