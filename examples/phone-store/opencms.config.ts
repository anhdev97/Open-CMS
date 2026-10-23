import { defineConfig } from '@opencms/schema';
import locales from './src/locales';

export default defineConfig({
  database: { url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/phonestore' },
  ...locales,
});
