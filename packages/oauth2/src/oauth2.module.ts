import { Global, Module, type DynamicModule, type InjectionToken } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit/audit.service';
import { AuthController } from './bff/auth.controller';
import { OidcClient } from './bff/oidc-client';
import { SessionStore } from './bff/session.store';
import { loadConfig, type AuthFileConfig, type OAuth2Config } from './config/schema';
import { ApiExceptionFilter, AuthExceptionFilter } from './errors';
import { AuthGuard } from './guard/auth.guard';
import { SessionAuthenticator } from './guard/session-auth.service';
import { CleanupService } from './maintenance/cleanup.service';
import {
  AUTH_SETTINGS, CORE_READY, PUBLIC_PATH_PREFIXES, GRANT_REVOKER, OAUTH2_CONFIG, OAUTH2_DB, RATE_LIMITER, type CoreReady,
} from './constants';
import { IdentityLinker } from './idp/identity-linker';
import { IDENTITY_PROVIDERS } from './idp/identity-provider';
import { IdpController } from './idp/idp.controller';
import { OidcIdentityProvider } from './idp/oidc.identity-provider';
import { InteractionController } from './interaction/interaction.controller';
import { InteractionService } from './interaction/interaction.service';
import { ProviderService } from './provider/provider.service';
import { PasswordService } from './security/password';
import { InMemoryRateLimiter } from './security/rate-limiter';
import { ConfigAuthSettingsProvider } from './settings/settings.provider';
import { BootstrapService } from './setup/bootstrap.service';
import { SetupController } from './setup/setup.controller';
import { SetupState } from './setup/setup-state';
import { PasswordController } from './users/password.controller';
import { UserService } from './users/user.service';
import { UsersController } from './users/users.controller';

export interface OAuth2ModuleOptions {
  /** DI token under which the app provides its Kysely instance (e.g. OPENCMS_DB). */
  dbToken: InjectionToken;
  /** Non-secret `auth` section of opencms.config.ts. */
  auth?: Partial<AuthFileConfig>;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** `/api` path prefixes served without a session (published-content delivery API). Default `['/api/content/']`. */
  publicPathPrefixes?: string[];
  /**
   * Token of a provider whose value is a `CoreReady` holder; ProviderService awaits `wait()` in onModuleInit
   * before touching the database (rejecting aborts startup). Default: ready immediately.
   */
  coreReady?: InjectionToken;
}

@Global()
@Module({})
export class OAuth2Module {
  static forRoot(opts: OAuth2ModuleOptions): DynamicModule {
    return {
      module: OAuth2Module,
      global: true,
      controllers: [SetupController, InteractionController, IdpController, AuthController, UsersController, PasswordController],
      providers: [
        { provide: OAUTH2_DB, useExisting: opts.dbToken },
        // Throws ConfigError on a missing/short secret or missing public URL → app refuses to start.
        { provide: OAUTH2_CONFIG, useFactory: () => loadConfig(opts.env ?? process.env, opts.auth) },
        {
          provide: AUTH_SETTINGS,
          useFactory: (cfg: OAuth2Config) => new ConfigAuthSettingsProvider(cfg),
          inject: [OAUTH2_CONFIG],
        },
        { provide: PUBLIC_PATH_PREFIXES, useValue: (opts.publicPathPrefixes ?? ['/api/content/']).map((p) => p.toLowerCase()) },
        opts.coreReady
          ? { provide: CORE_READY, useExisting: opts.coreReady }
          : { provide: CORE_READY, useValue: { wait: () => Promise.resolve() } satisfies CoreReady },
        CleanupService,
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
        OidcClient,
        SessionStore,
        SessionAuthenticator,
        // Spec §6.4: only IdPs that are configured; today the single generic OIDC one.
        {
          provide: IDENTITY_PROVIDERS,
          useFactory: (cfg: OAuth2Config) => (cfg.idp.oidc ? [new OidcIdentityProvider(cfg.idp.oidc, cfg)] : []),
          inject: [OAUTH2_CONFIG],
        },
        IdentityLinker,
        // Spec §6.5: every /api/** route is protected unless @Public(); §8 error JSON everywhere.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_FILTER, useClass: AuthExceptionFilter },
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
        OidcClient,
        SessionStore,
        SessionAuthenticator,
        IDENTITY_PROVIDERS,
        IdentityLinker,
      ],
    };
  }
}
