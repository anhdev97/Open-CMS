import { Inject, Injectable } from '@nestjs/common';
import type * as openid from 'openid-client';
import type { OAuth2Config } from '../config/schema';
import { ADMIN_CLIENT_ID, OAUTH2_CONFIG } from '../constants';
import { ADMIN_SCOPES, adminClientSecret, issuerFor } from '../provider/provider.factory';

export type OpenidClientModule = typeof openid;

/** Tokens as the BFF keeps them. Never sent to the browser. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Seconds, from the token response's `expires_in`. */
  expiresIn?: number;
  /** `sub` of the validated ID token (code exchange only). */
  sub?: string;
}

let cachedModule: OpenidClientModule | undefined;
// A real dynamic import that tsc (module: commonjs) does not rewrite into require().
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

/** openid-client v6 is ESM-only; loaded like oidc-provider (require on Node 22, else dynamic import). */
export async function loadOpenidClient(): Promise<OpenidClientModule> {
  if (cachedModule) return cachedModule;
  let mod: any;
  try {
    mod = require('openid-client');
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'ERR_REQUIRE_ESM' && code !== 'ERR_REQUIRE_ASYNC_MODULE') throw e;
    mod = await dynamicImport('openid-client');
  }
  cachedModule = mod as OpenidClientModule;
  return cachedModule;
}

/**
 * Builds the fetch the BFF uses for every call to its own provider (spec §5 internalUrl): a request to the
 * public origin is sent to the internal origin instead, with X-Forwarded-Proto/Host of the public URL, so
 * the provider (proxy=true when https) still computes issuer-relative URLs on the public origin.
 */
export function internalFetch(
  publicUrl: string,
  internalUrl: string,
  base: typeof fetch = fetch,
): (url: string, options: openid.CustomFetchOptions) => Promise<Response> {
  const pub = new URL(publicUrl);
  const internal = new URL(internalUrl);
  return (url, options) => {
    const u = new URL(url);
    if (u.origin !== pub.origin) return base(url, options as RequestInit);
    const target = new URL(u.pathname + u.search, internal.origin);
    const headers = {
      ...options.headers,
      'x-forwarded-proto': pub.protocol.replace(':', ''),
      'x-forwarded-host': pub.host,
    };
    return base(target, { ...(options as RequestInit), headers });
  };
}

/** The BFF as a confidential OIDC client (`opencloudcms-admin`) of its own provider (spec D2, §6.3). */
@Injectable()
export class OidcClient {
  private config?: Promise<openid.Configuration>;

  constructor(@Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config) {}

  get redirectUri(): string {
    return `${this.cfg.publicUrl}/api/auth/callback`;
  }

  /** Lazy discovery at `${publicUrl}/oauth2`, cached; a failed discovery is retried on the next call. */
  getConfig(): Promise<openid.Configuration> {
    if (!this.config) {
      this.config = this.discover().catch((e) => {
        this.config = undefined;
        throw e;
      });
    }
    return this.config;
  }

  private async discover(): Promise<openid.Configuration> {
    const client = await loadOpenidClient();
    const insecure = new URL(this.cfg.publicUrl).protocol === 'http:';
    return client.discovery(
      new URL(issuerFor(this.cfg)),
      ADMIN_CLIENT_ID,
      { redirect_uris: [this.redirectUri], response_types: ['code'], id_token_signed_response_alg: 'ES256' },
      client.ClientSecretBasic(adminClientSecret(this.cfg)),
      {
        // openid-client refuses http issuers unless asked; only for an http publicUrl (dev/tests).
        execute: insecure ? [client.allowInsecureRequests] : [],
        [client.customFetch]: internalFetch(this.cfg.publicUrl, this.cfg.internalUrl),
      },
    );
  }

  /**
   * Authorization URL as the browser sees it (public origin). Always `prompt=login` (C1): the BFF session
   * is the only authentication the admin client accepts, so a surviving provider session must never
   * re-authenticate a browser whose BFF session was logged out or expired.
   */
  async buildLoginUrl(p: { state: string; nonce: string; codeChallenge: string; loginHint?: string }): Promise<URL> {
    const client = await loadOpenidClient();
    const params: Record<string, string> = {
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: ADMIN_SCOPES.join(' '),
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    };
    if (p.loginHint) params.login_hint = p.loginHint;
    return client.buildAuthorizationUrl(await this.getConfig(), params);
  }

  /** `currentUrl` must be the callback URL on the public origin (it doubles as redirect_uri). */
  async exchange(currentUrl: URL, p: { verifier: string; state: string; nonce: string }): Promise<TokenSet> {
    const client = await loadOpenidClient();
    const res = await client.authorizationCodeGrant(await this.getConfig(), currentUrl, {
      pkceCodeVerifier: p.verifier,
      expectedState: p.state,
      expectedNonce: p.nonce,
      idTokenExpected: true,
    });
    const sub = res.claims()?.sub;
    if (!sub) throw new Error('ID token without sub');
    return { ...toTokenSet(res), sub };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const client = await loadOpenidClient();
    return toTokenSet(await client.refreshTokenGrant(await this.getConfig(), refreshToken));
  }

  async revoke(refreshToken: string): Promise<void> {
    const client = await loadOpenidClient();
    await client.tokenRevocation(await this.getConfig(), refreshToken, { token_type_hint: 'refresh_token' });
  }
}

function toTokenSet(res: openid.TokenEndpointResponse): TokenSet {
  if (!res.access_token) throw new Error('token response without access_token');
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    idToken: res.id_token,
    expiresIn: typeof res.expires_in === 'number' ? res.expires_in : undefined,
  };
}
