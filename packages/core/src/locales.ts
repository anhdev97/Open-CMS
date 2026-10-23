/**
 * Website locales API (dev only for writes). Writes `src/locales.ts` with the codegen printer and updates
 * the resolved config in memory, so the change applies without a restart. Shares the schema write queue.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Body, ConflictException, Controller, ForbiddenException, Get, Inject, Injectable, Put, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { RequirePermission } from '@opencms/oauth2';
import { localesFile, printLocalesFile } from '@opencms/codegen';
import { SUPPORTED_LOCALES, isLocale, l10nTable, validateLocaleSettings, type Locale } from '@opencms/schema';
import { OPENCMS_DB, OPENCMS_OPTIONS, type ResolvedOpenCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { SchemaBuilderService } from './schema-builder';
import { SchemaWriteQueue } from './schema-write-queue';

@Injectable()
export class LocalesService {
  constructor(
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(SchemaBuilderService) private readonly builder: SchemaBuilderService,
    @Inject(SchemaWriteQueue) private readonly queue: SchemaWriteQueue,
  ) {}

  private editable(): boolean {
    return this.options.schemaEditable && fs.existsSync(localesFile(this.options.config));
  }

  private async entryCounts(): Promise<Record<Locale, number>> {
    const counts = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.code, 0])) as Record<Locale, number>;
    for (const def of this.registry.all()) {
      const rows = await sql<{ locale: string; n: string }>`select locale, count(*)::text as n from ${sql.id(l10nTable(def))} group by locale`.execute(this.db);
      for (const r of rows.rows) if (isLocale(r.locale)) counts[r.locale] += Number(r.n);
    }
    return counts;
  }

  async get() {
    const { locales, defaultLocale } = this.options.config;
    return { supported: SUPPORTED_LOCALES, locales: [...locales], defaultLocale, editable: this.editable(), entryCounts: await this.entryCounts() };
  }

  replace(body: { locales?: unknown; defaultLocale?: unknown; confirmDisable?: unknown }) {
    this.builder.assertEditable();
    return this.queue.run(async () => {
      if (!fs.existsSync(localesFile(this.options.config))) {
        throw new ForbiddenException('src/locales.ts does not exist; move the locale settings into it to manage them here.');
      }
      const issues = validateLocaleSettings({ locales: body?.locales, defaultLocale: body?.defaultLocale });
      if (issues.length) throw new UnprocessableEntityException({ message: 'Invalid locale settings', issues: issues.map((message) => ({ path: [], message })) });
      const locales = body.locales as Locale[];
      const defaultLocale = body.defaultLocale as Locale;
      const confirm = new Set(Array.isArray(body.confirmDisable) ? body.confirmDisable : []);
      const removed = this.options.config.locales.filter((l) => !locales.includes(l));
      if (removed.length) {
        const counts = await this.entryCounts();
        const blocking = removed.filter((l) => counts[l] > 0 && !confirm.has(l));
        if (blocking.length) {
          throw new ConflictException({
            code: 'locale_has_entries',
            message: 'Locales still have entries; confirm to disable them',
            issues: blocking.map((l) => ({ path: [l], message: String(counts[l]) })),
          });
        }
      }
      const file = localesFile(this.options.config);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, printLocalesFile({ locales, defaultLocale }));
      this.options.config.locales = [...locales];
      this.options.config.defaultLocale = defaultLocale;
      return this.get();
    });
  }
}

@RequirePermission('settings.languages')
@Controller('api/admin')
export class LocalesController {
  constructor(@Inject(LocalesService) private readonly service: LocalesService) {}

  @Get('locales')
  get() {
    return this.service.get();
  }

  @Put('locales')
  replace(@Body() body: { locales?: unknown; defaultLocale?: unknown; confirmDisable?: unknown }) {
    return this.service.replace(body ?? {});
  }
}
