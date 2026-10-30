import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { normalizeEmail } from '../security/email';
import { UserService, type AuthUser } from '../users/user.service';
import { IdentityBlockService } from '../sso-management/identity-block.service';
import type { ExternalIdentity } from './identity-provider';

/**
 * Spec §6.4 step 3 / D6: an external identity only ever maps to an existing user. Unlinked identities are
 * linked by verified email (normalized, matched on lower(email)); users are never created here.
 */
@Injectable()
export class IdentityLinker {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(UserService) private readonly users: UserService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdentityBlockService) private readonly blocks: IdentityBlockService,
  ) {}

  /** userId, or AuthError `idp_email_unverified` | `idp_account_not_found` | `account_disabled`. */
  async resolve(identity: ExternalIdentity): Promise<string> {
    await this.blocks.assertAllowed(identity.provider, identity.subject);
    const linked = await this.linkedUser(identity);
    if (linked) return this.active(linked);

    if (!identity.emailVerified) throw new AuthError('idp_email_unverified', 403, 'IdP email is not verified');
    const email = identity.email ? normalizeEmail(identity.email) : '';
    const user = email ? await this.users.findByEmail(email) : undefined;
    if (!user) throw new AuthError('idp_account_not_found', 403, 'No account for this identity');
    // A disabled account is not linked (no side effect on a refused login).
    this.active(user);

    try {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('auth_user_identities')
          .values({ user_id: user.id, provider: identity.provider, subject: identity.subject, email })
          .execute();
        await this.audit.record({ type: 'idp_linked', userId: user.id, meta: { provider: identity.provider } }, trx);
      });
      return user.id;
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
      // A concurrent login linked (provider, subject) first: that link wins.
      const winner = await this.linkedUser(identity);
      if (!winner) throw e;
      return this.active(winner);
    }
  }

  private async linkedUser(identity: ExternalIdentity): Promise<AuthUser | undefined> {
    const row = await this.db
      .selectFrom('auth_user_identities')
      .select('user_id')
      .where('provider', '=', identity.provider)
      .where('subject', '=', identity.subject)
      .executeTakeFirst();
    // ON DELETE CASCADE: a link always has its user; undefined only if deleted in between.
    return row ? this.users.findById(row.user_id) : undefined;
  }

  private active(user: AuthUser): string {
    if (user.status !== 'active') throw new AuthError('account_disabled', 403, 'Account is disabled');
    return user.id;
  }
}
