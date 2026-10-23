import type { Kysely, Migration } from 'kysely';

/** Per-user admin UI language (nullable: null = follow the browser / default). */
export const oauth2_0002_user_locale: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable('auth_users').addColumn('locale', 'text').execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.alterTable('auth_users').dropColumn('locale').execute();
  },
};
