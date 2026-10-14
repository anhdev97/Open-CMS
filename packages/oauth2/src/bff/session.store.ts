import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { OAuth2Config } from '../config/schema';
import { AUTH_SETTINGS, OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { AuthSessionsTable, AuthTables } from '../db/types';
import { deriveKey, open, seal, sha256 } from '../security/crypto';
import type { AuthSettingsProvider } from '../settings/settings.provider';
import type { TokenSet } from './oidc-client';

/** A BFF session with its tokens opened. Expiry is NOT checked here (the guard does that). */
export interface SessionRow {
  idHash: string;
  userId: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  accessExpiresAt?: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  ip?: string;
  userAgent?: string;
}

/** touch() writes at most once per this many ms. */
const TOUCH_INTERVAL_MS = 60_000;
/** How long a claimed refresh lease is valid (R18). */
export const REFRESH_LEASE_SEC = 10;

/** Server-side store of BFF sessions (`auth_sessions`, spec §4). The browser only holds the cookie value. */
@Injectable()
export class SessionStore {
  private readonly key: Buffer;

  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) cfg: OAuth2Config,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettingsProvider,
  ) {
    this.key = deriveKey(cfg.secret, 'token');
  }

  async create(
    userId: string,
    tokens: TokenSet,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ cookieValue: string; idHash: string }> {
    const ttl = await this.settings.getTtls();
    const cookieValue = randomBytes(32).toString('base64url');
    const idHash = sha256(cookieValue);
    const now = new Date();
    await this.db
      .insertInto('auth_sessions')
      .values({
        id_hash: idHash,
        user_id: userId,
        access_token_enc: seal(this.key, tokens.accessToken),
        refresh_token_enc: tokens.refreshToken ? seal(this.key, tokens.refreshToken) : null,
        id_token_enc: tokens.idToken ? seal(this.key, tokens.idToken) : null,
        access_expires_at: accessExpiry(now, tokens),
        idle_expires_at: new Date(now.getTime() + Math.min(ttl.sessionIdle, ttl.sessionAbsolute) * 1000),
        absolute_expires_at: new Date(now.getTime() + ttl.sessionAbsolute * 1000),
        created_at: now,
        last_seen_at: now,
        ip: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
      })
      .execute();
    return { cookieValue, idHash };
  }

  async get(cookieValue: string): Promise<SessionRow | undefined> {
    if (!cookieValue) return undefined;
    return this.getByHash(sha256(cookieValue));
  }

  /** Same as get(), by `sha256(cookie)`. */
  async getByHash(idHash: string): Promise<SessionRow | undefined> {
    const row = await this.db.selectFrom('auth_sessions').selectAll().where('id_hash', '=', idHash).executeTakeFirst();
    return row ? this.toRow(row) : undefined;
  }

  /**
   * Claims the refresh lease (R18) with one atomic UPDATE: succeeds only when no unexpired lease exists.
   * Returns the (decrypted) row for the winner, undefined when the session is gone or someone else holds
   * the lease. No transaction stays open: the caller does the HTTP refresh afterwards.
   */
  async claimRefresh(idHash: string): Promise<SessionRow | undefined> {
    const row = await this.db
      .updateTable('auth_sessions')
      .set({ refresh_lease_until: sql<Date>`now() + make_interval(secs => ${REFRESH_LEASE_SEC})` })
      .where('id_hash', '=', idHash)
      .where((eb) => eb.or([eb('refresh_lease_until', 'is', null), eb('refresh_lease_until', '<', sql<Date>`now()`)]))
      .returningAll()
      .executeTakeFirst();
    return row ? this.toRow(row) : undefined;
  }

  /**
   * Stores the refreshed tokens and releases the lease. A refresh/id token missing from the response
   * keeps the stored one.
   */
  async completeRefresh(idHash: string, tokens: TokenSet): Promise<void> {
    const now = new Date();
    await this.db
      .updateTable('auth_sessions')
      .set({
        access_token_enc: seal(this.key, tokens.accessToken),
        access_expires_at: accessExpiry(now, tokens),
        ...(tokens.refreshToken ? { refresh_token_enc: seal(this.key, tokens.refreshToken) } : {}),
        ...(tokens.idToken ? { id_token_enc: seal(this.key, tokens.idToken) } : {}),
        refresh_lease_until: null,
      })
      .where('id_hash', '=', idHash)
      .execute();
  }

  /** Releases the lease without changing tokens (refresh failed or turned out unnecessary). */
  async releaseRefresh(idHash: string): Promise<void> {
    await this.db.updateTable('auth_sessions').set({ refresh_lease_until: null }).where('id_hash', '=', idHash).execute();
  }

  /** Slides the idle expiry to min(now + idle, absolute); a no-op if last seen < 60 s before `now`. */
  async touch(idHash: string, now: Date = new Date()): Promise<void> {
    const ttl = await this.settings.getTtls();
    const idle = new Date(now.getTime() + ttl.sessionIdle * 1000);
    await this.db
      .updateTable('auth_sessions')
      .set({
        last_seen_at: now,
        idle_expires_at: sql<Date>`least(${idle}::timestamptz, absolute_expires_at)`,
      })
      .where('id_hash', '=', idHash)
      .where('last_seen_at', '<', new Date(now.getTime() - TOUCH_INTERVAL_MS))
      .execute();
  }

  async delete(idHash: string): Promise<void> {
    await this.db.deleteFrom('auth_sessions').where('id_hash', '=', idHash).execute();
  }

  private toRow(r: Selectable<AuthSessionsTable>): SessionRow {
    const opt = (v: string | null) => (v ? open(this.key, v) : undefined);
    return {
      idHash: r.id_hash,
      userId: r.user_id,
      accessToken: opt(r.access_token_enc) ?? '',
      refreshToken: opt(r.refresh_token_enc),
      idToken: opt(r.id_token_enc) ?? '',
      accessExpiresAt: r.access_expires_at ? new Date(r.access_expires_at as Date) : undefined,
      idleExpiresAt: new Date(r.idle_expires_at),
      absoluteExpiresAt: new Date(r.absolute_expires_at),
      createdAt: new Date(r.created_at as Date),
      lastSeenAt: new Date(r.last_seen_at as Date),
      ip: r.ip ?? undefined,
      userAgent: r.user_agent ?? undefined,
    };
  }
}

function accessExpiry(now: Date, t: TokenSet): Date | null {
  return t.expiresIn !== undefined ? new Date(now.getTime() + t.expiresIn * 1000) : null;
}
