import { Global, Module, type DynamicModule, type InjectionToken } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { loadConfig, type AuthFileConfig, type OAuth2Config } from './config/schema';
import { AUTH_SETTINGS, GRANT_REVOKER, OAUTH2_CONFIG, OAUTH2_DB, RATE_LIMITER } from './constants';
import { InteractionController } from './interaction/interaction.controller';
import { InteractionService } from './interaction/interaction.service';
import { ProviderService } from './provider/provider.service';
import { PasswordService } from './security/password';
import { InMemoryRateLimiter } from './security/rate-limiter';
import { ConfigAuthSettingsProvider } from './settings/settings.provider';
import { BootstrapService } from './setup/bootstrap.service';
import { SetupController } from './setup/setup.controller';
import { SetupState } from './setup/setup-state';
import { UserService } from './users/user.service';

export interface OAuth2ModuleOptions {
  /** DI token under which the app provides its Kysely instance (e.g. OPENCMS_DB). */
  dbToken: InjectionToken;
  /** Non-secret `auth` section of opencms.config.ts. */
  auth?: Partial<AuthFileConfig>;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

@Global()
@Module({})
export class OAuth2Module {
  static forRoot(opts: OAuth2ModuleOptions): DynamicModule {
    return {
      module: OAuth2Module,
      global: true,
      controllers: [SetupController, InteractionController],
      providers: [
        { provide: OAUTH2_DB, useExisting: opts.dbToken },
        // Throws ConfigError on a missing/short secret or missing public URL → app refuses to start.
        { provide: OAUTH2_CONFIG, useFactory: () => loadConfig(opts.env ?? process.env, opts.auth) },
        {
          provide: AUTH_SETTINGS,
          useFactory: (cfg: OAuth2Config) => new ConfigAuthSettingsProvider(cfg),
          inject: [OAUTH2_CONFIG],
        },
        { provide: RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },
        {
          provide: PasswordService,
          useFactory: (cfg: OAuth2Config) => new PasswordService({ minLength: cfg.password.minLength }),
          inject: [OAUTH2_CONFIG],
        },
        AuditService,
        UserService,
        { provide: GRANT_REVOKER, useExisting: ProviderService },
        SetupState,
        {
          provide: BootstrapService,
          useFactory: (cfg: OAuth2Config, users: UserService, pw: PasswordService, audit: AuditService) =>
            new BootstrapService(cfg, users, pw, audit),
          inject: [OAUTH2_CONFIG, UserService, PasswordService, AuditService],
        },
        ProviderService,
        InteractionService,
      ],
      exports: [
        OAUTH2_DB,
        OAUTH2_CONFIG,
        AUTH_SETTINGS,
        RATE_LIMITER,
        GRANT_REVOKER,
        PasswordService,
        AuditService,
        UserService,
        SetupState,
        BootstrapService,
        ProviderService,
        InteractionService,
      ],
    };
  }
}
