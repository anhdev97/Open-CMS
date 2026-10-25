import * as path from 'node:path';
import { validateLocaleSettings } from './locales';
import type { OpenCloudCmsConfig, ResolvedConfig } from './types';

export const CONFIG_FILE_NAMES = ['opencloudcms.config.ts', 'opencloudcms.config.js'];

export function resolveConfig(config: OpenCloudCmsConfig, root: string): ResolvedConfig {
  const defaultLocale = config.defaultLocale ?? 'en-US';
  const locales = config.locales ?? [defaultLocale];
  const issues = validateLocaleSettings({ defaultLocale, locales });
  if (issues.length) throw new Error(`Invalid locale configuration:\n  - ${issues.join('\n  - ')}`);
  return {
    root,
    database: config.database,
    contentTypesDir: path.resolve(root, config.contentTypesDir ?? 'src/content-types'),
    generatedDir: path.resolve(root, config.generatedDir ?? 'src/generated'),
    migrationsDir: path.resolve(root, config.migrationsDir ?? 'migrations'),
    defaultLocale,
    locales,
  };
}
