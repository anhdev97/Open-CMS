export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export function packageJson(name: string, deps: Record<string, string>, devDeps: Record<string, string>): string {
  const sort = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return (
    JSON.stringify(
      {
        name,
        private: true,
        version: '0.1.0',
        scripts: {
          dev: 'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "tsx src/main.ts" "next dev -p 3000"',
          build: 'tsc -p tsconfig.json && next build',
          start:
            'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "node dist/src/main.js" "next start -p 3000"',
          opencms: 'opencms',
        },
        dependencies: sort(deps),
        devDependencies: sort(devDeps),
      },
      null,
      2,
    ) + '\n'
  );
}

export const tsconfigJson = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'node',
        lib: ['ES2022'],
        strict: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: 'dist',
        rootDir: '.',
      },
      include: ['src', 'opencms.config.ts'],
    },
    null,
    2,
  ) + '\n';

export const nextConfigTs = (): string => `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
};

export default nextConfig;
`;

export const tsconfigNextJson = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'ES2022'],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    },
    null,
    2,
  ) + '\n';

export const nextEnvDts = (): string => `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;

export const appLayoutTsx = (title: string): string => `import type { ReactNode } from 'react';

export const metadata = {
  title: ${JSON.stringify(title)},
  description: 'OpenCMS storefront',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

export const appPageTsx = (name: string): string => `export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: '40rem', padding: '0 1rem' }}>
      <h1>${name}</h1>
      <p>
        This is the storefront (Next.js App Router), served at <code>/</code> through the Nest reverse-proxy.
      </p>
      <p>
        Open the admin at <a href="/admin">/admin</a>. Use <code>app/lib/cms.ts</code> when you want to load
        published entries from <code>/api/content/&lt;apiId&gt;</code>.
      </p>
      <p>
        Run <code>pnpm dev</code> to start the CMS and storefront.
      </p>
    </main>
  );
}
`;

export const appCmsTs = (): string => `/**
 * Same-origin helpers for the public delivery API.
 *
 * Example (Server Component on another route):
 *
 *   import { getEntries } from './lib/cms';
 *   const { data } = await getEntries('product', { limit: 10 });
 *
 * The default homepage does not call this — keep it static until you need CMS content.
 */

export type GetEntriesOptions = {
  locale?: string;
  fallback?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Flat filters → \`filter[field]=value\` query params. */
  filter?: Record<string, string>;
  /** Absolute origin when calling from a context without a relative base. Defaults to same-origin. */
  origin?: string;
};

export async function getEntries(apiId: string, opts: GetEntriesOptions = {}) {
  const qs = new URLSearchParams();
  if (opts.locale) qs.set('locale', opts.locale);
  if (opts.fallback) qs.set('fallback', opts.fallback);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  if (opts.filter) {
    for (const [k, v] of Object.entries(opts.filter)) qs.set(\`filter[\${k}]\`, v);
  }
  const q = qs.toString();
  const path = \`/api/content/\${encodeURIComponent(apiId)}\${q ? \`?\${q}\` : ''}\`;
  const url = opts.origin ? new URL(path, opts.origin).toString() : path;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(\`getEntries(\${apiId}) failed: \${res.status} \${await res.text()}\`);
  }
  return res.json() as Promise<{ data: unknown[]; meta: { total: number; limit: number; offset: number } }>;
}
`;

export const configTs = (): string => `import { defineConfig } from '@opencms/schema';

export default defineConfig({
  database: { url: process.env.DATABASE_URL! },
  defaultLocale: 'en',
  locales: ['en'],
});
`;

/** Project root = nearest directory (walking up from `from`) with a package.json; works from src/ and dist/src/. */
export const FIND_ROOT_SNIPPET = `function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}`;

export const mainTs = (): string => `import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';

${FIND_ROOT_SNIPPET}

async function bootstrap() {
  // Load .env before the app (and opencms.config.ts) is evaluated; variables already set win.
  const envFile = path.join(findProjectRoot(__dirname), '.env');
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      console.warn(\`Could not load \${envFile}: \${(e as Error).message}\`);
    }
  }
  const { AppModule } = await import('./app.module');
  // bodyParser: false — @opencms/core owns request body parsing.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  const publicUrl = process.env.OPENCMS_PUBLIC_URL ?? \`http://localhost:\${port}\`;
  console.log(\`OpenCMS ready at \${publicUrl}/admin\`);
}
bootstrap();
`;

export const appModuleTs = (): string => `import * as fs from 'node:fs';
import * as path from 'node:path';
import { Module } from '@nestjs/common';
import { OpenCmsModule } from '@opencms/core';
import config from '../opencms.config';
import { contentTypes } from './generated';
import { hooks } from './extensions';

${FIND_ROOT_SNIPPET}

@Module({
  imports: [
    OpenCmsModule.forRoot({
      root: findProjectRoot(__dirname),
      config,
      contentTypes,
      hooks,
      // Content Type Builder writes schema files + migrations: dev only.
      schemaEditable: process.env.NODE_ENV !== 'production',
      storefront: {
        enabled: true,
        port: 3000,
      },
    }),
  ],
})
export class AppModule {}
`;

export const extensionsTs = (): string => 'export const hooks = [];\n';

export function envFile(opts: { dbUrl: string; port: number; secret: string }): string {
  return `DATABASE_URL=${opts.dbUrl}
PORT=${opts.port}
OPENCMS_SECRET=${opts.secret}
# OPENCMS_PUBLIC_URL=https://cms.example.com  (required when NODE_ENV=production)
# OPENCMS_ADMIN_EMAIL=
# OPENCMS_ADMIN_PASSWORD=  (create the admin without the setup wizard)
# OPENCMS_STOREFRONT_ENABLED=true
# OPENCMS_STOREFRONT_URL=http://127.0.0.1:3000
# OPENCMS_STOREFRONT_PORT=3000
`;
}

export const gitignore = (): string => 'node_modules\ndist\n.next\n.env\n*.log\n';

export function dockerCompose(dbName: string): string {
  return `services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${dbName}
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;
}

export function readme(name: string, pm: PackageManager, port: number): string {
  return `# ${name}

An OpenCMS project.

## Run it

\`\`\`sh
docker compose up -d     # Postgres 16 (skip if you already have a database; edit DATABASE_URL in .env)
${pm} run dev            # applies migrations, then starts the server
\`\`\`

Open http://localhost:${port}/admin and create the first administrator.

The storefront is available at http://localhost:${port}/ through the Nest reverse-proxy. If HMR through the proxy is flaky while developing UI, open http://127.0.0.1:3000 directly.

The \`dev\` and \`start\` scripts run Nest and Next together via \`concurrently\`. Nest listens on the public \`PORT\` (default ${port}); Next listens locally on port 3000.

Configuration lives in \`.env\` (see \`.env.example\`). Every \`opencms\` command loads it automatically.

### Storefront configuration

| Variable | Purpose |
| --- | --- |
| \`OPENCMS_STOREFRONT_ENABLED\` | Enable or disable the storefront proxy. |
| \`OPENCMS_STOREFRONT_URL\` | Override the Next storefront origin. |
| \`OPENCMS_STOREFRONT_PORT\` | Override the local Next storefront port. |

## Deploy

1. Set \`NODE_ENV=production\`.
2. Set \`OPENCMS_PUBLIC_URL\` to the public URL of the site (required in production, the server refuses to start without it).
3. Set \`OPENCMS_SECRET\` (random, at least 32 bytes) and \`DATABASE_URL\`.
4. Install with dev dependencies (do not use \`--omit=dev\` / \`--prod\`): \`start\` runs \`opencms migrate:up\`, and \`opencms-cli\` and \`typescript\` are dev dependencies.
5. \`${pm} run build\`, then \`${pm} run start\` (applies migrations, then starts Nest and Next).

## Security notes

- Keep \`.env\` out of version control (it is in \`.gitignore\`) and never reuse \`OPENCMS_SECRET\` between environments.
- While no user exists, whoever opens \`/admin/setup\` first becomes the super admin (the server logs a WARN at every boot). In production, create the admin from the environment instead (\`OPENCMS_ADMIN_EMAIL\` / \`OPENCMS_ADMIN_PASSWORD\`).
- The rate limiter is in-memory: it is only correct with a single instance.
- Run behind HTTPS in production; the session cookie is only marked secure when \`OPENCMS_PUBLIC_URL\` is https.
- \`OPENCMS_ADMIN_EMAIL\` / \`OPENCMS_ADMIN_PASSWORD\` create an administrator at start-up. Remove them from the environment once the account exists.
- The Content Type Builder writes schema files and migrations, so it is disabled when \`NODE_ENV=production\`.
`;
}
