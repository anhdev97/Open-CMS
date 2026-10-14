import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isSecureUrl, parseCookies, serializeCookie } from '../bff/cookies';
import { OidcClient } from '../bff/oidc-client';
import { SessionStore, type SessionRow } from '../bff/session.store';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, SESSION_COOKIE } from '../constants';
import { AuthError } from '../errors';
import { sha256 } from '../security/crypto';
import { UserService } from '../users/user.service';
import type { RequestAuthSession, RequestUser } from './current-user.decorator';

/** Refresh when the access token has less than this left (spec §6.5 step 4). */
const REFRESH_MARGIN_MS = 60_000;

export type AuthenticatedRequest = Request & { user?: RequestUser; authSession?: RequestAuthSession };

/**
 * Session validation of spec §6.5 steps 2–6, shared by AuthGuard and `GET /api/auth/me` (which is public
 * so that it can answer setup_required itself). Every 401 clears `oc_session`.
 */
@Injectable()
export class SessionAuthenticator {
  private readonly logger = new Logger('OAuth2');
  private readonly secure: boolean;

  constructor(
    @Inject(OAUTH2_CONFIG) cfg: OAuth2Config,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(UserService) private readonly users: UserService,
    @Inject(OidcClient) private readonly oidc: OidcClient,
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
    if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
      await this.sessions.delete(idHash);
      throw unauthenticated();
    }

    // Step 3: the user must still exist and be active.
    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'active') {
      await this.sessions.delete(idHash);
      throw unauthenticated();
    }

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
    const result: RequestUser = { id: user.id, email: user.email, name: user.name, roles: user.roles };
    req.user = result;
    req.authSession = { idHash };
    return result;
  }

  /** False when the session vanished or the refresh failed (the caller destroys the session). */
  private async refresh(read: SessionRow): Promise<boolean> {
    const seen = read.accessExpiresAt?.getTime();
    try {
      return await this.sessions.lockForRefresh(read.idHash, async (row, trx) => {
        if (!row) return false;
        // Another request refreshed while we waited for the lock: its tokens are ours too.
        if (row.accessExpiresAt?.getTime() !== seen) return true;
        if (!row.refreshToken) return false;
        const tokens = await this.oidc.refresh(row.refreshToken);
        await this.sessions.updateTokens(row.idHash, tokens, trx);
        return true;
      });
    } catch (e) {
      this.warn('Token refresh failed', e);
      return false;
    }
  }

  /** Error name only: messages may carry token-endpoint responses. */
  private warn(what: string, e: unknown): void {
    this.logger.warn(`${what}: ${(e as Error)?.name ?? 'Error'}`);
  }
}
