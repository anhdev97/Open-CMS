import { randomBytes } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  emptySnapshot,
  generateCode,
  printContentGroupsFile,
  printLocalesFile,
  writeGeneratedFiles,
  writeSnapshot,
} from '@opencloudcms/codegen';
import { dbNameFor, packageNameFor } from './names';
import * as t from './templates';

export type { PackageManager } from './templates';

export interface InitOptions {
  pm?: t.PackageManager;
  install?: boolean;
  dbUrl?: string;
  port?: number;
  /** Path of an OpenCloudCMS monorepo checkout: internal packages are linked instead of installed. */
  link?: string;
  cliVersion: string;
  userAgent?: string;
  spawn?: (cmd: string, args: string[], cwd: string) => Promise<number>;
}

export interface InitResult {
  files: string[];
  installed: boolean;
  pm: t.PackageManager;
  port: number;
}

/** Version ranges of the framework dependencies (same as examples/my-store). */
const RANGES = {
  '@nestjs/common': '^11.0.0',
  '@nestjs/core': '^11.0.0',
  '@nestjs/platform-express': '^11.0.0',
  'reflect-metadata': '^0.2.2',
  rxjs: '^7.8.0',
  kysely: '^0.28.0',
  next: '^16.4.2',
  react: '^19.3.1',
  'react-dom': '^19.3.1',
} as const;
const DEV_RANGES = {
  '@tailwindcss/postcss': '^4.3.3',
  '@types/node': '^22.0.0',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  postcss: '^8.5.30',
  tailwindcss: '^4.3.3',
  tsx: '^4.19.0',
  typescript: '^5.6.0',
} as const;

/** Packages the app must share with the linked core (two copies of Nest break DI). */
const SHARED_WITH_CORE = Object.keys(RANGES);

export function detectPm(userAgent?: string): t.PackageManager | undefined {
  const m = /^(pnpm|yarn|npm)\//.exec(userAgent ?? '');
  return m ? (m[1] as t.PackageManager) : undefined;
}

/** Real path of the package root (undefined when `repo` has no packages/core) that `@opencloudcms/core` (at `<repo>/packages/core`) resolves `name` to. */
export function resolveFromCore(repo: string, name: string): string | undefined {
  const coreDir = path.join(repo, 'packages', 'core');
  if (!fs.existsSync(coreDir)) return undefined;
  const direct = path.join(coreDir, 'node_modules', name);
  if (fs.existsSync(direct)) return fs.realpathSync(direct);
  // Not directly under core's node_modules: resolve like core would, then walk up to the package root.
  const entry = require.resolve(name, { paths: [coreDir] });
  let dir = path.dirname(fs.realpathSync(entry));
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === name) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot locate package ${name} from ${coreDir}`);
    dir = parent;
  }
}

/** Nearest directory that contains both absolute paths (compared by path segments). */
export function commonAncestor(a: string, b: string): string {
  const pa = path.resolve(a).split(path.sep);
  const pb = path.resolve(b).split(path.sep);
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
  const common = pa.slice(0, i).join(path.sep);
  return common === '' ? path.sep : common;
}

function defaultSpawn(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export async function runInit(dir: string, opts: InitOptions): Promise<InitResult> {
  const target = path.resolve(dir);
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) throw new Error(`${dir} exists and is not a directory`);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) throw new Error(`Directory ${dir} is not empty`);

  const pm = opts.pm ?? detectPm(opts.userAgent) ?? 'pnpm';
  const port = opts.port ?? 4000;
  const dbName = dbNameFor(target);
  const dbUrl = opts.dbUrl ?? `postgres://postgres:postgres@localhost:5432/${dbName}`;
  const name = packageNameFor(target);

  let deps: Record<string, string>;
  let devDeps: Record<string, string>;
  let linkRoot: string | undefined;
  if (opts.link) {
    const repo = path.resolve(opts.link);
    const link = (p: string) => `link:${p}`;
    deps = {
      'cross-env': '^10.1.0',
      '@opencloudcms/core': link(`${repo}/packages/core`),
      '@opencloudcms/schema': link(`${repo}/packages/schema`),
      // Share core's own copy of each, otherwise two Nest instances break DI. Not a checkout: plain ranges.
      ...Object.fromEntries(
        SHARED_WITH_CORE.map((n) => {
          const real = resolveFromCore(repo, n);
          return [n, real ? link(real) : RANGES[n as keyof typeof RANGES]];
        }),
      ),
    };
    devDeps = { '@opencloudcms/cli': link(`${repo}/packages/cli`), ...DEV_RANGES };
    linkRoot = commonAncestor(target, repo);
  } else {
    const v = `^${opts.cliVersion}`;
    deps = { '@opencloudcms/core': v, '@opencloudcms/schema': v, ...RANGES, 'cross-env': '^10.1.0' };
    devDeps = { '@opencloudcms/cli': v, ...DEV_RANGES };
  }

  const files = new Map<string, string>([
    ['package.json', t.packageJson(name, deps, devDeps)],
    ['tsconfig.json', t.tsconfigNextJson()],
    ['tsconfig.server.json', t.tsconfigServerJson()],
    ['next.config.ts', t.nextConfigTs(linkRoot ? { root: linkRoot } : undefined)],
    ['next-env.d.ts', t.nextEnvDts()],
    ['postcss.config.mjs', t.postcssConfig()],
    ['app/globals.css', t.globalsCss()],
    ['app/(admin)/layout.tsx', t.adminLayoutTsx()],
    ['app/(admin)/admin/[[...slug]]/page.tsx', t.adminPageTsx()],
    ['app/(site)/layout.tsx', t.siteLayoutTsx(name)],
    ['app/(site)/messages.ts', t.siteMessagesTs()],
    ['app/(site)/page.tsx', t.sitePageTsx(name)],
    ['src/root.ts', t.rootTs()],
    ['opencloudcms.config.ts', t.configTs()],
    ['src/main.ts', t.mainTs()],
    ['src/app.module.ts', t.appModuleTs()],
    ['src/locales.ts', printLocalesFile({ defaultLocale: 'en-US', locales: ['en-US'] })],
    ['src/content-groups.ts', printContentGroupsFile([])],
    ['src/content-types/.gitkeep', ''],
    ['src/extensions/index.ts', t.extensionsTs()],
    ['.env', t.envFile({ dbUrl, port, secret: randomBytes(32).toString('base64url') })],
    ['.env.example', t.envFile({ dbUrl, port, secret: '' })],
    ['.gitignore', t.gitignore()],
    ['docker-compose.yml', t.dockerCompose(dbName)],
    ['README.md', t.readme(name, pm, port)],
  ]);

  fs.mkdirSync(target, { recursive: true });
  const written: string[] = [];
  for (const [rel, content] of files) {
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(rel);
  }
  writeGeneratedFiles(generateCode([], path.join(target, 'src', 'generated')));
  for (const f of fs.readdirSync(path.join(target, 'src', 'generated'))) written.push(path.join('src', 'generated', f));
  writeSnapshot(path.join(target, 'migrations'), emptySnapshot());
  written.push(path.join('migrations', '_snapshot.json'));

  let installed = false;
  if (opts.install !== false) {
    const code = await (opts.spawn ?? defaultSpawn)(pm, ['install'], target);
    if (code !== 0) {
      throw new Error(`\`${pm} install\` failed (exit ${code}). The files were kept: run \`cd ${dir} && ${pm} install\` to retry.`);
    }
    installed = true;
  }
  return { files: written.sort(), installed, pm, port };
}

export function nextSteps(dir: string, r: { pm: t.PackageManager; port: number }): string {
  return ['cd ' + dir, 'docker compose up -d', `${r.pm} run dev`, `→ open http://localhost:${r.port}/admin`].join('\n');
}
