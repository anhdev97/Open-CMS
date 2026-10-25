import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('register-migrations', () => {
  it('registers oauth2_0001_init without loading @nestjs/common', async () => {
    const before = Object.keys(createRequire(__filename).cache).filter((k) => k.includes('/@nestjs/'));
    await import('../../src/register-migrations');
    const { allCoreMigrations } = await import('@opencloudcms/db');
    expect(Object.keys(allCoreMigrations())).toContain('oauth2_0001_init');
    const req = createRequire(__filename);
    const after = Object.keys(req.cache).filter((k) => k.includes('/@nestjs/'));
    expect(after.filter((k) => !before.includes(k))).toEqual([]);
  });

  it('source imports nothing from Nest', () => {
    const src = readFileSync(resolve(__dirname, '../../src/register-migrations.ts'), 'utf8');
    expect(src).not.toMatch(/@nestjs/);
  });
});
