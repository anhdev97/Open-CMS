// Side-effect, Nest-free: registers oauth2_0001_init with the core migration stream. The `opencms` CLI
// registers it too, so every process that migrates (autoMigrate, the Content Type Builder) must know it,
// or Kysely reports a missing migration.
import '@opencms/oauth2/migrations';
import { Inject, Logger, Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Kysely } from 'kysely';
import { createDb, migrateUp, pendingMigrations } from '@opencms/db';
import { OAuth2Module, type CoreReady } from '@opencms/oauth2';
import { resolveConfig } from '@opencms/schema';
import * as path from 'node:path';
import { createAdminDevHandler, createAdminSpaHandler, DEFAULT_ADMIN_DIST_DIR, type AdminDevHandler } from './http/admin-spa.middleware';
import { ContentCorsMiddleware } from './http/content-cors.middleware';
import { JsonBodyParserMiddleware } from './http/body-parser.middleware';
import { AdminContentController, ContentController } from './content.controllers';
import { EntriesService } from './entries.service';
import { EntryRepository } from './entry.repository';
import { CORE_READY_CORE, OPENCMS_DB, OPENCMS_OPTIONS, type OpenCmsModuleOptions, type ResolvedOpenCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { SchemaBuilderService, SchemaController } from './schema-builder';
import { SystemController } from './system.controller';

/** A `CoreReady` holder (not a promise: Nest would await that at DI time) settled by OpenCmsModule.onModuleInit. */
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
export class OpenCmsModule implements NestModule, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('OpenCms');
  private adminDev?: AdminDevHandler;

  constructor(
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
    @Inject(CORE_READY_CORE) private readonly ready: DeferredCoreReady,
    @Inject(HttpAdapterHost) private readonly httpHost: HttpAdapterHost,
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
      imports: [
        OAuth2Module.forRoot({
          dbToken: OPENCMS_DB,
          coreReady: CORE_READY_CORE,
          publicPathPrefixes: ['/api/content/'],
          auth: input.auth,
          env: input.env,
        }),
      ],
      controllers: [ContentController, AdminContentController, SchemaController, SystemController],
      providers: [
        { provide: OPENCMS_OPTIONS, useValue: options },
        { provide: OPENCMS_DB, useFactory: () => createDb(options.config.database.url) },
        ContentRegistry,
        EntryRepository,
        EntriesService,
        SchemaBuilderService,
        { provide: CORE_READY_CORE, useValue: new DeferredCoreReady() },
      ],
      exports: [OPENCMS_DB, CORE_READY_CORE, ContentRegistry, EntriesService],
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
      await this.mountAdmin();
    } catch (e) {
      this.ready.reject(e);
      throw e;
    }
  }

  /** Mounted from onModuleInit, i.e. before Nest registers its routes and its 404 handler. */
  private async mountAdmin(): Promise<void> {
    if (this.options.admin?.enabled === false) return;
    const adapter = this.httpHost.httpAdapter;
    const env = this.options.env ?? process.env;
    if (env.OPENCMS_ADMIN_DEV === '1') {
      try {
        // dist/ (or src/) -> packages/core/admin
        this.adminDev = await createAdminDevHandler({ root: path.resolve(__dirname, '../admin'), httpServer: adapter.getHttpServer() });
        adapter.getInstance().use('/admin', this.adminDev.handler);
        return;
      } catch (e) {
        this.logger.error(`OPENCMS_ADMIN_DEV requires the @opencms/core source checkout (${e instanceof Error ? e.message : String(e)}); serving the built admin UI instead.`);
      }
    }
    const handler = createAdminSpaHandler({ distDir: this.options.admin?.distDir ?? DEFAULT_ADMIN_DIST_DIR, logger: this.logger });
    adapter.getInstance().use('/admin', handler);
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
    await this.adminDev?.close();
    await this.db.destroy();
  }
}
