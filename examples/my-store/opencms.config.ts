import { defineConfig } from '@opencms/schema';

export default defineConfig({
  database: { url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/mystore' },
  defaultLocale: 'en',
  locales: ['en', 'vi-VN', 'id-ID'],
  // contentTypesDir: 'src/content-types',
  // generatedDir: 'src/generated',
  // migrationsDir: 'migrations',
});
