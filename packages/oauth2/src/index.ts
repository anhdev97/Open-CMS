export * from './constants';
export * from './errors';
export * from './config/schema';
export * from './settings/settings.provider';
export * from './db/types';
export { oauth2CoreMigrations } from './db/migrations';

import { registerCoreMigrations } from '@opencms/db';
import { oauth2CoreMigrations } from './db/migrations';

registerCoreMigrations(oauth2CoreMigrations);
export * from './guard/public.decorator';
export * from './setup/bootstrap.service';
export * from './setup/setup-state';
export * from './setup/setup.controller';
