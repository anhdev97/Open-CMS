/**
 * Content Type Builder API (dev only). The UI sends a definition; this writes
 * the *.schema.ts file and runs the same pipeline as `opencms migrate:create`
 * followed by `opencms migrate:up`. The generated files are what you commit.
 */
import * as path from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { captureProjectFiles, createMigration, DiffError, previewChange, restoreProjectFiles, writeSchemaChange } from '@opencms/codegen';
import { migrateUp } from '@opencms/db';
import type { ContentTypeDefinition } from '@opencms/schema';
import { FIELD_KINDS, SchemaValidationError, newId } from '@opencms/schema';
import { AdminGuard } from './content.controllers';
import { OPENCMS_DB, OPENCMS_OPTIONS, type ResolvedOpenCmsOptions } from './options';
import { ContentRegistry } from './registry.service';

function toHttp(e: unknown): never {
  if (e instanceof SchemaValidationError || e instanceof DiffError) {
    throw new BadRequestException({ message: e.name === 'DiffError' ? 'Unsupported schema change' : 'Invalid schema', issues: e.issues });
  }
  throw e;
}

@Injectable()
export class SchemaBuilderService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
  ) {}

  private assertEditable() {
    if (!this.options.schemaEditable) {
      throw new ForbiddenException('Schema editing is disabled (production mode). Change schema files in git and deploy migrations.');
    }
  }

  /** Schema changes are serialized: one migration at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async preview(change: { upsert?: ContentTypeDefinition; removeId?: string }) {
    try {
      const r = await previewChange(this.options.config, change);
      return { changed: r.diff.changed, summary: r.plan.summary, warnings: r.plan.warnings, sql: r.sql };
    } catch (e) {
      toHttp(e);
    }
  }

  apply(change: { upsert?: ContentTypeDefinition; removeId?: string }) {
    this.assertEditable();
    return this.exclusive(async () => {
      const config = this.options.config;
      const before = captureProjectFiles(config);
      try {
        const written = await writeSchemaChange(config, change);
        const result = await createMigration(config, { definitions: written.definitions });
        let runs;
        try {
          runs = await migrateUp(this.db, config.migrationsDir);
        } catch (e) {
          throw new BadRequestException({
            message: 'Migration failed and was rolled back; no files were changed',
            issues: [(e as Error).message],
          });
        }
        this.registry.reload(written.definitions);
        const rel = (p: string) => path.relative(config.root, p);
        return {
          status: result.status,
          schemaFile: written.file ? rel(written.file) : null,
          migrationFile: result.status === 'created' ? rel(result.file) : null,
          generated: result.generated.map(rel),
          applied: runs.map((r) => r.name),
          summary: result.status === 'up-to-date' ? [] : result.plan.plan.summary,
          warnings: result.status === 'up-to-date' ? [] : result.plan.plan.warnings,
          sql: result.status === 'up-to-date' ? [] : result.plan.sql,
        };
      } catch (e) {
        // Each migration runs in a transaction, so the DB is unchanged: undo the files too.
        restoreProjectFiles(config, before);
        toHttp(e);
      }
    });
  }
}

@UseGuards(AdminGuard)
@Controller('api/admin')
export class SchemaController {
  constructor(
    @Inject(SchemaBuilderService) private readonly builder: SchemaBuilderService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
  ) {}

  @Get('meta')
  meta() {
    return {
      schemaEditable: this.options.schemaEditable,
      defaultLocale: this.options.config.defaultLocale,
      locales: this.options.config.locales,
      fieldKinds: FIELD_KINDS,
      newIds: { contentType: newId('ct'), fields: Array.from({ length: 20 }, () => newId('fld')) },
    };
  }

  @Get('content-types')
  list() {
    return { data: this.registry.all() };
  }

  @Get('content-types/:apiId')
  get(@Param('apiId') apiId: string) {
    return { data: this.registry.get(apiId) };
  }

  /** Dry run: what migration would this definition produce? */
  @Post('content-types/plan')
  @HttpCode(200)
  plan(@Body() body: { definition?: ContentTypeDefinition; removeId?: string }) {
    return this.builder.preview({ upsert: body.definition, removeId: body.removeId });
  }

  @Post('content-types')
  @HttpCode(200)
  save(@Body() body: { definition: ContentTypeDefinition }) {
    if (!body?.definition) throw new BadRequestException('Body must be { definition }');
    return this.builder.apply({ upsert: body.definition });
  }

  @Delete('content-types/:id')
  remove(@Param('id') id: string) {
    return this.builder.apply({ removeId: id });
  }
}
