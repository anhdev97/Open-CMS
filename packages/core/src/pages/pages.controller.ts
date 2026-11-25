import { BadRequestException, Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { RequirePermission } from '@opencloudcms/oauth2';
import { PagesService } from './pages.service';

/**
 * Registered before ContentController / AdminContentController: `by-path` and `base` would otherwise be matched by
 * `:apiId/:documentId` and rejected by its UUID pipe.
 */
@Controller('api/content/opencloudcmsPage')
export class PublicPagesController {
  constructor(@Inject(PagesService) private readonly pages: PagesService) {}

  @Get('by-path')
  byPath(@Query('path') path?: string, @Query('locale') locale?: string) {
    return this.pages.byPath('published', path, locale);
  }

  /** `id`: a base page's document id or `default`. The published base in `locale` (fallback: default locale). */
  @Get('base')
  base(@Query('id') id?: string, @Query('locale') locale?: string) {
    return this.pages.base('published', id, locale);
  }
}

@Controller('api/admin/content/opencloudcmsPage')
export class AdminPagesController {
  constructor(@Inject(PagesService) private readonly pages: PagesService) {}

  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('by-path')
  byPath(@Query('path') path?: string, @Query('locale') locale?: string) {
    return this.pages.byPath('draft', path, locale);
  }

  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('base')
  base(@Query('id') id?: string, @Query('locale') locale?: string) {
    return this.pages.base('draft', id, locale);
  }
}

@Controller('api/admin/pages')
export class PagesController {
  constructor(@Inject(PagesService) private readonly pages: PagesService) {}

  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('blocks-check')
  blocksCheck() {
    return this.pages.blocksCheck();
  }

  /** `{ data: string[] }`: page paths that a file route of the website shadows (the editor warns about them). */
  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('shadowed')
  shadowed() {
    return this.pages.shadowed();
  }

  /** `{ data }`: base page drafts (default locale), the default first. */
  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('bases')
  bases() {
    return this.pages.bases('draft');
  }

  /** `{ documentId: string | null }`: makes a published base page the default, or clears the default. */
  @RequirePermission('content.publish')
  @Put('bases/default')
  setDefault(@Body() body?: { documentId?: unknown } | null) {
    if (!body || typeof body !== 'object' || !('documentId' in body)) throw new BadRequestException('Body must be { documentId: string | null }');
    return this.pages.setDefault(body.documentId as string | null);
  }

  /** `{ count, pages: { documentId, title, path }[] }`: pages the base page frames. */
  @RequirePermission('content.read')
  @Header('Cache-Control', 'no-store')
  @Get('bases/:documentId/usage')
  usage(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.pages.usage(documentId);
  }
}
