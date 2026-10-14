import { createHash, randomBytes } from 'node:crypto';
import { Controller, Get, Inject, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { OAuth2Config } from '../config/schema';
import { AUTH_SETTINGS, LOGIN_COOKIE, OAUTH2_CONFIG, SESSION_COOKIE } from '../constants';
import { Public } from '../guard/public.decorator';
import { deriveKey, open, seal } from '../security/crypto';
import { sanitizeReturnTo } from '../security/return-to';
import type { AuthSettingsProvider } from '../settings/settings.provider';
import { UserService } from '../users/user.service';
import { isSecureUrl, parseCookies, serializeCookie } from './cookies';
import { OidcClient } from './oidc-client';
import { SessionStore } from './session.store';

const LOGIN_COOKIE_PATH = '/api/auth';
const LOGIN_COOKIE_MAX_AGE = 600;

interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

const random = () => randomBytes(32).toString('base64url');
const loginError = (code: string) => `/admin/login?error=${code}`;
const first = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/**
 * BFF side of spec §6.3 (steps 1–2 and 6): the server is the confidential client; the browser only ever
 * gets `oc_login` (sealed PKCE/state) and `oc_session` (random id). No token leaves the server.
 */
@Public()
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger('OAuth2');
  private readonly cookieKey: Buffer;
  private readonly secure: boolean;

  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettingsProvider,
    @Inject(OidcClient) private readonly oidc: OidcClient,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(UserService) private readonly users: UserService,
  ) {
    this.cookieKey = deriveKey(cfg.secret, 'cookie');
    this.secure = isSecureUrl(cfg.publicUrl);
  }

  @Get('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const loginHint = first(req.query.login_hint);
    const st: LoginState = {
      state: random(),
      nonce: random(),
      verifier: random(),
      returnTo: sanitizeReturnTo(first(req.query.returnTo)),
    };
    const codeChallenge = createHash('sha256').update(st.verifier).digest('base64url');
    const url = await this.oidc.buildLoginUrl({
      state: st.state,
      nonce: st.nonce,
      codeChallenge,
      loginHint: loginHint || undefined,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.append(
      'Set-Cookie',
      serializeCookie(LOGIN_COOKIE, seal(this.cookieKey, JSON.stringify(st)), {
        path: LOGIN_COOKIE_PATH,
        maxAge: LOGIN_COOKIE_MAX_AGE,
        secure: this.secure,
      }),
    );
    res.redirect(302, url.toString());
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    // oc_login is single-use whatever the outcome.
    res.append('Set-Cookie', serializeCookie(LOGIN_COOKIE, '', { path: LOGIN_COOKIE_PATH, maxAge: 0, secure: this.secure }));

    const st = this.readLoginState(parseCookies(req.headers.cookie)[LOGIN_COOKIE]);
    if (!st || first(req.query.state) !== st.state) return res.redirect(302, loginError('invalid_state'));

    const providerError = first(req.query.error);
    if (providerError !== undefined) {
      return res.redirect(302, loginError(/^[a-z_]+$/.test(providerError) ? providerError : 'login_failed'));
    }

    // The provider redirected the browser to publicUrl + /api/auth/callback; rebuild that URL rather than
    // trusting Host (behind a TLS proxy the request reaches us on the internal address).
    const currentUrl = new URL(this.oidc.redirectUri);
    currentUrl.search = new URL(req.originalUrl ?? req.url, 'http://internal').search;

    let tokens;
    try {
      tokens = await this.oidc.exchange(currentUrl, { verifier: st.verifier, state: st.state, nonce: st.nonce });
    } catch (e) {
      // Never log tokens or codes; the error name/message from openid-client carries neither.
      this.logger.warn(`BFF code exchange failed: ${(e as Error)?.name}: ${(e as Error)?.message}`);
      return res.redirect(302, loginError('login_failed'));
    }

    const userAgent = first(req.headers['user-agent']);
    const { cookieValue } = await this.sessions.create(tokens.sub!, tokens, { ip: req.ip, userAgent });
    const ttl = await this.settings.getTtls();
    res.append(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, cookieValue, { path: '/', maxAge: ttl.sessionAbsolute, secure: this.secure }),
    );
    await this.users.touchLogin(tokens.sub!);
    res.redirect(302, st.returnTo);
  }

  private readLoginState(sealed: string | undefined): LoginState | undefined {
    if (!sealed) return undefined;
    try {
      const v = JSON.parse(open(this.cookieKey, sealed)) as Partial<LoginState>;
      if (typeof v.state !== 'string' || typeof v.nonce !== 'string' || typeof v.verifier !== 'string') return undefined;
      return { state: v.state, nonce: v.nonce, verifier: v.verifier, returnTo: sanitizeReturnTo(v.returnTo) };
    } catch {
      return undefined;
    }
  }
}
