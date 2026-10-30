import { Inject, Injectable } from '@nestjs/common';
import { ProviderService } from '../provider/provider.service';
import { AuthProvenanceService, type AuthOrigin } from '../sso-management/auth-provenance.service';

export const LOGIN_EXPIRED_REDIRECT = '/admin/login?error=login_expired';

/** Thrown when the interaction behind `uid` is unknown, expired, or not this browser's. */
export class InteractionExpired extends Error {
  constructor() {
    super('interaction expired');
    this.name = 'InteractionExpired';
  }
}

/**
 * The browser holds a live interaction, but a different one than the uid in the URL. Still an
 * InteractionExpired for the password routes; the IdP completion maps it to `invalid_state`.
 */
export class InteractionMismatch extends InteractionExpired {
  constructor() {
    super();
    this.name = 'InteractionMismatch';
  }
}

/**
 * Wraps oidc-provider's interaction API for the Nest interaction routes (password login here, IdP
 * login in Task 13).
 */
@Injectable()
export class InteractionService {
  constructor(
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(AuthProvenanceService) private readonly provenance: AuthProvenanceService,
  ) {}

  /**
   * Loads the interaction bound to this browser (signed `_interaction` cookie) and checks that it is
   * the one named in the URL. SessionNotFound (no cookie, expired/unknown interaction, provider session
   * gone) and a uid mismatch both become InteractionExpired.
   */
  async details(req: unknown, res: unknown, uid: string): Promise<any> {
    let interaction: any;
    try {
      interaction = await this.providers.provider.interactionDetails(req, res);
    } catch (e) {
      if ((e as Error)?.name === 'SessionNotFound') throw new InteractionExpired();
      throw e;
    }
    if (!interaction) throw new InteractionExpired();
    if (interaction.uid !== uid) throw new InteractionMismatch();
    return interaction;
  }

  /**
   * Records a successful login for `uid` and returns the provider's resume URL
   * (`<issuer>/auth/<uid>`). The redirect is NOT written to `res`; the SPA navigates to it. The
   * opencloudcms-admin grant (4 scopes) is created by `loadExistingGrant` on resume, so no consent
   * prompt follows.
   */
  async finishLogin(req: unknown, res: unknown, uid: string, userId: string, origin: AuthOrigin = { method: 'local' }): Promise<{ redirectTo: string }> {
    const interaction = await this.details(req, res, uid);
    await this.provenance.bindInteraction(interaction, userId, origin);
    let redirectTo: string;
    try {
      redirectTo = await this.providers.provider.interactionResult(
        req,
        res,
        { login: { accountId: userId } },
        { mergeWithLastSubmission: false },
      );
    } catch (e) {
      if ((e as Error)?.name === 'SessionNotFound') throw new InteractionExpired();
      throw e;
    }
    return { redirectTo };
  }
}
