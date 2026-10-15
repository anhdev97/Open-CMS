import { sql, type Kysely, type Migration } from 'kysely';

const now = sql`now()`;
const uuid = sql`gen_random_uuid()`;

export const oauth2_0001_init: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable('auth_users')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('email', 'text', (c) => c.notNull())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('password_hash', 'text')
      .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addCheckConstraint('auth_users_status_ck', sql`status in ('active', 'disabled')`)
      .execute();
    await sql`create unique index auth_users_email_lower_uq on auth_users (lower(email))`.execute(db);

    await db.schema
      .createTable('auth_roles')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('key', 'text', (c) => c.notNull().unique())
      .addColumn('name', 'text', (c) => c.notNull())
      .execute();

    await db.schema
      .createTable('auth_user_roles')
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('auth_users.id').onDelete('cascade'))
      .addColumn('role_id', 'uuid', (c) => c.notNull().references('auth_roles.id').onDelete('restrict'))
      .addPrimaryKeyConstraint('auth_user_roles_pk', ['user_id', 'role_id'])
      .execute();

    await db.schema
      .createTable('auth_user_identities')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('auth_users.id').onDelete('cascade'))
      .addColumn('provider', 'text', (c) => c.notNull())
      .addColumn('subject', 'text', (c) => c.notNull())
      .addColumn('email', 'text')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addUniqueConstraint('auth_user_identities_provider_subject_uq', ['provider', 'subject'])
      .execute();

    await db.schema
      .createTable('auth_oauth_clients')
      .addColumn('client_id', 'text', (c) => c.primaryKey())
      .addColumn('metadata', 'jsonb', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();

    await db.schema
      .createTable('auth_oidc_payloads')
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('id', 'text', (c) => c.notNull())
      .addColumn('payload', 'jsonb', (c) => c.notNull())
      .addColumn('grant_id', 'text')
      .addColumn('uid', 'text')
      .addColumn('user_code', 'text')
      .addColumn('expires_at', 'timestamptz')
      .addColumn('consumed_at', 'timestamptz')
      .addPrimaryKeyConstraint('auth_oidc_payloads_pk', ['kind', 'id'])
      .execute();
    await db.schema.createIndex('auth_oidc_payloads_kind_grant_idx').on('auth_oidc_payloads').columns(['kind', 'grant_id']).execute();
    // revokeByGrantId() filters on grant_id alone (any kind).
    await db.schema.createIndex('auth_oidc_payloads_grant_id_idx').on('auth_oidc_payloads').column('grant_id').execute();
    // Per-user Grant/Session lookups of the GrantRevoker.
    await sql`create index auth_oidc_payloads_kind_account_idx on auth_oidc_payloads (kind, (payload->>'accountId'))`.execute(db);
    await db.schema.createIndex('auth_oidc_payloads_kind_uid_idx').on('auth_oidc_payloads').columns(['kind', 'uid']).execute();
    await db.schema.createIndex('auth_oidc_payloads_expires_idx').on('auth_oidc_payloads').column('expires_at').execute();

    await db.schema
      .createTable('auth_sessions')
      .addColumn('id_hash', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('auth_users.id').onDelete('cascade'))
      .addColumn('access_token_enc', 'text')
      .addColumn('refresh_token_enc', 'text')
      .addColumn('id_token_enc', 'text')
      .addColumn('access_expires_at', 'timestamptz')
      .addColumn('idle_expires_at', 'timestamptz', (c) => c.notNull())
      .addColumn('absolute_expires_at', 'timestamptz', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('ip', 'text')
      .addColumn('user_agent', 'text')
      // Refresh lease (R18): set while one request/instance refreshes the session's tokens.
      .addColumn('refresh_lease_until', 'timestamptz')
      .execute();
    await db.schema.createIndex('auth_sessions_user_idx').on('auth_sessions').column('user_id').execute();

    await db.schema
      .createTable('auth_signing_keys')
      .addColumn('kid', 'text', (c) => c.primaryKey())
      .addColumn('jwk_private_enc', 'text', (c) => c.notNull())
      .addColumn('alg', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('retired_at', 'timestamptz')
      .execute();

    await db.schema
      .createTable('auth_audit_events')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('type', 'text', (c) => c.notNull())
      .addColumn('user_id', 'uuid')
      .addColumn('actor_id', 'uuid')
      .addColumn('ip', 'text')
      .addColumn('user_agent', 'text')
      .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
      .execute();
    await db.schema.createIndex('auth_audit_events_at_idx').on('auth_audit_events').column('at').execute();
    await db.schema.createIndex('auth_audit_events_user_at_idx').on('auth_audit_events').columns(['user_id', 'at']).execute();

    await sql`insert into auth_roles (key, name) values ('super_admin', 'Super Admin')`.execute(db);
  },

  async down(db: Kysely<any>) {
    for (const t of [
      'auth_audit_events',
      'auth_signing_keys',
      'auth_sessions',
      'auth_oidc_payloads',
      'auth_oauth_clients',
      'auth_user_identities',
      'auth_user_roles',
      'auth_roles',
      'auth_users',
    ]) {
      await db.schema.dropTable(t).execute();
    }
  },
};
