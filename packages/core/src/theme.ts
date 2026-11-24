/**
 * Brand theme API (dev only for writes). Reads `src/theme.ts` fresh on each GET so hand edits show; writes it with
 * the codegen printer through the schema write queue. The theme is served by the API only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Body, Controller, Get, Inject, Injectable, InternalServerErrorException, Put, UnprocessableEntityException } from '@nestjs/common';
import { RequirePermission } from '@opencloudcms/oauth2';
import { loadTheme, printThemeFile, themeFile } from '@opencloudcms/codegen';
import { validateTheme, type ThemeDefinition } from '@opencloudcms/schema';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from './options';
import { SchemaBuilderService } from './schema-builder';
import { SchemaWriteQueue } from './schema-write-queue';

@Injectable()
export class ThemeService {
  constructor(
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(SchemaBuilderService) private readonly builder: SchemaBuilderService,
    @Inject(SchemaWriteQueue) private readonly queue: SchemaWriteQueue,
  ) {}

  async get(): Promise<{ theme: ThemeDefinition | null; editable: boolean }> {
    let theme: ThemeDefinition | null;
    try {
      theme = await loadTheme(this.options.config);
    } catch (e) {
      throw new InternalServerErrorException((e as Error).message);
    }
    return { theme, editable: this.options.schemaEditable };
  }

  replace(body: unknown) {
    this.builder.assertEditable();
    return this.queue.run(async () => {
      const issues = validateTheme(body);
      if (issues.length) throw new UnprocessableEntityException({ message: 'Invalid theme', issues });
      const file = themeFile(this.options.config);
      const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, printThemeFile(body as ThemeDefinition));
        return await this.get();
      } catch (e) {
        if (before) fs.writeFileSync(file, before);
        else fs.rmSync(file, { force: true });
        throw e;
      }
    });
  }
}

@Controller('api/admin')
export class ThemeController {
  constructor(@Inject(ThemeService) private readonly service: ThemeService) {}

  @RequirePermission('content.read')
  @Get('theme')
  get() {
    return this.service.get();
  }

  @RequirePermission('settings.content-types')
  @Put('theme')
  replace(@Body() body: unknown) {
    return this.service.replace(body);
  }
}
