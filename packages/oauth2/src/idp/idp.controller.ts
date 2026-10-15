import { Controller, Get, Inject, Logger, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { isSecureUrl, parseCookies, serializeCookie } from '../bff/cookies';
import type { OAuth2Config } from '../config/schema';
import { IDP_COOKIE, OAUTH2_CONFIG } from '../constants';
import { AuthError } from '../errors';
import { Public } from '../guard/public.decorator';
import { InteractionExpired, InteractionMismatch, InteractionService } from '../interaction/interaction.service';
import { IdentityLinker } from './identity-linker';
import {
  IDENTITY_PROVIDERS,
  idpCookieKey,
  openIdpState,
  sealIdpState,
  type IdentityProvider,
} from './identity-provider';
import { IdpStateMismatch } from './oidc.identity-provider';

const IDP_COOKIE_PATH = '/oauth2';
const IDP_COOKIE_MAX_AGE = 600;
/** The hand-over from callback to completion is a single redirect away. */
const LINKED_COOKIE_MAX_AGE = 60;
const LINKER_CODES = new Set(['idp_email_unverified', 'idp_account_not_found', 'account_disabled']);

const loginError = (code: string) => `/admin/login?error=${code}`;
const first = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/**
 * Spec §6.4. Three browser hops, all 302s:
 *  1. `GET /oauth2/interaction/:uid/idp/:provider` – checks the interaction, sets `oc_idp`, → IdP.
 *  2. `GET /oauth2/idp/:provider/callback` (fixed redirect_uri) – uid from `oc_idp`, state check, code
 *     exchange, IdentityLinker → `oc_idp` now carries the resolved user → step 3.
 *  3. `GET /oauth2/interaction/:uid/idp/:provider/complete` – where the provider's `_interaction` cookie
 *     (Path=/oauth2/interaction) is sent: binds `oc_idp` to this browser's interaction, finishes it and
 *     continues to the provider resume URL (then §6.3 step 6).
 * Every failure ends at `/admin/login?error=<code>`.
 */
@Public()
@Controller('oauth2')
export class IdpController {
  private readonly logger = new Logger('OAuth2');
  private readonly key: Buffer;
  private readonly secure: boolean;

  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(IDENTITY_PROVIDERS) private readonly providers: IdentityProvider[],
    @Inject(InteractionService) private readonly interactions: InteractionService,
    @Inject(IdentityLinker) private readonly linker: IdentityLinker,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.key = idpCookieKey(cfg.secret);
    this.secure = isSecureUrl(cfg.publicUrl);
  }

  @Get('interaction/:uid/idp/:provider')
  async start(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Param('provider') providerId: string,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.interactions.details(req, res, uid);
    } catch (e) {
      if (e instanceof InteractionExpired) return res.redirect(302, loginError('login_expired'));
      throw e;
    }
    const idp = this.find(providerId);
    if (!idp) return res.redirect(302, loginError('login_failed'));

    let out: { redirectUrl: string; cookie: string };
    try {
      out = await idp.start({ uid, returnUrl: this.callbackUrl(idp) });
    } catch (e) {
      // e.g. IdP discovery failed.
      this.fail('IdP start failed', e);
      return res.redirect(302, loginError('login_failed'));
    }
    this.setCookie(res, out.cookie, IDP_COOKIE_MAX_AGE);
    res.redirect(302, out.redirectUrl);
  }

  @Get('idp/:provider/callback')
  async callback(@Req() req: Request, @Res() res: Response, @Param('provider') providerId: string): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const sealed = parseCookies(req.headers.cookie)[IDP_COOKIE];
    // oc_idp is single-use: every outcome clears it, success replaces it with the hand-over state.
    const deny = (code: string) => {
      this.clearCookie(res);
      res.redirect(302, loginError(code));
    };

    const st = openIdpState(this.key, sealed);
    const idp = this.find(providerId);
    const query = new URLSearchParams(new URL(req.originalUrl ?? req.url, 'http://internal').search);
    if (!st || st.phase !== 'start' || !idp || st.provider !== idp.id || query.get('state') !== st.state) {
      return deny('invalid_state');
    }
    if (query.has('error')) return deny('login_failed');

    let identity;
    try {
      identity = await idp.finish({ uid: st.uid, query, cookie: sealed! });
    } catch (e) {
      if (e instanceof IdpStateMismatch) return deny('invalid_state');
      this.fail('IdP code exchange failed', e);
      return deny('login_failed');
    }

    let userId: string;
    try {
      userId = await this.linker.resolve(identity);
    } catch (e) {
      if (e instanceof AuthError && LINKER_CODES.has(e.code)) {
        await this.audit.record({
          type: 'login_failed',
          ip: req.ip,
          userAgent: first(req.headers['user-agent']),
          meta: { reason: e.code, method: 'idp', provider: idp.id },
        });
        return deny(e.code);
      }
      this.fail('IdP identity linking failed', e);
      return deny('login_failed');
    }

    this.setCookie(res, sealIdpState(this.key, { phase: 'linked', uid: st.uid, provider: idp.id, userId }), LINKED_COOKIE_MAX_AGE);
    res.redirect(302, `/oauth2/interaction/${encodeURIComponent(st.uid)}/idp/${encodeURIComponent(idp.id)}/complete`);
  }

  @Get('interaction/:uid/idp/:provider/complete')
  async complete(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Param('provider') providerId: string,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const st = openIdpState(this.key, parseCookies(req.headers.cookie)[IDP_COOKIE]);
    this.clearCookie(res);
    if (!st || st.phase !== 'linked' || st.uid !== uid || st.provider !== providerId) {
      return res.redirect(302, loginError('invalid_state'));
    }

    let redirectTo: string;
    try {
      ({ redirectTo } = await this.interactions.finishLogin(req, res, uid, st.userId));
    } catch (e) {
      // oc_idp was issued for another interaction than the one this browser holds.
      if (e instanceof InteractionMismatch) return res.redirect(302, loginError('invalid_state'));
      if (e instanceof InteractionExpired) return res.redirect(302, loginError('login_expired'));
      this.fail('IdP interaction completion failed', e);
      return res.redirect(302, loginError('login_failed'));
    }
    await this.audit.record({
      type: 'login_succeeded',
      userId: st.userId,
      ip: req.ip,
      userAgent: first(req.headers['user-agent']),
      meta: { method: 'idp', provider: st.provider },
    });
    res.redirect(302, redirectTo);
  }

  private find(id: string): IdentityProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  private callbackUrl(idp: IdentityProvider): string {
    return `${this.cfg.publicUrl}/oauth2/idp/${idp.id}/callback`;
  }

  private setCookie(res: Response, value: string, maxAge: number): void {
    res.append('Set-Cookie', serializeCookie(IDP_COOKIE, value, { path: IDP_COOKIE_PATH, maxAge, secure: this.secure }));
  }

  private clearCookie(res: Response): void {
    res.append('Set-Cookie', serializeCookie(IDP_COOKIE, '', { path: IDP_COOKIE_PATH, maxAge: 0, secure: this.secure }));
  }

  /** Error name only: messages may echo request data. */
  private fail(what: string, e: unknown): void {
    this.logger.warn(`${what}: ${(e as Error)?.name ?? 'Error'}`);
  }
}
