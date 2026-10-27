import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T = unknown> = ColumnType<T, string | T, string | T>;

export interface AuthUsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  password_hash: string | null;
  status: Generated<string>; // 'active' | 'disabled'
  last_login_at: NullableTimestamp;
  locale: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuthGroupsTable {
  id: Generated<string>;
  /** Slug `^[a-z][a-z0-9-]{0,63}$`; `super-admin` is the built-in system group. */
  key: string;
  name: string;
  /** Permissions (spec B §3.1), stored sorted; ignored for `system` groups (they have all). */
  roles: Generated<string[]>;
  system: Generated<boolean>;
  updated_at: NullableTimestamp;
}

export interface AuthUserGroupsTable {
  user_id: string;
  group_id: string;
}

export interface AuthUserIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  subject: string;
  email: string | null;
  created_at: Timestamp;
}

export interface AuthOauthClientsTable {
  client_id: string;
  metadata: Json<Record<string, unknown>>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuthOidcPayloadsTable {
  kind: string;
  id: string;
  payload: Json<Record<string, unknown>>;
  grant_id: string | null;
  uid: string | null;
  user_code: string | null;
  expires_at: NullableTimestamp;
  consumed_at: NullableTimestamp;
}

export interface AuthSessionsTable {
  id_hash: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  id_token_enc: string | null;
  access_expires_at: NullableTimestamp;
  idle_expires_at: Date | string;
  absolute_expires_at: Date | string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  ip: string | null;
  user_agent: string | null;
  refresh_lease_until: NullableTimestamp;
}

export interface AuthSigningKeysTable {
  kid: string;
  jwk_private_enc: string;
  alg: string;
  created_at: Timestamp;
  retired_at: NullableTimestamp;
}

export interface AuthAuditEventsTable {
  id: Generated<string>;
  at: Timestamp;
  type: string;
  user_id: string | null;
  actor_id: string | null;
  ip: string | null;
  user_agent: string | null;
  meta: ColumnType<Record<string, unknown>, string | Record<string, unknown> | undefined, string | Record<string, unknown>>;
}


export type IdentityProviderLifecycle = 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
export type IdentityProviderVersionState = 'DRAFT' | 'TESTED' | 'PUBLISHED' | 'SUPERSEDED';
export type IdentityProviderHealthStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export interface AuthIdentityProvidersTable {
  id: Generated<string>;
  code: string;
  display_name: string;
  description: string | null;
  lifecycle_status: Generated<IdentityProviderLifecycle>;
  active_version_id: string | null;
  draft_version_id: string | null;
  display_order: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
}

export interface AuthIdentityProviderVersionsTable {
  id: Generated<string>;
  provider_id: string;
  version_no: number;
  state: Generated<IdentityProviderVersionState>;
  config_public: Json<Record<string, unknown>>;
  client_secret_enc: string | null;
  config_fingerprint: string;
  tested_fingerprint: string | null;
  tested_at: NullableTimestamp;
  published_at: NullableTimestamp;
  source_version_id: string | null;
  created_by: string | null;
  published_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuthLoginPolicyTable {
  id: number;
  sso_login_enabled: Generated<boolean>;
  revision: Generated<string>;
  updated_by: string | null;
  updated_at: Timestamp;
}

export interface AuthIdentityBlocksTable {
  id: Generated<string>;
  provider_code: string;
  subject_hash: string;
  reason: string;
  blocked_by: string | null;
  blocked_at: Timestamp;
  unblocked_by: string | null;
  unblocked_at: NullableTimestamp;
}

export interface AuthIdentityProviderHealthTable {
  provider_id: string;
  health_status: Generated<IdentityProviderHealthStatus>;
  active_version_id: string | null;
  checked_at: NullableTimestamp;
  last_success_at: NullableTimestamp;
  last_failure_at: NullableTimestamp;
  consecutive_failures: Generated<number>;
  failure_code: string | null;
}

export interface AuthIdentityProviderHealthEventsTable {
  id: Generated<string>;
  provider_id: string;
  version_id: string | null;
  category: string;
  failure_code: string | null;
  at: Timestamp;
}

export interface AuthSsoMigrationMarkersTable {
  key: string;
  fingerprint: string | null;
  created_at: Timestamp;
}

export interface AuthTables {
  auth_identity_providers: AuthIdentityProvidersTable;
  auth_identity_provider_versions: AuthIdentityProviderVersionsTable;
  auth_login_policy: AuthLoginPolicyTable;
  auth_identity_blocks: AuthIdentityBlocksTable;
  auth_identity_provider_health: AuthIdentityProviderHealthTable;
  auth_identity_provider_health_events: AuthIdentityProviderHealthEventsTable;
  auth_sso_migration_markers: AuthSsoMigrationMarkersTable;
  auth_users: AuthUsersTable;
  auth_groups: AuthGroupsTable;
  auth_user_groups: AuthUserGroupsTable;
  auth_user_identities: AuthUserIdentitiesTable;
  auth_oauth_clients: AuthOauthClientsTable;
  auth_oidc_payloads: AuthOidcPayloadsTable;
  auth_sessions: AuthSessionsTable;
  auth_signing_keys: AuthSigningKeysTable;
  auth_audit_events: AuthAuditEventsTable;
}
