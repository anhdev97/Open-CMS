import { deriveKey, open, seal } from '../security/crypto';

/** Output of `seal` (base64url AES-256-GCM); the value of the `oc_idp` cookie. */
export type SealedState = string;

/** What an external IdP asserts about the person who just signed in there (spec §6.4). */
export type ExternalIdentity = { provider: string; subject: string; email?: string; emailVerified: boolean };

/** Spec §6.4. One instance per configured external IdP. */
export interface IdentityProvider {
  id: string;
  label: string;
  /** `returnUrl` is the IdP-facing redirect_uri (the fixed callback). */
  start(ctx: { uid: string; returnUrl: string }): Promise<{ redirectUrl: string; cookie: SealedState }>;
  finish(ctx: { uid: string; query: URLSearchParams; cookie: SealedState }): Promise<ExternalIdentity>;
}

/** DI token: `IdentityProvider[]` (empty when no IdP is configured). */
export const IDENTITY_PROVIDERS = Symbol('IDENTITY_PROVIDERS');

/** Contents of `oc_idp` while the browser is at the IdP. */
export interface IdpStartState {
  phase: 'start';
  uid: string;
  provider: string;
  state: string;
  nonce: string;
  verifier: string;
  versionId?: string;
  startedAt?: number;
}

/**
 * Contents of `oc_idp` between the IdP callback and `/oauth2/interaction/:uid/idp/:provider/complete`:
 * the provider's `_interaction` cookie is scoped to /oauth2/interaction, so the callback (under
 * /oauth2/idp) cannot finish the interaction itself and hands the resolved user over in this cookie.
 */
export interface IdpLinkedState {
  phase: 'linked';
  uid: string;
  provider: string;
  userId: string;
  subject?: string;
  versionId?: string;
  startedAt?: number;
}

export type IdpState = IdpStartState | IdpLinkedState;

export const idpCookieKey = (secret: Buffer): Buffer => deriveKey(secret, 'cookie');

export function sealIdpState(key: Buffer, s: IdpState): SealedState {
  return seal(key, JSON.stringify(s));
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** undefined for a missing, tampered or malformed cookie. */
export function openIdpState(key: Buffer, sealed: string | undefined): IdpState | undefined {
  if (!sealed) return undefined;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(open(key, sealed));
  } catch {
    return undefined;
  }
  if (!v || !str(v.uid) || !str(v.provider)) return undefined;
  if (v.phase === 'start' && str(v.state) && str(v.nonce) && str(v.verifier)) {
    return { phase: 'start', uid: v.uid, provider: v.provider, state: v.state, nonce: v.nonce, verifier: v.verifier,
      versionId: str(v.versionId) ? v.versionId : undefined,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : undefined };
  }
  if (v.phase === 'linked' && str(v.userId)) {
    return { phase: 'linked', uid: v.uid, provider: v.provider, userId: v.userId,
      subject: str(v.subject) ? v.subject : undefined,
      versionId: str(v.versionId) ? v.versionId : undefined,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : undefined };
  }
  return undefined;
}
