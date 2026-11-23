import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { RequirePermission } from '@opencloudcms/oauth2';
import { PagesService } from './pages.service';

/**
 * Registered before ContentController / AdminContentController: `by-path` would otherwise be matched by
 * `:apiId/:documentId` and rejected by its UUID pipe.
 */
@Controller('api/content/opencloudcmsPage')
export class PublicPagesController {
  constructor(@Inject(PagesService) private readonly pages: PagesService) {}

  @Get('by-path')
  byPath(@Query('path') path?: string, @Query('locale') locale?: string) {
    return this.pages.byPath('published', path, locale);
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
}
