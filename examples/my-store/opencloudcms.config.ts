import { defineConfig } from '@opencloudcms/schema';
import locales from './src/locales';

export default defineConfig({
  database: { url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/mystore' },
  // Website languages live in src/locales.ts (managed from the admin: Settings > Languages).
  ...locales,
  // contentTypesDir: 'src/content-types',
  // generatedDir: 'src/generated',
  // migrationsDir: 'migrations',
});
