// Side-effect only, Nest-free: makes `coreMigrator()` (e.g. in the `opencms` CLI) aware of the oauth2 tables.
import { registerCoreMigrations } from '@opencloudcms/db';
import { oauth2CoreMigrations } from './db/migrations';

registerCoreMigrations(oauth2CoreMigrations);
