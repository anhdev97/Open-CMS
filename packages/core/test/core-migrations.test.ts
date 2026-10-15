import 'reflect-metadata';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * I2: the `opencms` CLI registers oauth2_0001_init, so every process that runs the core stream (the app's
 * autoMigrate, the Content Type Builder's apply) must know it too, or Kysely reports a missing migration.
 * Loading @opencms/core alone has to be enough.
 *
 * `@opencms/db` is required natively (as core's dependencies load it at runtime): vitest would otherwise
 * give the test its own transformed copy with a separate registry.
 */
const { allCoreMigrations } = createRequire(__filename)('@opencms/db') as typeof import('@opencms/db');

describe('@opencms/core registers the oauth2 core migration', () => {
  it('importing the core entry point makes allCoreMigrations() include oauth2_0001_init', async () => {
    expect(Object.keys(allCoreMigrations())).not.toContain('oauth2_0001_init');
    await import('../src/index');
    expect(Object.keys(allCoreMigrations())).toContain('oauth2_0001_init');
  });
});
