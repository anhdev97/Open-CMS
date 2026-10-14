export * from './constants';
export * from './errors';
export * from './config/schema';
export * from './settings/settings.provider';
export * from './db/types';
export { oauth2CoreMigrations } from './db/migrations';

import { registerCoreMigrations } from '@opencms/db';
import { oauth2CoreMigrations } from './db/migrations';

registerCoreMigrations(oauth2CoreMigrations);
