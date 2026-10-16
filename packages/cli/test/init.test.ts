import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { runInit } from '../src/init';
import { FIND_ROOT_SNIPPET } from '../src/init/templates';
import { dbNameFor, packageNameFor } from '../src/init/names';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencms-init-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const base = { cliVersion: '0.1.0', install: false };
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
const envOf = (dir: string, f = '.env') =>
  Object.fromEntries(
    read(dir, f)
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

describe('names', () => {
  it('packageNameFor', () => {
    expect(packageNameFor('/x/My Shop')).toBe('my-shop');
    expect(packageNameFor('/x/shop-2026')).toBe('shop-2026');
    expect(packageNameFor('/x/@@@')).toBe('opencms-project');
    expect(packageNameFor('/x/.hidden_app')).toBe('hidden_app');
    expect(packageNameFor('/x/_x')).toBe('x');
  });
  it('dbNameFor', () => {
    expect(dbNameFor('/x/My Shop')).toBe('my_shop');
    expect(dbNameFor('/x/2026shop')).toBe('db_2026shop');
    expect(dbNameFor('/x/---')).toBe('opencms');
    expect(dbNameFor('/x/' + 'a'.repeat(80))).toHaveLength(63);
  });
});

describe('runInit', () => {
  it('writes exactly the files of the spec', async () => {
    const dir = path.join(tmp, 'My Shop');
    const r = await runInit(dir, base);
    expect(r.installed).toBe(false);
    const all: string[] = [];
    const walk = (d: string) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : all.push(path.relative(dir, path.join(d, e.name)))));
    walk(dir);
    const expected = [
      '.env',
      '.env.example',
      '.gitignore',
      'README.md',
      'app/layout.tsx',
      'app/lib/cms.ts',
      'app/page.tsx',
      'docker-compose.yml',
      'migrations/_snapshot.json',
      'next-env.d.ts',
      'next.config.ts',
      'opencms.config.ts',
      'package.json',
      'src/app.module.ts',
      'src/content-types/.gitkeep',
      'src/extensions/index.ts',
      'src/generated/index.ts',
      'src/generated/registry.ts',
      'src/generated/tables.ts',
      'src/generated/types.ts',
      'src/generated/validators.ts',
      'src/main.ts',
      'tsconfig.json',
      'tsconfig.next.json',
    ];
    expect(all.sort()).toEqual(expected);
    expect(r.files).toEqual(expected);
  });

  it('names the package and database from the directory', async () => {
    const a = path.join(tmp, 'My Shop');
    await runInit(a, base);
    expect(JSON.parse(read(a, 'package.json')).name).toBe('my-shop');
    expect(envOf(a).DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/my_shop');
    expect(read(a, 'docker-compose.yml')).toContain('POSTGRES_DB: my_shop');
    const b = path.join(tmp, 'shop-2026');
    await runInit(b, base);
    expect(JSON.parse(read(b, 'package.json')).name).toBe('shop-2026');
    const c = path.join(tmp, '2026shop');
    await runInit(c, base);
    expect(envOf(c).DATABASE_URL).toMatch(/\/db_2026shop$/);
  });

  it('honours --db-url and --port', async () => {
    const dir = path.join(tmp, 'p');
    await runInit(dir, { ...base, dbUrl: 'postgres://u:p@h/d', port: 4100 });
    expect(envOf(dir)).toMatchObject({ DATABASE_URL: 'postgres://u:p@h/d', PORT: '4100' });
  });

  it('generates a random 32-byte secret, and leaves .env.example empty', async () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    await runInit(a, base);
    await runInit(b, base);
    const sa = envOf(a).OPENCMS_SECRET;
    expect(Buffer.from(sa, 'base64url')).toHaveLength(32);
    expect(sa).not.toBe(envOf(b).OPENCMS_SECRET);
    expect(envOf(a, '.env.example').OPENCMS_SECRET).toBe('');
    expect(read(a, '.gitignore')).toContain('.env');
  });

  it('uses semver ranges without --link', async () => {
    const dir = path.join(tmp, 'a');
    await runInit(dir, { ...base, cliVersion: '1.2.3' });
    const pkg = JSON.parse(read(dir, 'package.json'));
    expect(pkg.dependencies['@opencms/core']).toBe('^1.2.3');
    expect(pkg.dependencies['@nestjs/core']).toBe('^11.0.0');
    expect(pkg.devDependencies['opencms-cli']).toBe('^1.2.3');
    expect(pkg.devDependencies['@types/node']).toBe('^22.0.0');
    expect(read(dir, 'README.md')).toContain('Install with dev dependencies');
    expect(pkg.scripts).toEqual({
      dev: 'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "tsx src/main.ts" "next dev -p 3000"',
      build: 'tsc -p tsconfig.json && next build',
      start: 'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "node dist/src/main.js" "next start -p 3000"',
      opencms: 'opencms',
    });
    expect(pkg.dependencies.next).toBe('^15.5.0');
    expect(pkg.dependencies.react).toBe('^19.0.0');
    expect(pkg.dependencies['react-dom']).toBe('^19.0.0');
    expect(pkg.devDependencies.concurrently).toBe('^9.0.0');
  });

  it('scaffolds a hybrid homepage and cms helper without calling the API from page.tsx', async () => {
    const dir = path.join(tmp, 'shop');
    await runInit(dir, base);
    expect(read(dir, 'app/page.tsx')).toContain('/admin');
    expect(read(dir, 'app/page.tsx')).not.toMatch(/getEntries/);
    expect(read(dir, 'app/lib/cms.ts')).toContain('/api/content/');
    expect(read(dir, 'app/lib/cms.ts')).toContain('export async function getEntries');
    expect(JSON.parse(read(dir, 'tsconfig.json')).include).toEqual(['src', 'opencms.config.ts']);
    expect(read(dir, 'next.config.ts')).toContain("tsconfigPath: 'tsconfig.next.json'");
    expect(read(dir, 'src/app.module.ts')).toContain('storefront:');
    expect(read(dir, 'src/app.module.ts')).toContain('enabled: true');
    expect(read(dir, '.gitignore')).toContain('.next');
  });

  it('links internal packages and core-owned dependencies with --link', async () => {
    const repo = path.join(tmp, 'repo');
    const core = path.join(repo, 'packages', 'core', 'node_modules');
    const store = path.join(tmp, 'store');
    for (const n of ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs', 'kysely']) {
      fs.mkdirSync(path.join(store, n), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(core, n)), { recursive: true });
      fs.symlinkSync(path.join(store, n), path.join(core, n));
    }
    const dir = path.join(tmp, 'a');
    await runInit(dir, { ...base, link: repo });
    const pkg = JSON.parse(read(dir, 'package.json'));
    expect(pkg.dependencies['@opencms/core']).toBe(`link:${repo}/packages/core`);
    expect(pkg.dependencies['@opencms/schema']).toBe(`link:${repo}/packages/schema`);
    expect(pkg.devDependencies['opencms-cli']).toBe(`link:${repo}/packages/cli`);
    expect(pkg.devDependencies['@types/node']).toBe('^22.0.0');
    expect(pkg.dependencies['@nestjs/core']).toBe(`link:${fs.realpathSync(path.join(store, '@nestjs/core'))}`);
    expect(pkg.dependencies.rxjs).toBe(`link:${fs.realpathSync(path.join(store, 'rxjs'))}`);
  });

  it('falls back to ranges for core-owned deps when the link path is not a checkout', async () => {
    const dir = path.join(tmp, 'a');
    await runInit(dir, { ...base, link: '/x' });
    const pkg = JSON.parse(read(dir, 'package.json'));
    expect(pkg.dependencies['@opencms/core']).toBe('link:/x/packages/core');
    expect(pkg.dependencies['@nestjs/core']).toBe('^11.0.0');
  });

  it('refuses a non-empty directory and leaves it untouched', async () => {
    const dir = path.join(tmp, 'busy');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
    await expect(runInit(dir, base)).rejects.toThrow(`Directory ${dir} is not empty`);
    expect(fs.readdirSync(dir)).toEqual(['keep.txt']);
  });

  it('accepts an existing empty directory', async () => {
    const dir = path.join(tmp, 'empty');
    fs.mkdirSync(dir);
    await runInit(dir, base);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
  });

  it('picks the package manager from the option, then the user agent, then pnpm', async () => {
    const calls: string[][] = [];
    const spawn = async (cmd: string, args: string[], cwd: string) => (calls.push([cmd, ...args, cwd]), 0);
    const run = (n: string, o: object) => runInit(path.join(tmp, n), { cliVersion: '0.1.0', spawn, ...o });
    expect((await run('a', { userAgent: 'npm/10 node/22' })).pm).toBe('npm');
    expect((await run('b', { userAgent: 'npm/10', pm: 'yarn' })).pm).toBe('yarn');
    expect((await run('c', { userAgent: 'bun/1' })).pm).toBe('pnpm');
    expect(calls[0]).toEqual(['npm', 'install', path.join(tmp, 'a')]);
    expect((await run('d', {})).installed).toBe(true);
  });

  it('keeps the files and throws a rerun hint when install fails', async () => {
    const dir = path.join(tmp, 'a');
    await expect(runInit(dir, { cliVersion: '0.1.0', pm: 'pnpm', spawn: async () => 1 })).rejects.toThrow(/pnpm install/);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
  });

  it('main.ts follows the host wiring', async () => {
    const dir = path.join(tmp, 'a');
    await runInit(dir, base);
    const main = read(dir, 'src/main.ts');
    expect(main).toContain('bodyParser: false');
    expect(main).toContain('process.loadEnvFile');
    expect(main).toContain('enableShutdownHooks');
    expect(main).toContain('process.env.PORT ?? 4000');
    expect(main).toContain('OpenCMS ready at');
    expect(main).not.toContain('enableCors');
  });

  it('refuses a path that is an existing file', async () => {
    const f = path.join(tmp, 'file');
    fs.writeFileSync(f, 'x');
    await expect(runInit(f, base)).rejects.toThrow(/not a directory/);
  });

  it('templates locate the project root from src/ and from dist/src/', async () => {
    const dir = path.join(tmp, 'app');
    await runInit(dir, base);
    for (const f of ['src/main.ts', 'src/app.module.ts']) {
      expect(read(dir, f)).toContain(FIND_ROOT_SNIPPET);
      expect(read(dir, f)).not.toContain("path.resolve(__dirname, '..')");
    }
    const js = ts.transpileModule(`${FIND_ROOT_SNIPPET}\nmodule.exports = findProjectRoot;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const findRoot = new Function('fs', 'path', 'process', 'module', `${js}; return module.exports;`)(fs, path, process, { exports: {} }) as (d: string) => string;
    const real = fs.realpathSync(dir);
    fs.mkdirSync(path.join(dir, 'dist', 'src'), { recursive: true });
    expect(findRoot(path.join(real, 'src'))).toBe(real);
    expect(findRoot(path.join(real, 'dist', 'src'))).toBe(real);
  });
});
