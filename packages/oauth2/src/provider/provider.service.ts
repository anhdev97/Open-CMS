import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { sql, type Kysely } from 'kysely';
import type { OAuth2Config } from '../config/schema';
import { AUTH_SETTINGS, OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { deriveKey } from '../security/crypto';
import type { AuthSettingsProvider } from '../settings/settings.provider';
import { BootstrapService } from '../setup/bootstrap.service';
import { UserService, type GrantRevoker } from '../users/user.service';
import { createKyselyAdapter, type AdapterConstructor } from './kysely.adapter';
import { createProvider, TtlSnapshot, upsertAdminClient, type OidcProvider } from './provider.factory';
import { ensureSigningKey } from './signing-keys';

@Injectable()
export class ProviderService implements OnModuleInit, GrantRevoker {
  private readonly logger = new Logger('OAuth2');
  private readonly adapter: AdapterConstructor;
  private instance?: OidcProvider;

  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettingsProvider,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    // UserService/BootstrapService depend on GRANT_REVOKER (= this service); resolve them lazily.
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {
    this.adapter = createKyselyAdapter(db);
  }

  get provider(): OidcProvider {
    if (!this.instance) throw new Error('oidc-provider is not initialised yet');
    return this.instance;
  }

  async onModuleInit(): Promise<void> {
    const jwks = await ensureSigningKey(this.db, deriveKey(this.cfg.secret, 'key'));
    const client = await upsertAdminClient(this.db, this.cfg);
    const users = this.moduleRef.get(UserService, { strict: false });
    this.instance = await createProvider({
      cfg: this.cfg,
      adapter: this.adapter,
      jwks,
      client,
      ttls: await TtlSnapshot.create(() => this.settings.getTtls()),
      findUser: (id) => users.findById(id),
    });
    await this.moduleRef.get(BootstrapService, { strict: false }).run();

    const http = this.adapterHost?.httpAdapter;
    if (!http) {
      this.logger.warn('No HTTP adapter; oidc-provider is not mounted at /oauth2');
      return;
    }
    http.getInstance().use('/oauth2', this.instance.callback());
  }

  /**
   * Destroys every Grant of `userId` plus all codes/tokens issued under it. Uses OAUTH2_DB directly
   * (never a caller's transaction) so it also works before the Provider exists.
   */
  async revokeAllGrants(userId: string): Promise<void> {
    const rows = await this.db
      .selectFrom('auth_oidc_payloads')
      .select('id')
      .where('kind', '=', 'Grant')
      .where(sql<string>`payload->>'accountId'`, '=', userId)
      .execute();
    for (const { id } of rows) {
      await new this.adapter('Grant').revokeByGrantId(id);
      await new this.adapter('Grant').destroy(id);
    }
  }
}
