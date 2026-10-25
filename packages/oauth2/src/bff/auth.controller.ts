import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Logger, Patch, Post, Req, Res } from '@nestjs/common';
import { isLocale, type Locale } from '@opencloudcms/schema';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import type { OAuth2Config } from '../config/schema';
import { AUTH_SETTINGS, GRANT_REVOKER, LOGIN_COOKIE, OAUTH2_CONFIG, SESSION_COOKIE } from '../constants';
import { AuthError } from '../errors';
import type { RequestUser } from '../guard/current-user.decorator';
import { Public } from '../guard/public.decorator';
import { SessionAuthenticator, type AuthenticatedRequest } from '../guard/session-auth.service';
import { deriveKey, open, seal } from '../security/crypto';
import { parseBody } from '../security/validate';
import { sanitizeReturnTo } from '../security/return-to';
import { SetupState } from '../setup/setup-state';
import type { AuthSettingsProvider } from '../settings/settings.provider';
import { UserService, type GrantRevoker } from '../users/user.service';
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

const localeBody = z.object({
  locale: z.string().nullable().refine((v) => v === null || isLocale(v), { message: 'Unsupported locale' }),
});

const random = () => randomBytes(32).toString('base64url');
const loginError = (code: string) => `/admin/login?error=${code}`;
const first = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/**
 * BFF side of spec §6.3 (steps 1–2 and 6), §6.5 (`me`) and §6.6 (`logout`): the server is the confidential
 * client; the browser only ever gets `oc_login` (sealed PKCE/state) and `oc_session` (random id). No token
 * leaves the server. login/callback/me are public (spec §3); logout goes through AuthGuard (Origin + session).
 */
@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger('OAuth2');
  private readonly cookieKey: Buffer;
  private readonly secure: boolean;

  constructor(
    @Inject(OAUTH2_CONFIG) cfg: OAuth2Config,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettingsProvider,
    @Inject(OidcClient) private readonly oidc: OidcClient,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(UserService) private readonly users: UserService,
    @Inject(SetupState) private readonly setup: SetupState,
    @Inject(SessionAuthenticator) private readonly auth: SessionAuthenticator,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GRANT_REVOKER) private readonly revoker: GrantRevoker,
  ) {
    this.cookieKey = deriveKey(cfg.secret, 'cookie');
    this.secure = isSecureUrl(cfg.publicUrl);
  }

  @Public()
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
    res.setHeader('Cache-Control', 'no-store');
    let url: URL;
    try {
      url = await this.oidc.buildLoginUrl({
        state: st.state,
        nonce: st.nonce,
        codeChallenge,
        loginHint: loginHint || undefined,
      });
    } catch (e) {
      // e.g. discovery via internalUrl failed. §8: redirect-chain errors go to the login page.
      this.fail('BFF login: discovery failed', e);
      return res.redirect(302, loginError('login_failed'));
    }
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

  @Public()
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
      this.fail('BFF code exchange failed', e);
      return res.redirect(302, loginError('login_failed'));
    }

    let sessionCookie: string;
    try {
      const userAgent = first(req.headers['user-agent']);
      const { cookieValue } = await this.sessions.create(tokens.sub!, tokens, { ip: req.ip, userAgent });
      const ttl = await this.settings.getTtls();
      await this.users.touchLogin(tokens.sub!);
      sessionCookie = serializeCookie(SESSION_COOKIE, cookieValue, {
        path: '/',
        maxAge: ttl.sessionAbsolute,
        secure: this.secure,
      });
    } catch (e) {
      // e.g. the user was deleted between the interaction and the callback (FK violation).
      this.fail('BFF session creation failed', e);
      return res.redirect(302, loginError('login_failed'));
    }
    res.append('Set-Cookie', sessionCookie);
    res.redirect(302, st.returnTo);
  }

  /** Public so it can answer setup_required itself; otherwise the guard's own session validation. */
  @Public()
  @Get('me')
  async me(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<RequestUser> {
    res.setHeader('Cache-Control', 'no-store');
    if (await this.setup.isRequired()) throw new AuthError('setup_required', 409, 'Setup is required');
    return this.auth.authenticate(req, res);
  }

  /** Guarded (session + Origin): updates the caller's admin language; answers like `GET /me`. */
  @Patch('me')
  async updateMe(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<RequestUser> {
    const { locale } = parseBody(localeBody, body ?? {});
    await this.users.setLocale(req.user!.id, locale as Locale | null, {
      ip: req.ip,
      userAgent: first(req.headers['user-agent']),
    });
    const user = (await this.users.findById(req.user!.id))!;
    return { ...req.user!, locale: user.locale };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<{ redirectTo: string }> {
    res.setHeader('Cache-Control', 'no-store');
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    // The guard has just validated (and possibly refreshed) this session, so it is readable.
    const session = cookie ? await this.sessions.get(cookie).catch(() => undefined) : undefined;
    if (session?.refreshToken) {
      try {
        await this.oidc.revoke(session.refreshToken);
      } catch (e) {
        this.fail('Refresh token revocation failed', e);
      }
    }
    if (req.authSession) await this.sessions.delete(req.authSession.idHash);
    // C1: end the provider session server-side; no end-session hop (§7: no token ever reaches the browser).
    if (req.user) await this.revoker.destroyProviderSessions(req.user.id);
    this.auth.clearCookie(res);
    await this.audit.record({
      type: 'logout',
      userId: req.user?.id,
      ip: req.ip,
      userAgent: first(req.headers['user-agent']),
    });
    return { redirectTo: '/admin/login' };
  }

  /** Logs the error name only: messages may echo request data, and nothing token-/cookie-bearing is logged. */
  private fail(what: string, e: unknown): void {
    this.logger.warn(`${what}: ${(e as Error)?.name ?? 'Error'}`);
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
