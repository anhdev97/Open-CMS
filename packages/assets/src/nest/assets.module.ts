import {
  Global,
  Inject,
  Module,
  Optional,
  type DynamicModule,
  type InjectionToken,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ASSETS_DB, ASSETS_OPTIONS, STORAGE_PROVIDER } from '../constants';
import { createProvider } from '../provider/create-provider';
import type { StorageProvider } from '../provider/storage-provider';
import type { AssetsModuleOptions } from '../types';
import { AssetsController, AssetsUploadController, AssetUploadInterceptor } from './assets.controller';
import { AssetsService } from './assets.service';
import { createLocalStaticMiddleware, localStaticPrefix } from './local-static.middleware';

export interface AssetsModuleForRootOptions {
  /** DI token under which the app provides its Kysely instance (e.g. OPENCMS_DB). */
  dbToken: InjectionToken;
  /** Storage/upload configuration. Omit or pass null to disable upload + local static serving. */
  assets?: AssetsModuleOptions | null;
}

@Global()
@Module({})
export class AssetsModule implements NestModule {
  constructor(
    @Optional() @Inject(ASSETS_OPTIONS) private readonly options: AssetsModuleOptions | null,
    @Optional() @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider | null,
  ) {}

  static forRoot(opts: AssetsModuleForRootOptions): DynamicModule {
    const assets = opts.assets ?? null;
    return {
      module: AssetsModule,
      global: true,
      controllers: assets ? [AssetsController, AssetsUploadController] : [AssetsController],
      providers: [
        { provide: ASSETS_DB, useExisting: opts.dbToken },
        { provide: ASSETS_OPTIONS, useValue: assets },
        // Throws at module init when the provider is unavailable or its config is incomplete.
        { provide: STORAGE_PROVIDER, useFactory: () => (assets ? createProvider(assets) : null) },
        ...(assets ? [AssetUploadInterceptor] : []),
        AssetsService,
      ],
      exports: [AssetsService, ASSETS_OPTIONS, STORAGE_PROVIDER],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    const local = this.options?.provider === 'local' ? this.options.local : undefined;
    if (!local || this.provider?.kind !== 'local') return;
    const prefix = localStaticPrefix(local);
    if (!prefix) return;
    consumer.apply(createLocalStaticMiddleware(local)).forRoutes('*');
  }
}
