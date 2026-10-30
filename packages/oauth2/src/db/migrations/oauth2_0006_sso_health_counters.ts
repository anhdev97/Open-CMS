import { type Kysely, type Migration } from 'kysely';

/** Separate health streaks so two successful probes are needed after degradation. */
export const oauth2_0006_sso_health_counters: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable('auth_identity_provider_health')
      .addColumn('consecutive_successes', 'integer', (c) => c.notNull().defaultTo(0))
      .execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.alterTable('auth_identity_provider_health')
      .dropColumn('consecutive_successes').execute();
  },
};
