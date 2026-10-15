import type { Migration } from 'kysely';
import { oauth2_0001_init } from './oauth2_0001_init';

export const oauth2CoreMigrations: Record<string, Migration> = {
  oauth2_0001_init,
};
