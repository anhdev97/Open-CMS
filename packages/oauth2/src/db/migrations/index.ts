import type { Migration } from 'kysely';
import { oauth2_0001_init } from './oauth2_0001_init';
import { oauth2_0002_user_locale } from './oauth2_0002_user_locale';

export const oauth2CoreMigrations: Record<string, Migration> = {
  oauth2_0001_init,
  oauth2_0002_user_locale,
};
