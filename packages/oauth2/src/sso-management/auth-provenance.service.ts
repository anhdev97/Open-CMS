import { createHash, createHmac } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { ADMIN_CLIENT_ID, OAUTH2_CONFIG, OAUTH2_DB } from '../constants';
import type { OAuth2Config } from '../config/schema';
import type { AuthTables } from '../db/types';

export type AuthOrigin =
  | { method: 'local' }
  | { method: 'oidc'; providerCode: string; externalSubject: string; providerVersionId: string };
export type StoredAuthOrigin =
  | { method: 'local' }
  | { method: 'oidc'; providerCode: string; subjectHash: string; providerVersionId: string };

export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

@Injectable()
export class AuthProvenanceService {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
  ) {}

  /** HMAC rather than unsalted SHA-256 prevents offline subject enumeration. */
  subjectHash(providerCode: string, subject: string): string {
    return createHmac('sha256', this.cfg.secret)
      .update('opencloudcms/sso-subject/v1\0').update(providerCode).update('\0').update(subject)
      .digest('hex');
  }

  private challengeHash(challenge: string): string {
    return createHmac('sha256', this.cfg.secret)
      .update('opencloudcms/sso-challenge/v1\0').update(challenge).digest('hex');
  }

  /**
   * Takes ONLY oidc-provider interactionDetails(), never a browser-submitted uid/challenge.
   * The AS has authenticated the internal client's signed interaction cookie.
   */
  async bindInteraction(
    interaction: { params?: Record<string, unknown> },
    userId: string,
    origin: AuthOrigin,
  ): Promise<void> {
    const challenge = interaction.params?.code_challenge;
    if (interaction.params?.client_id !== ADMIN_CLIENT_ID ||
      interaction.params?.code_challenge_method !== 'S256' ||
      typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new ConflictException('Internal authorization context is not PKCE-bound');
    }
    const external = origin.method === 'oidc' ? origin : undefined;
    await this.db.insertInto('auth_sso_auth_contexts').values({
      challenge_hash: this.challengeHash(challenge),
      user_id: userId,
      auth_method: origin.method,
      provider_code: external?.providerCode ?? null,
      subject_hash: external ? this.subjectHash(external.providerCode, external.externalSubject) : null,
      provider_version_id: external?.providerVersionId ?? null,
      expires_at: new Date(Date.now() + 600_000),
    }).execute();
  }

  /**
   * Trusted proof: the BFF has verified sealed oc_login + successful code exchange
   * using this PKCE verifier. The returned token subject must match bound AS user.
   * Atomic DELETE makes the record strictly one-use.
   */
  async consumeForBff(verifier: string, userId: string): Promise<StoredAuthOrigin> {
    const hash = this.challengeHash(challengeFromVerifier(verifier));
    const row = await this.db.deleteFrom('auth_sso_auth_contexts')
      .where('challenge_hash', '=', hash)
      .where('user_id', '=', userId)
      .where('expires_at', '>', sql<Date>`now()`)
      .returning(['auth_method', 'provider_code', 'subject_hash', 'provider_version_id'])
      .executeTakeFirst();
    if (!row) throw new ConflictException('Missing, expired or already consumed auth provenance');
    if (row.auth_method === 'local') return { method: 'local' };
    if (row.auth_method !== 'oidc' || !row.provider_code || !row.subject_hash || !row.provider_version_id) {
      throw new ConflictException('Invalid authentication provenance');
    }
    return {
      method: 'oidc',
      providerCode: row.provider_code,
      subjectHash: row.subject_hash,
      providerVersionId: row.provider_version_id,
    };
  }
}
