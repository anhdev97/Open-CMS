import { createHash, randomBytes } from 'node:crypto';
import type * as openid from 'openid-client';
import { loadOpenidClient } from '../bff/oidc-client';
import { secureOidcFetch } from '../sso-management/oidc-discovery-client';
import type { ActiveProvider } from '../sso-management/provider-registry.service';
import type { OAuth2Config } from '../config/schema';
import {
  idpCookieKey,
  openIdpState,
  sealIdpState,
  type ExternalIdentity,
  type IdentityProvider,
  type SealedState,
} from './identity-provider';

type OidcIdpConfig = NonNullable<OAuth2Config['idp']['oidc']> & {
  id?: string;
  versionId?: string;
  scopes?: string[];
};

const random = () => randomBytes(32).toString('base64url');

/** Thrown by `finish` when the sealed state does not belong to this flow (→ `invalid_state`). */
export class IdpStateMismatch extends Error {
  constructor() {
    super('idp state mismatch');
    this.name = 'IdpStateMismatch';
  }
}

/**
 * Generic OIDC IdP (spec §6.4) configured by `OPENCLOUDCMS_IDP_OIDC_*`: authorization code + PKCE S256,
 * `client_secret_basic`, state and nonce checked by openid-client v6 on the ID token.
 */
export class OidcIdentityProvider implements IdentityProvider {
  readonly id: string;
  readonly versionId?: string;
  readonly label: string;
  private readonly key: Buffer;
  private config?: Promise<openid.Configuration>;
  /** Fixed redirect_uri registered at the IdP (spec §6.4): `publicUrl + '/oauth2/idp/oidc/callback'`. */
  readonly callbackUrl: string;

  constructor(
    private readonly idp: OidcIdpConfig,
    cfg: Pick<OAuth2Config, 'publicUrl' | 'secret'>,
  ) {
    this.id = idp.id ?? 'oidc';
    this.versionId = idp.versionId;
    this.label = idp.label || 'SSO';
    this.key = idpCookieKey(cfg.secret);
    this.callbackUrl = `${cfg.publicUrl}/oauth2/idp/${this.id}/callback`;
  }

  static fromVersion(p: ActiveProvider, cfg: OAuth2Config): OidcIdentityProvider {
    return new OidcIdentityProvider({
      id: p.code, versionId: p.versionId, issuer: p.issuer, clientId: p.clientId,
      clientSecret: p.clientSecret, label: p.label, scopes: p.scopes,
    }, cfg);
  }

  /** Lazy discovery, cached; a failed discovery is retried on the next login. */
  private getConfig(): Promise<openid.Configuration> {
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
    const issuer = new URL(this.idp.issuer);
    return client.discovery(
      issuer,
      this.idp.clientId,
      { response_types: ['code'] },
      client.ClientSecretBasic(this.idp.clientSecret),
      // openid-client refuses http issuers unless asked; only for an http issuer (dev/tests).
      {
        execute: issuer.protocol === 'http:' ? [client.allowInsecureRequests] : [],
        ...(this.versionId ? { [client.customFetch]: secureOidcFetch } : {}),
      },
    );
  }

  async start(ctx: { uid: string; returnUrl: string }): Promise<{ redirectUrl: string; cookie: SealedState }> {
    const client = await loadOpenidClient();
    const st = { phase: 'start' as const, uid: ctx.uid, provider: this.id,
      state: random(), nonce: random(), verifier: random(),
      ...(this.versionId ? { versionId: this.versionId, startedAt: Date.now() } : {}),
    };
    const url = client.buildAuthorizationUrl(await this.getConfig(), {
      redirect_uri: ctx.returnUrl,
      response_type: 'code',
      scope: (this.idp.scopes ?? ['openid', 'email', 'profile']).join(' '),
      state: st.state,
      nonce: st.nonce,
      code_challenge: createHash('sha256').update(st.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return { redirectUrl: url.toString(), cookie: sealIdpState(this.key, st) };
  }

  /**
   * `query` is the callback's query string. The callback URL handed to openid-client is rebuilt from the
   * fixed callbackUrl (never from Host). Throws IdpStateMismatch for a foreign cookie, anything else
   * for an IdP error or a failed exchange/validation.
   */
  async finish(ctx: { uid: string; query: URLSearchParams; cookie: SealedState }): Promise<ExternalIdentity> {
    const st = openIdpState(this.key, ctx.cookie);
    if (!st || st.phase !== 'start' || st.uid !== ctx.uid || st.provider !== this.id ||
      (this.versionId && (st.versionId !== this.versionId || !st.startedAt || Date.now() - st.startedAt > 600_000)) ||
      ctx.query.get('state') !== st.state) {
      throw new IdpStateMismatch();
    }
    const client = await loadOpenidClient();
    const currentUrl = new URL(this.callbackUrl);
    currentUrl.search = ctx.query.toString();
    const res = await client.authorizationCodeGrant(await this.getConfig(), currentUrl, {
      pkceCodeVerifier: st.verifier,
      expectedState: st.state,
      expectedNonce: st.nonce,
      idTokenExpected: true,
    });
    const claims = res.claims();
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) throw new Error('ID token without sub');
    return {
      provider: this.id,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      emailVerified: claims.email_verified === true,
    };
  }
}
