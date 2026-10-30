import type { Migration } from 'kysely';
import { oauth2_0001_init } from './oauth2_0001_init';
import { oauth2_0002_user_locale } from './oauth2_0002_user_locale';
import { oauth2_0003_groups } from './oauth2_0003_groups';
import { oauth2_0004_dynamic_sso } from './oauth2_0004_dynamic_sso';
import { oauth2_0005_sso_provenance } from './oauth2_0005_sso_provenance';
import { oauth2_0006_sso_health_counters } from './oauth2_0006_sso_health_counters';

export const oauth2CoreMigrations: Record<string, Migration> = {
  oauth2_0001_init,
  oauth2_0002_user_locale,
  oauth2_0003_groups,
  oauth2_0004_dynamic_sso,
  oauth2_0005_sso_provenance,
  oauth2_0006_sso_health_counters,
};
