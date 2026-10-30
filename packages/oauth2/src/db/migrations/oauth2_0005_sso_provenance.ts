import { sql, type Kysely, type Migration } from 'kysely';

/** Force reauthentication of legacy sessions: their authentication origin is unknown. */
export const oauth2_0005_sso_provenance: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.createTable('auth_sso_auth_contexts')
      .addColumn('challenge_hash', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('auth_users.id').onDelete('cascade'))
      .addColumn('auth_method', 'text', (c) => c.notNull())
      .addColumn('provider_code', 'text')
      .addColumn('subject_hash', 'text')
      .addColumn('provider_version_id', 'uuid')
      .addColumn('bound_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
      .addCheckConstraint('auth_sso_context_method_ck',
        sql`(auth_method = 'local' and provider_code is null and subject_hash is null and provider_version_id is null)
          or (auth_method = 'oidc' and provider_code is not null and subject_hash is not null and provider_version_id is not null)`)
      .execute();
    await db.schema.createIndex('auth_sso_context_expires_idx')
      .on('auth_sso_auth_contexts').column('expires_at').execute();

    await db.schema.alterTable('auth_sessions')
      .addColumn('auth_method', 'text', (c) => c.notNull().defaultTo('unknown'))
      .addColumn('origin_provider_code', 'text')
      .addColumn('origin_subject_hash', 'text')
      .addColumn('origin_provider_version_id', 'uuid')
      .addColumn('step_up_verified_at', 'timestamptz')
      .execute();
    await sql`alter table auth_sessions add constraint auth_sessions_method_ck check (
      auth_method = 'unknown' or
      (auth_method = 'local' and origin_provider_code is null and origin_subject_hash is null) or
      (auth_method = 'oidc' and origin_provider_code is not null and origin_subject_hash is not null and origin_provider_version_id is not null)
    )`.execute(db);
    await db.schema.createIndex('auth_sessions_external_identity_idx')
      .on('auth_sessions').columns(['origin_provider_code', 'origin_subject_hash']).execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.dropIndex('auth_sessions_external_identity_idx').execute();
    await sql`alter table auth_sessions drop constraint if exists auth_sessions_method_ck`.execute(db);
    for (const column of ['step_up_verified_at', 'origin_provider_version_id', 'origin_subject_hash', 'origin_provider_code', 'auth_method']) {
      await db.schema.alterTable('auth_sessions').dropColumn(column).execute();
    }
    await db.schema.dropTable('auth_sso_auth_contexts').execute();
  },
};
