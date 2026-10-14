import * as path from 'node:path';
import type { OpenCmsConfig, ResolvedConfig } from './types';

export const CONFIG_FILE_NAMES = ['opencms.config.ts', 'opencms.config.js'];

export function resolveConfig(config: OpenCmsConfig, root: string): ResolvedConfig {
  return {
    root,
    database: config.database,
    contentTypesDir: path.resolve(root, config.contentTypesDir ?? 'src/content-types'),
    generatedDir: path.resolve(root, config.generatedDir ?? 'src/generated'),
    migrationsDir: path.resolve(root, config.migrationsDir ?? 'migrations'),
    defaultLocale: config.defaultLocale ?? 'en',
    locales: config.locales ?? [config.defaultLocale ?? 'en'],
  };
}
