import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { OAuth2Config } from '../config/schema';
import { AUTH_SETTINGS, OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { AuthSessionsTable, AuthTables } from '../db/types';
import { deriveKey, open, seal, sha256 } from '../security/crypto';
import type { AuthSettingsProvider } from '../settings/settings.provider';
import type { TokenSet } from './oidc-client';
import type { StoredAuthOrigin } from '../sso-management/auth-provenance.service';

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
  authMethod: 'unknown' | 'local' | 'oidc';
  originProviderCode?: string;
  originSubjectHash?: string;
  originProviderVersionId?: string;
  originGrantId?: string;
  stepUpVerifiedAt?: Date;
}

/** touch() writes at most once per this many ms. */
const TOUCH_INTERVAL_MS = 60_000;
/** How long a claimed refresh lease is valid (R18). */
export const REFRESH_LEASE_SEC = 10;

/** Server-side store of BFF sessions (`auth_sessions`, spec §4). The browser only holds the cookie value. */
@Injectable()
export class SessionStore {
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) cfg: OAuth2Config,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettingsProvider,
  ) {
    this.key = deriveKey(cfg.secret, 'token');
    this.hmacKey = cfg.secret;
  }

  async create(
    userId: string,
    tokens: TokenSet,
    meta: { ip?: string; userAgent?: string },
    origin?: StoredAuthOrigin,
  ): Promise<{ cookieValue: string; idHash: string }> {
    const ttl = await this.settings.getTtls();
    const cookieValue = randomBytes(32).toString('base64url');
    const idHash = sha256(cookieValue);
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      if (origin?.method === 'oidc') {
        // Consistent lock order with IdentityBlockService.block() closes the Block vs callback race.
        await sql`select pg_advisory_xact_lock(hashtext(${origin.providerCode}), hashtext(${origin.subjectHash}))`.execute(trx);
        const blocked = await trx.selectFrom('auth_identity_blocks').select('id')
          .where('provider_code', '=', origin.providerCode)
          .where('subject_hash', '=', origin.subjectHash)
          .where('unblocked_at', 'is', null).executeTakeFirst();
        if (blocked) throw new Error('External identity is blocked');
        const policy = await trx.selectFrom('auth_login_policy').select('sso_login_enabled')
          .where('id', '=', 1).forShare().executeTakeFirstOrThrow();
        if (!policy.sso_login_enabled) throw new Error('SSO login disabled');
        const provider = await trx.selectFrom('auth_identity_providers').select('id')
          .where('code', '=', origin.providerCode)
          .where('lifecycle_status', '=', 'ACTIVE').forShare().executeTakeFirst();
        if (!provider) throw new Error('SSO provider is inactive');
      }
      // Serialize new sessions against a concurrent user disable operation.
      const user = await trx.selectFrom('auth_users').select('status')
        .where('id', '=', userId).forShare().executeTakeFirst();
      if (!user || user.status !== 'active') throw new Error('User is disabled');
      const grant = tokens.refreshToken || tokens.accessToken
        ? await trx.selectFrom('auth_oidc_payloads').select('grant_id')
          .where((eb) => eb.or([
            ...(tokens.refreshToken
              ? [eb.and([eb('kind', '=', 'RefreshToken'), eb('id', '=', tokens.refreshToken)])]
              : []),
            eb.and([eb('kind', '=', 'AccessToken'), eb('id', '=', tokens.accessToken)]),
          ]))
          .executeTakeFirst()
        : undefined;
      await trx.insertInto('auth_sessions').values({
        id_hash: idHash, user_id: userId,
        access_token_enc: seal(this.key, tokens.accessToken),
        refresh_token_enc: tokens.refreshToken ? seal(this.key, tokens.refreshToken) : null,
        id_token_enc: tokens.idToken ? seal(this.key, tokens.idToken) : null,
        access_expires_at: accessExpiry(now, tokens),
        idle_expires_at: new Date(now.getTime() + Math.min(ttl.sessionIdle, ttl.sessionAbsolute) * 1000),
        absolute_expires_at: new Date(now.getTime() + ttl.sessionAbsolute * 1000),
        created_at: now, last_seen_at: now, ip: meta.ip ?? null, user_agent: meta.userAgent ?? null,
        auth_method: origin?.method ?? 'unknown',
        origin_provider_code: origin?.method === 'oidc' ? origin.providerCode : null,
        origin_subject_hash: origin?.method === 'oidc' ? origin.subjectHash : null,
        origin_provider_version_id: origin?.method === 'oidc' ? origin.providerVersionId : null,
        origin_grant_id: grant?.grant_id ?? null,
        step_up_verified_at: null,
      }).execute();
    });
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

  /**
   * The provider Grant behind a session: its stored refresh token is the id of the adapter's
   * `RefreshToken` row, which carries the grant id. Undefined when the session or token is gone.
   */
  async grantIdOf(idHash: string): Promise<string | undefined> {
    const refreshToken = (await this.getByHash(idHash))?.refreshToken;
    if (!refreshToken) return undefined;
    const row = await this.db
      .selectFrom('auth_oidc_payloads')
      .select('grant_id')
      .where('kind', '=', 'RefreshToken')
      .where('id', '=', refreshToken)
      .executeTakeFirst();
    return row?.grant_id ?? undefined;
  }


  async revokeByExternalIdentity(providerCode: string, subject: string): Promise<number> {
    const subjectHash = createHmac('sha256', this.hmacKey)
      .update('opencloudcms/sso-subject/v1\0').update(providerCode).update('\0').update(subject)
      .digest('hex');
    const deleted = await this.db.deleteFrom('auth_sessions')
      .where('origin_provider_code', '=', providerCode).where('origin_subject_hash', '=', subjectHash)
      .executeTakeFirst();
    return Number(deleted.numDeletedRows);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const deleted = await this.db.deleteFrom('auth_sessions')
      .where('user_id', '=', userId).executeTakeFirst();
    return Number(deleted.numDeletedRows);
  }

  async setStepUpVerifiedAt(idHash: string, verifiedAt: Date): Promise<void> {
    await this.db.updateTable('auth_sessions')
      .set({ step_up_verified_at: verifiedAt }).where('id_hash', '=', idHash).execute();
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
      authMethod: r.auth_method,
      originProviderCode: r.origin_provider_code ?? undefined,
      originSubjectHash: r.origin_subject_hash ?? undefined,
      originProviderVersionId: r.origin_provider_version_id ?? undefined,
      originGrantId: r.origin_grant_id ?? undefined,
      stepUpVerifiedAt: r.step_up_verified_at ? new Date(r.step_up_verified_at) : undefined,
    };
  }
}

function accessExpiry(now: Date, t: TokenSet): Date | null {
  return t.expiresIn !== undefined ? new Date(now.getTime() + t.expiresIn * 1000) : null;
}
