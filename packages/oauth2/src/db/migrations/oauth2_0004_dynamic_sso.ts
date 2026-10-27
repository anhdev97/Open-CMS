import { sql, type Kysely, type Migration } from 'kysely';

const now = sql`now()`;
const uuid = sql`gen_random_uuid()`;

/**
 * Additive persistence for dynamic OIDC SSO. Existing identities and sessions
 * are deliberately untouched; provenance columns are added by a later migration.
 */
export const oauth2_0004_dynamic_sso: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable('auth_identity_providers')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('code', 'text', (c) => c.notNull().unique())
      .addColumn('display_name', 'text', (c) => c.notNull())
      .addColumn('description', 'text')
      .addColumn('lifecycle_status', 'text', (c) => c.notNull().defaultTo('DRAFT'))
      .addColumn('active_version_id', 'uuid')
      .addColumn('draft_version_id', 'uuid')
      .addColumn('display_order', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('created_by', 'uuid')
      .addColumn('updated_by', 'uuid')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('archived_at', 'timestamptz')
      .addCheckConstraint('auth_idp_lifecycle_ck', sql`lifecycle_status in ('DRAFT','ACTIVE','DISABLED','ARCHIVED')`)
      .addCheckConstraint('auth_idp_code_ck', sql`code ~ '^[a-z][a-z0-9_-]{0,63}$'`)
      .execute();

    await db.schema
      .createTable('auth_identity_provider_versions')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('provider_id', 'uuid', (c) => c.notNull().references('auth_identity_providers.id').onDelete('restrict'))
      .addColumn('version_no', 'integer', (c) => c.notNull())
      .addColumn('state', 'text', (c) => c.notNull().defaultTo('DRAFT'))
      .addColumn('config_public', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
      .addColumn('client_secret_enc', 'text')
      .addColumn('config_fingerprint', 'text', (c) => c.notNull())
      .addColumn('tested_fingerprint', 'text')
      .addColumn('tested_at', 'timestamptz')
      .addColumn('published_at', 'timestamptz')
      .addColumn('source_version_id', 'uuid', (c) => c.references('auth_identity_provider_versions.id').onDelete('set null'))
      .addColumn('created_by', 'uuid')
      .addColumn('published_by', 'uuid')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addUniqueConstraint('auth_idp_versions_provider_no_uq', ['provider_id', 'version_no'])
      .addUniqueConstraint('auth_idp_versions_provider_id_uq', ['provider_id', 'id'])
      .addCheckConstraint('auth_idp_versions_state_ck', sql`state in ('DRAFT','TESTED','PUBLISHED','SUPERSEDED')`)
      .addCheckConstraint('auth_idp_versions_no_ck', sql`version_no > 0`)
      .execute();

    // Composite FKs prevent an active/draft pointer from referencing another provider.
    await sql`alter table auth_identity_providers
      add constraint auth_idp_active_version_fk foreign key (id, active_version_id)
      references auth_identity_provider_versions(provider_id, id) deferrable initially immediate`.execute(db);
    await sql`alter table auth_identity_providers
      add constraint auth_idp_draft_version_fk foreign key (id, draft_version_id)
      references auth_identity_provider_versions(provider_id, id) deferrable initially immediate`.execute(db);
    await db.schema.createIndex('auth_idp_display_order_idx').on('auth_identity_providers').columns(['display_order', 'code']).execute();

    await db.schema
      .createTable('auth_login_policy')
      .addColumn('id', 'integer', (c) => c.primaryKey())
      .addColumn('sso_login_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
      .addColumn('revision', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('updated_by', 'uuid')
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addCheckConstraint('auth_login_policy_singleton_ck', sql`id = 1`)
      .execute();
    await sql`insert into auth_login_policy (id, sso_login_enabled) values (1, false)`.execute(db);

    await db.schema
      .createTable('auth_identity_blocks')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('provider_code', 'text', (c) => c.notNull().references('auth_identity_providers.code').onDelete('restrict'))
      .addColumn('subject_hash', 'text', (c) => c.notNull())
      .addColumn('reason', 'text', (c) => c.notNull())
      .addColumn('blocked_by', 'uuid')
      .addColumn('blocked_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .addColumn('unblocked_by', 'uuid')
      .addColumn('unblocked_at', 'timestamptz')
      .execute();
    await sql`create unique index auth_identity_blocks_active_uq
      on auth_identity_blocks (provider_code, subject_hash) where unblocked_at is null`.execute(db);

    await db.schema
      .createTable('auth_identity_provider_health')
      .addColumn('provider_id', 'uuid', (c) => c.primaryKey().references('auth_identity_providers.id').onDelete('cascade'))
      .addColumn('health_status', 'text', (c) => c.notNull().defaultTo('UNKNOWN'))
      .addColumn('active_version_id', 'uuid')
      .addColumn('checked_at', 'timestamptz')
      .addColumn('last_success_at', 'timestamptz')
      .addColumn('last_failure_at', 'timestamptz')
      .addColumn('consecutive_failures', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('failure_code', 'text')
      .addCheckConstraint('auth_idp_health_status_ck', sql`health_status in ('UNKNOWN','HEALTHY','DEGRADED','UNAVAILABLE')`)
      .addCheckConstraint('auth_idp_health_failures_ck', sql`consecutive_failures >= 0`)
      .execute();
    await db.schema
      .createTable('auth_identity_provider_health_events')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(uuid))
      .addColumn('provider_id', 'uuid', (c) => c.notNull().references('auth_identity_providers.id').onDelete('cascade'))
      .addColumn('version_id', 'uuid')
      .addColumn('category', 'text', (c) => c.notNull())
      .addColumn('failure_code', 'text')
      .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();
    await db.schema.createIndex('auth_idp_health_events_provider_at_idx').on('auth_identity_provider_health_events').columns(['provider_id', 'at']).execute();

    await db.schema
      .createTable('auth_sso_migration_markers')
      .addColumn('key', 'text', (c) => c.primaryKey())
      .addColumn('fingerprint', 'text')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();
  },

  async down(db: Kysely<any>) {
    for (const name of [
      'auth_sso_migration_markers',
      'auth_identity_provider_health_events',
      'auth_identity_provider_health',
      'auth_identity_blocks',
      'auth_login_policy',
    ]) await db.schema.dropTable(name).execute();
    await sql`alter table auth_identity_providers drop constraint auth_idp_active_version_fk`.execute(db);
    await sql`alter table auth_identity_providers drop constraint auth_idp_draft_version_fk`.execute(db);
    await db.schema.dropTable('auth_identity_provider_versions').execute();
    await db.schema.dropTable('auth_identity_providers').execute();
  },
};
