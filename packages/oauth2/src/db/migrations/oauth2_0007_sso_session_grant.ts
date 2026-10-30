import { type Kysely, type Migration } from 'kysely';

/**
 * A BFF session owns an internal authorization-server grant. Retain the
 * non-secret grant id so targeted SSO identity blocking can revoke tokens
 * without revoking another identity's or local session's grant.
 */
export const oauth2_0007_sso_session_grant: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable('auth_sessions')
      .addColumn('origin_grant_id', 'text')
      .execute();
    await db.schema.createIndex('auth_sessions_origin_grant_idx')
      .on('auth_sessions').column('origin_grant_id').execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.dropIndex('auth_sessions_origin_grant_idx').execute();
    await db.schema.alterTable('auth_sessions').dropColumn('origin_grant_id').execute();
  },
};
