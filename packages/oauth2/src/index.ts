export * from './constants';
export * from './errors';
export * from './config/schema';
export * from './settings/settings.provider';
export * from './db/types';
export { oauth2CoreMigrations } from './db/migrations';

import { registerCoreMigrations } from '@opencms/db';
import { oauth2CoreMigrations } from './db/migrations';

registerCoreMigrations(oauth2CoreMigrations);
export * from './guard/public.decorator';
export * from './setup/bootstrap.service';
export * from './setup/setup-state';
export * from './setup/setup.controller';
export * from './audit/audit.service';
export * from './users/user.service';
export * from './security/password';
export * from './security/rate-limiter';
export { createKyselyAdapter } from './provider/kysely.adapter';
export type { Adapter, AdapterPayload, AdapterConstructor } from './provider/kysely.adapter';
export { ensureSigningKey, type JWK } from './provider/signing-keys';
export {
  ADMIN_SCOPES, adminClientSecret, adminClientMetadata, upsertAdminClient, issuerFor, type OidcProvider,
} from './provider/provider.factory';
export * from './provider/provider.service';
export * from './oauth2.module';
export * from './interaction/interaction.service';
export * from './interaction/interaction.controller';
export * from './bff/cookies';
export { OidcClient, type TokenSet } from './bff/oidc-client';
export * from './bff/session.store';
export * from './bff/auth.controller';
