import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProjectRoot } from '@opencloudcms/codegen';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectEnv } from '../src/env';

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-env-')));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('loadProjectEnv', () => {
  it('does not override variables that are already set', () => {
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=a\n');
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'b' };
    loadProjectEnv(root, env);
    expect(env.DATABASE_URL).toBe('b');
  });

  it('sets keys that are missing', () => {
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=a\n# comment\nPORT="4100"\n');
    const env: NodeJS.ProcessEnv = {};
    loadProjectEnv(root, env);
    expect(env).toEqual({ DATABASE_URL: 'a', PORT: '4100' });
  });

  it('does nothing without a .env file', () => {
    const env: NodeJS.ProcessEnv = {};
    loadProjectEnv(root, env);
    expect(env).toEqual({});
  });

  it('finds the root .env when the root is located from a sub-directory', () => {
    fs.writeFileSync(path.join(root, 'opencloudcms.config.ts'), 'export default {};\n');
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=from-root\n');
    const sub = path.join(root, 'src', 'content-types');
    fs.mkdirSync(sub, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    loadProjectEnv(findProjectRoot(sub), env);
    expect(env.DATABASE_URL).toBe('from-root');
  });
});
