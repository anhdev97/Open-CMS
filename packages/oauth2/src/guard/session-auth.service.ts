import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isSecureUrl, parseCookies, serializeCookie } from '../bff/cookies';
import { OidcClient } from '../bff/oidc-client';
import { REFRESH_LEASE_SEC, SessionStore, type SessionRow } from '../bff/session.store';
import type { OAuth2Config } from '../config/schema';
import { GRANT_REVOKER, OAUTH2_CONFIG, SESSION_COOKIE } from '../constants';
import { AuthError } from '../errors';
import { sha256 } from '../security/crypto';
import { UserService, type GrantRevoker } from '../users/user.service';
import type { RequestAuthSession, RequestUser } from './current-user.decorator';

/** Refresh when the access token has less than this left (spec §6.5 step 4). */
const REFRESH_MARGIN_MS = 60_000;
/** A request that lost the refresh lease polls this often, for at most the lease length. */
const LEASE_POLL_MS = 100;
const LEASE_WAIT_MS = REFRESH_LEASE_SEC * 1000;

export type AuthenticatedRequest = Request & { user?: RequestUser; authSession?: RequestAuthSession };

/**
 * Session validation of spec §6.5 steps 2–6, shared by AuthGuard and `GET /api/auth/me` (which is public
 * so that it can answer setup_required itself). Every 401 clears `oc_session`.
 */
@Injectable()
export class SessionAuthenticator {
  private readonly logger = new Logger('OAuth2');
  private readonly secure: boolean;
  private readonly refreshing = new Map<string, Promise<boolean>>();

  constructor(
    @Inject(OAUTH2_CONFIG) cfg: OAuth2Config,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(UserService) private readonly users: UserService,
    @Inject(OidcClient) private readonly oidc: OidcClient,
    @Inject(GRANT_REVOKER) private readonly revoker: GrantRevoker,
  ) {
    this.secure = isSecureUrl(cfg.publicUrl);
  }

  clearCookie(res: Response): void {
    res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { path: '/', maxAge: 0, secure: this.secure }));
  }

  /** Validates the request's session; on success sets `req.user` / `req.authSession` and returns the user. */
  async authenticate(req: AuthenticatedRequest, res: Response): Promise<RequestUser> {
    const unauthenticated = (): AuthError => {
      this.clearCookie(res);
      return new AuthError('unauthenticated', 401, 'Authentication required');
    };

    // Step 2: look the session up by sha256(cookie).
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!cookie) throw unauthenticated();
    const idHash = sha256(cookie);
    let session: SessionRow | undefined;
    try {
      session = await this.sessions.get(cookie);
    } catch (e) {
      // Row exists but cannot be opened (secret rotated, corrupt data): no usable session.
      this.warn('Session row unreadable; deleting it', e);
      await this.sessions.delete(idHash);
      throw unauthenticated();
    }
    if (!session) throw unauthenticated();
    const now = Date.now();
    // C1: a BFF session that ends here also ends the user's provider session, so the next
    // /api/auth/login cannot be silently re-authenticated by it.
    const endSession = async (userId: string): Promise<AuthError> => {
      await this.sessions.delete(idHash);
      await this.revoker.destroyProviderSessions(userId);
      return unauthenticated();
    };
    if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
      throw await endSession(session.userId);
    }

    // Step 3: the user must still exist and be active.
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'active') throw await endSession(session.userId);

    // Step 4: refresh near expiry, serialised per session.
    if (session.accessExpiresAt && session.accessExpiresAt.getTime() - now < REFRESH_MARGIN_MS) {
      const ok = await this.refresh(session);
      if (!ok) {
        await this.sessions.delete(idHash).catch(() => {});
        throw unauthenticated();
      }
    }

    // Step 5: sliding idle expiry (at most one write a minute, clamped to absolute).
    await this.sessions.touch(idHash);

    // Step 6.
    const result: RequestUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      groups: user.groups,
      permissions: user.permissions,
      isSuperAdmin: user.isSuperAdmin,
    };
    req.user = result;
    req.authSession = { idHash };
    return result;
  }

  /**
   * False when the session vanished or the refresh failed or timed out (the caller destroys the session).
   *
   * In-process single-flight per session in front of the DB lease (R18): concurrent requests of one
   * session await the same refresh. No DB connection or transaction is held while the HTTP call to
   * /oauth2/token runs (that endpoint needs the same pool).
   */
  private refresh(read: SessionRow): Promise<boolean> {
    const inFlight = this.refreshing.get(read.idHash);
    if (inFlight) return inFlight;
    const p = this.refreshLeased(read).finally(() => this.refreshing.delete(read.idHash));
    this.refreshing.set(read.idHash, p);
    return p;
  }

  private async refreshLeased(read: SessionRow): Promise<boolean> {
    const seen = read.accessExpiresAt?.getTime() ?? -Infinity;
    const fresher = (row: SessionRow | undefined) => (row?.accessExpiresAt?.getTime() ?? -Infinity) > seen;
    let row: SessionRow | undefined;
    try {
      row = await this.sessions.claimRefresh(read.idHash);
    } catch (e) {
      this.warn('Refresh lease claim failed', e);
      return false;
    }
    if (!row) return this.awaitOtherRefresh(read.idHash, fresher);

    // Winner. Another instance may have finished between our read and the claim.
    if (fresher(row) || !row.refreshToken) {
      await this.sessions.releaseRefresh(read.idHash).catch(() => {});
      return fresher(row);
    }
    try {
      const tokens = await this.oidc.refresh(row.refreshToken);
      await this.sessions.completeRefresh(read.idHash, tokens);
      return true;
    } catch (e) {
      this.warn('Token refresh failed', e);
      await this.sessions.releaseRefresh(read.idHash).catch(() => {});
      return false;
    }
  }

  /** Loser of the lease: poll until the holder has stored newer tokens (→ reuse) or give up. */
  private async awaitOtherRefresh(idHash: string, fresher: (row: SessionRow | undefined) => boolean): Promise<boolean> {
    const deadline = Date.now() + LEASE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LEASE_POLL_MS));
      let row: SessionRow | undefined;
      try {
        row = await this.sessions.getByHash(idHash);
      } catch {
        return false;
      }
      if (!row) return false;
      if (fresher(row)) return true;
    }
    this.logger.warn('Timed out waiting for another refresh of the session');
    return false;
  }

  /** Error name only: messages may carry token-endpoint responses. */
  private warn(what: string, e: unknown): void {
    this.logger.warn(`${what}: ${(e as Error)?.name ?? 'Error'}`);
  }
}
