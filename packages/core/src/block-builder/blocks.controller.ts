import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { RequirePermission } from '@opencloudcms/oauth2';
import { BlocksService } from './blocks.service';

/** Block Builder API. Same permission as the Content Type Builder; writes only when `schemaEditable`. */
@Controller('api/admin/blocks')
export class BlocksController {
  constructor(@Inject(BlocksService) private readonly blocks: BlocksService) {}

  @RequirePermission('settings.content-types')
  @Header('Cache-Control', 'no-store')
  @Get()
  list() {
    return this.blocks.list();
  }

  @RequirePermission('settings.content-types')
  @Header('Cache-Control', 'no-store')
  @Get(':name')
  get(@Param('name') name: string) {
    return this.blocks.get(name);
  }

  @RequirePermission('settings.content-types')
  @Put(':name')
  save(@Param('name') name: string, @Body() body: { spec?: unknown; confirmBreaking?: boolean } | undefined) {
    return this.blocks.save(name, body);
  }

  @RequirePermission('settings.content-types')
  @Delete(':name')
  remove(@Param('name') name: string, @Query('force') force?: string) {
    return this.blocks.remove(name, force === '1' || force === 'true');
  }

  /** Dev only: turn a composed block into a hand-written `.block.tsx` → `{ file, importLine, files }`. */
  @RequirePermission('settings.content-types')
  @HttpCode(200)
  @Post(':name/eject')
  eject(@Param('name') name: string) {
    return this.blocks.eject(name);
  }
}
