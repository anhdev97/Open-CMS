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

export interface AuthTables {
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
