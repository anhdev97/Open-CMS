export const OAUTH2_DB = Symbol('OAUTH2_DB');
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');
export const AUTH_SETUP_LOCK = 0x0c_a0_5e_70;
export const ADMIN_CLIENT_ID = 'opencms-admin';
export const SESSION_COOKIE = 'oc_session';
export const LOGIN_COOKIE = 'oc_login';
export const IDP_COOKIE = 'oc_idp';
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const GRANT_REVOKER = Symbol('GRANT_REVOKER');
export const OAUTH2_CONFIG = Symbol('OAUTH2_CONFIG');

/** Lower-cased `/api/...` prefixes the AuthGuard lets through without a session (R17). */
export const PUBLIC_PATH_PREFIXES = Symbol('OAUTH2_PUBLIC_PATH_PREFIXES');

/** Resolves once the host (e.g. @opencloudcms/core) is ready for the provider to touch the database; rejects to abort startup. */
export const CORE_READY = Symbol('CORE_READY');

/**
 * What CORE_READY resolves to. A holder object (not a promise) so Nest does not await it during provider
 * instantiation: the host settles `wait()` later, from its own onModuleInit.
 */
export interface CoreReady {
  wait(): Promise<void>;
}
