// Side-effect, Nest-free: registers oauth2_0001_init with the core migration stream. The `opencms` CLI
// registers it too, so every process that migrates (autoMigrate, the Content Type Builder) must know it,
// or Kysely reports a missing migration.
import '@opencloudcms/oauth2/migrations';
import { Inject, Logger, Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Kysely } from 'kysely';
import { createDb, migrateUp, pendingMigrations } from '@opencloudcms/db';
import { AssetsModule } from '@opencloudcms/assets';
import { OAuth2Module, type CoreReady } from '@opencloudcms/oauth2';
import { resolveConfig } from '@opencloudcms/schema';
import { ContentCorsMiddleware } from './http/content-cors.middleware';
import { JsonBodyParserMiddleware } from './http/body-parser.middleware';
import { AdminContentController, ContentController, WorkflowController } from './content.controllers';
import { EntriesService } from './entries.service';
import { EntryRepository } from './entry.repository';
import { LocalesController, LocalesService } from './locales';
import { ContentGroupsController, ContentGroupsService } from './content-groups';
import { CORE_READY_CORE, OPENCLOUDCMS_DB, OPENCLOUDCMS_OPTIONS, type OpenCloudCmsModuleOptions, type ResolvedOpenCloudCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { SchemaBuilderService, SchemaController } from './schema-builder';
import { SchemaWriteQueue } from './schema-write-queue';
import { SystemController } from './system.controller';
import { WorkflowService } from './workflow.service';
import { createWebHost, type WebHost } from './web';

/** A `CoreReady` holder (not a promise: Nest would await that at DI time) settled by OpenCloudCmsModule.onModuleInit. */
class DeferredCoreReady implements CoreReady {
  private readonly promise: Promise<void>;
  private resolveFn!: () => void;
  private rejectFn!: (e: unknown) => void;

  constructor() {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
    // Nobody may be waiting yet; the failure still reaches onModuleInit's caller and every later wait().
    this.promise.catch(() => {});
  }

  wait(): Promise<void> {
    return this.promise;
  }
  resolve(): void {
    this.resolveFn();
  }
  reject(e: unknown): void {
    this.rejectFn(e);
  }
}

@Module({})
export class OpenCloudCmsModule implements NestModule, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('OpenCloudCms');
  private webHost?: WebHost;

  constructor(
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>,
    @Inject(CORE_READY_CORE) private readonly ready: DeferredCoreReady,
    @Inject(HttpAdapterHost) private readonly httpHost: HttpAdapterHost,
  ) {}

  static forRoot(input: OpenCloudCmsModuleOptions): DynamicModule {
    const options: ResolvedOpenCloudCmsOptions = {
      ...input,
      config: resolveConfig(input.config, input.root),
      hooks: input.hooks ?? [],
      schemaEditable: input.schemaEditable ?? process.env.NODE_ENV !== 'production',
      autoMigrate: input.autoMigrate ?? false,
    };
    return {
      module: OpenCloudCmsModule,
      global: true,
      imports: [
        OAuth2Module.forRoot({
          dbToken: OPENCLOUDCMS_DB,
          coreReady: CORE_READY_CORE,
          publicPathPrefixes: ['/api/content/'],
          auth: input.auth,
          env: input.env,
        }),
        AssetsModule.forRoot({ dbToken: OPENCLOUDCMS_DB, assets: input.assets ?? null }),
      ],
      controllers: [ContentController, AdminContentController, SchemaController, ContentGroupsController, LocalesController, SystemController, WorkflowController],
      providers: [
        { provide: OPENCLOUDCMS_OPTIONS, useValue: options },
        { provide: OPENCLOUDCMS_DB, useFactory: () => createDb(options.config.database.url) },
        ContentRegistry,
        EntryRepository,
        EntriesService,
        WorkflowService,
        SchemaWriteQueue,
        SchemaBuilderService,
        ContentGroupsService,
        LocalesService,
        { provide: CORE_READY_CORE, useValue: new DeferredCoreReady() },
      ],
      exports: [OPENCLOUDCMS_DB, CORE_READY_CORE, ContentRegistry, EntriesService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(JsonBodyParserMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
    consumer.apply(ContentCorsMiddleware).forRoutes({ path: 'api/content/*path', method: RequestMethod.ALL });
  }

  /** Refuses to start on a database that is behind the code (unless autoMigrate). */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureMigrated();
      this.ready.resolve();
      await this.mountWeb();
    } catch (e) {
      this.ready.reject(e);
      throw e;
    }
  }

  /** Mounted from onModuleInit: Nest has already registered its routes, only its 404/exception handlers come after, which is why backend paths fall through to Nest. */
  private async mountWeb(): Promise<void> {
    const web = this.options.web;
    if (web?.enabled === false) return;
    const adapter = this.httpHost.httpAdapter;
    const host = createWebHost({
      dir: web?.dir ?? process.cwd(),
      dev: web?.dev ?? process.env.NODE_ENV !== 'production',
      logger: this.logger,
      loadNext: web?.loadNext,
    });
    this.webHost = host;
    await host.prepare();
    adapter.getInstance().use(host.handler);
    host.attachUpgrade(adapter.getHttpServer());
  }

  private async ensureMigrated(): Promise<void> {
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
    await this.webHost?.close();
    await this.db.destroy();
  }
}
