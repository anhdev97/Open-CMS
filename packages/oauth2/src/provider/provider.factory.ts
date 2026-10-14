import { hkdfSync } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { OAuth2Config, Ttls } from '../config/schema';
import { ADMIN_CLIENT_ID } from '../constants';
import type { AuthTables } from '../db/types';
import { deriveKey } from '../security/crypto';
import type { AuthUser } from '../users/user.service';
import type { AdapterConstructor } from './kysely.adapter';
import type { JWK } from './signing-keys';

/** The part of oidc-provider's `Provider` (a Koa app) this package relies on. */
export interface OidcProvider {
  issuer: string;
  proxy: boolean;
  callback(): (req: unknown, res: unknown) => unknown;
  use(fn: (ctx: any, next: () => Promise<void>) => Promise<void>): unknown;
  interactionDetails(req: unknown, res: unknown): Promise<any>;
  interactionFinished(req: unknown, res: unknown, result: unknown, opts?: unknown): Promise<void>;
  interactionResult(req: unknown, res: unknown, result: unknown, opts?: unknown): Promise<string>;
  Grant: any;
  Session: any;
  [key: string]: any;
}

export type OidcProviderClass = new (issuer: string, configuration: Record<string, unknown>) => OidcProvider;

let cachedProvider: OidcProviderClass | undefined;
let cachedErrors: Record<string, any> | undefined;

// A real dynamic import that tsc (module: commonjs) does not rewrite into require().
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

/**
 * oidc-provider is ESM-only. Node 22 can require() it synchronously; if that is ever refused
 * (e.g. the package gains top-level await) fall back to a native dynamic import. Cached once.
 */
export async function loadOidcProvider(): Promise<OidcProviderClass> {
  if (cachedProvider) return cachedProvider;
  let mod: any;
  try {
    mod = require('oidc-provider');
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'ERR_REQUIRE_ESM' && code !== 'ERR_REQUIRE_ASYNC_MODULE') throw e;
    mod = await dynamicImport('oidc-provider');
  }
  cachedProvider = (mod.Provider ?? mod.default) as OidcProviderClass;
  cachedErrors = mod.errors;
  return cachedProvider;
}

/** oidc-provider's `errors` export; available once loadOidcProvider() has run (always before a Provider exists). */
function oidcErrors(): Record<string, any> {
  if (!cachedErrors) throw new Error('oidc-provider is not loaded');
  return cachedErrors;
}

/** R16: the provider's keygrip key sits one HKDF level below the `cookie` key that seals oc_login. */
export function providerCookieKey(secret: Buffer): string {
  return Buffer.from(hkdfSync('sha256', deriveKey(secret, 'cookie'), Buffer.alloc(0), 'oidc-provider/keygrip', 32)).toString(
    'base64url',
  );
}

export const ADMIN_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export function issuerFor(cfg: Pick<OAuth2Config, 'publicUrl'>): string {
  return `${cfg.publicUrl}/oauth2`;
}

export function adminClientSecret(cfg: Pick<OAuth2Config, 'secret'>): string {
  return deriveKey(cfg.secret, 'client-secret').toString('base64url');
}

export function adminClientMetadata(cfg: Pick<OAuth2Config, 'secret' | 'publicUrl'>): Record<string, unknown> {
  return {
    client_id: ADMIN_CLIENT_ID,
    client_secret: adminClientSecret(cfg),
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: [`${cfg.publicUrl}/api/auth/callback`],
    post_logout_redirect_uris: [`${cfg.publicUrl}/admin/login`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    id_token_signed_response_alg: 'ES256',
  };
}

/**
 * Spec §6.1 step 3. Stores the metadata without `client_secret`; returns the full metadata (with secret)
 * that is handed to the provider as a static client.
 */
export async function upsertAdminClient(
  db: Kysely<AuthTables>,
  cfg: Pick<OAuth2Config, 'secret' | 'publicUrl'>,
): Promise<Record<string, unknown>> {
  const metadata = adminClientMetadata(cfg);
  // The secret is derived from OPENCMS_SECRET on every boot; never persist it.
  const { client_secret: _secret, ...stored } = metadata;
  const json = JSON.stringify(stored);
  await db
    .insertInto('auth_oauth_clients')
    .values({ client_id: ADMIN_CLIENT_ID, metadata: json, created_at: new Date(), updated_at: new Date() })
    .onConflict((oc) => oc.column('client_id').doUpdateSet({ metadata: json, updated_at: new Date() }))
    .execute();
  return metadata;
}

/**
 * oidc-provider calls `ttl.*` synchronously, while AuthSettingsProvider.getTtls() is async (spec D7).
 * The snapshot is loaded at boot and refreshed by a provider middleware at the start of every
 * /oauth2 request, so every token/session issued in a request uses the settings read in that request.
 */
export class TtlSnapshot {
  constructor(
    private readonly load: () => Promise<Ttls>,
    public current: Ttls,
  ) {}

  static async create(load: () => Promise<Ttls>): Promise<TtlSnapshot> {
    return new TtlSnapshot(load, await load());
  }

  async refresh(): Promise<void> {
    this.current = await this.load();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProviderConfigDeps {
  cfg: OAuth2Config;
  adapter: AdapterConstructor;
  jwks: JWK[];
  client: Record<string, unknown>;
  ttls: TtlSnapshot;
  findUser(id: string): Promise<AuthUser | undefined>;
}

export function buildProviderConfig(d: ProviderConfigDeps): Record<string, unknown> {
  const t = () => d.ttls.current;
  return {
    adapter: d.adapter,
    clients: [d.client],
    jwks: { keys: d.jwks },
    cookies: {
      keys: [providerCookieKey(d.cfg.secret)],
      // oidc-provider scopes the `_interaction` cookie to the interaction URL's path (/admin/login),
      // which the browser would not send to the Nest routes at /oauth2/interaction/:uid. A `path` in
      // cookies.short overrides that (the `_interaction_resume` cookie still sets its own path).
      short: { path: '/oauth2/interaction' },
    },
    scopes: [...ADMIN_SCOPES],
    claims: { openid: ['sub'], email: ['email'], profile: ['name'] },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      // Pinned to v9's default policy (set explicitly so the provider does not log its NOTICE): a client
      // may only revoke its own tokens.
      revocation: {
        enabled: true,
        allowedPolicy: async (_ctx: unknown, client: any, token: any) => {
          if (token.clientId !== client.clientId) {
            if (client.clientAuthMethod === 'none') return false;
            throw new (oidcErrors().InvalidRequest)('client is not authorized to revoke the presented token');
          }
          return true;
        },
      },
      rpInitiatedLogout: { enabled: true },
    },
    rotateRefreshToken: true,
    // R12: oidc-provider strips offline_access unless prompt=consent; the admin client always gets one.
    issueRefreshToken: async (_ctx: unknown, client: any, _source: unknown) =>
      client.clientId === ADMIN_CLIENT_ID && client.grantTypeAllowed('refresh_token'),
    // R13: v9 binds codes/tokens without offline_access (stripped, see R12) to the provider Session. For
    // the admin client the BFF session (idle/absolute, §6.5) is the single source of truth instead;
    // explicit revocation (revokeAllGrants) still deletes Grants and Sessions. Others keep v9's default.
    expiresWithSession: async (_ctx: unknown, source: any) =>
      source.clientId === ADMIN_CLIENT_ID ? false : !source.scopes.has('offline_access'),
    ttl: {
      AccessToken: () => t().accessToken,
      IdToken: () => t().accessToken,
      AuthorizationCode: () => t().authorizationCode,
      RefreshToken: () => Math.min(t().refreshToken, t().sessionAbsolute),
      Interaction: () => t().interaction,
      Session: () => t().sessionAbsolute,
      Grant: () => t().sessionAbsolute,
    },
    interactions: {
      url: (_ctx: unknown, interaction: { uid: string }) => `/admin/login?uid=${interaction.uid}`,
    },
    findAccount: async (_ctx: unknown, sub: string) => {
      if (!UUID.test(sub)) return undefined;
      const user = await d.findUser(sub);
      if (!user || user.status !== 'active') return undefined;
      return {
        accountId: user.id,
        claims: async () => ({ sub: user.id, email: user.email, name: user.name }),
      };
    },
    loadExistingGrant: async (ctx: any) => {
      const { client, session, account, result, provider } = ctx.oidc;
      const grantId: string | undefined = result?.consent?.grantId || session.grantIdFor(client.clientId);
      let grant = grantId ? await provider.Grant.find(grantId) : undefined;
      if (client.clientId !== ADMIN_CLIENT_ID || !account) return grant;
      if (grant && (grant.accountId !== account.accountId || grant.clientId !== client.clientId)) grant = undefined;
      if (!grant) grant = new provider.Grant({ clientId: client.clientId, accountId: account.accountId });
      grant.addOIDCScope(ADMIN_SCOPES.join(' '));
      await grant.save();
      return grant;
    },
    renderError: async (ctx: any, out: Record<string, unknown>) => {
      ctx.type = 'json';
      ctx.body = { error: out.error, error_description: out.error_description };
    },
  };
}

export async function createProvider(d: ProviderConfigDeps): Promise<OidcProvider> {
  const Provider = await loadOidcProvider();
  const provider = new Provider(issuerFor(d.cfg), buildProviderConfig(d));
  if (d.cfg.publicUrl.startsWith('https://')) provider.proxy = true;
  provider.use(async (_ctx, next) => {
    await d.ttls.refresh();
    await next();
  });
  return provider;
}
