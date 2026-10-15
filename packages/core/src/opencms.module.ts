// Side-effect, Nest-free: registers oauth2_0001_init with the core migration stream. The `opencms` CLI
// registers it too, so every process that migrates (autoMigrate, the Content Type Builder) must know it,
// or Kysely reports a missing migration.
import '@opencms/oauth2/migrations';
import { Inject, Logger, Module, type DynamicModule, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createDb, migrateUp, pendingMigrations } from '@opencms/db';
import { resolveConfig } from '@opencms/schema';
import { AdminContentController, AdminGuard, ContentController } from './content.controllers';
import { EntriesService } from './entries.service';
import { EntryRepository } from './entry.repository';
import { OPENCMS_DB, OPENCMS_OPTIONS, type OpenCmsModuleOptions, type ResolvedOpenCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { SchemaBuilderService, SchemaController } from './schema-builder';
import { SystemController } from './system.controller';

@Module({})
export class OpenCmsModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('OpenCms');

  constructor(
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
  ) {}

  static forRoot(input: OpenCmsModuleOptions): DynamicModule {
    const options: ResolvedOpenCmsOptions = {
      ...input,
      config: resolveConfig(input.config, input.root),
      hooks: input.hooks ?? [],
      schemaEditable: input.schemaEditable ?? process.env.NODE_ENV !== 'production',
      autoMigrate: input.autoMigrate ?? false,
    };
    return {
      module: OpenCmsModule,
      global: true,
      controllers: [ContentController, AdminContentController, SchemaController, SystemController],
      providers: [
        { provide: OPENCMS_OPTIONS, useValue: options },
        { provide: OPENCMS_DB, useFactory: () => createDb(options.config.database.url) },
        ContentRegistry,
        EntryRepository,
        EntriesService,
        SchemaBuilderService,
        AdminGuard,
      ],
      exports: [OPENCMS_DB, ContentRegistry, EntriesService],
    };
  }

  /** Refuses to start on a database that is behind the code (unless autoMigrate). */
  async onModuleInit(): Promise<void> {
    const dir = this.options.config.migrationsDir;
    const pending = await pendingMigrations(this.db, dir);
    if (!pending.length) return;
    if (this.options.autoMigrate) {
      const runs = await migrateUp(this.db, dir);
      this.logger.log(`Applied ${runs.length} migration(s): ${runs.map((r) => r.name).join(', ')}`);
      return;
    }
    throw new Error(
      `Database has ${pending.length} pending migration(s): ${pending.map((p) => `${p.stream}/${p.name}`).join(', ')}.\n` +
        'Run `opencms migrate:up` before starting the server (or set autoMigrate: true in development).',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
