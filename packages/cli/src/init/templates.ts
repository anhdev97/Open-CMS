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
          dev: 'opencloudcms migrate:up && tsx --tsconfig tsconfig.server.json src/main.ts',
          build: 'tsc -p tsconfig.server.json && next build',
          start: 'cross-env NODE_ENV=production opencloudcms migrate:up && cross-env NODE_ENV=production node dist/src/main.js',
          opencloudcms: 'opencloudcms',
        },
        dependencies: sort(deps),
        devDependencies: sort(devDeps),
      },
      null,
      2,
    ) + '\n'
  );
}

export const tsconfigServerJson = (): string =>
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
      include: ['src', 'opencloudcms.config.ts'],
    },
    null,
    2,
  ) + '\n';

export const configTs = (): string => `import { defineConfig } from '@opencloudcms/schema';
import locales from './src/locales';

export default defineConfig({
  database: { url: process.env.DATABASE_URL! },
  // Website languages live in src/locales.ts (managed from the admin: Settings > Languages).
  ...locales,
});
`;

export const rootTs = (): string => `import * as fs from 'node:fs';
import * as path from 'node:path';

/** Project root = nearest directory (walking up from \`from\`) with a package.json; works from src/ and dist/src/. */
export function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
`;

export const mainTs = (): string => `import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { findProjectRoot } from './root';

async function bootstrap() {
  // Load .env before the app (and opencloudcms.config.ts) is evaluated; variables already set win.
  const envFile = path.join(findProjectRoot(__dirname), '.env');
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      console.warn(\`Could not load \${envFile}: \${(e as Error).message}\`);
    }
  }
  const { AppModule } = await import('./app.module');
  // bodyParser: false — @opencloudcms/core owns request body parsing.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  const publicUrl = process.env.OPENCLOUDCMS_PUBLIC_URL ?? \`http://localhost:\${port}\`;
  console.log(\`OpenCloudCMS ready at \${publicUrl}\`);
  console.log(\`Admin: \${publicUrl}/admin\`);
}
// Exit on a boot failure: Next installs its own unhandledRejection handler, which would keep the process alive.
bootstrap().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
`;

export const appModuleTs = (): string => `import { Module } from '@nestjs/common';
import { OpenCloudCmsModule } from '@opencloudcms/core';
import config from '../opencloudcms.config';
import contentGroups from './content-groups';
import { contentTypes } from './generated';
import { hooks } from './extensions';
import { findProjectRoot } from './root';

const projectRoot = findProjectRoot(__dirname);

@Module({
  imports: [
    OpenCloudCmsModule.forRoot({
      root: projectRoot,
      config,
      contentTypes,
      // Sidebar groups of the content types (src/content-groups.ts, managed from Settings > Content types).
      contentGroups,
      hooks,
      // Content Type Builder writes schema files + migrations: dev only.
      schemaEditable: process.env.NODE_ENV !== 'production',
      // One Next app (app/) serves the admin at /admin and the website everywhere else.
      // Set \`web: { enabled: false }\` to serve only the API (no admin, no website).
      web: { dir: projectRoot },
    }),
  ],
})
export class AppModule {}
`;

export const adminLayoutTsx = (): string => `import '../globals.css';
import AdminLayout, { metadata as adminMetadata } from '@opencloudcms/core/admin/layout';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;
export default AdminLayout;
`;

export const adminPageTsx = (): string => `export { default } from '@opencloudcms/core/admin';
`;

export const siteLayoutTsx = (name: string): string => `import '../globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import locales from '../../src/locales';

export const metadata: Metadata = {
  title: '${name}',
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={locales.defaultLocale}>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
`;

/** Website strings: en-US is required, other locales may be partial (missing keys fall back to en-US). */
export const siteMessagesTs = (): string => `// Strings of the website. Server components import the helpers from '@opencloudcms/core';
// client components ('use client') must import them from '@opencloudcms/core/admin' instead.
import { defineMessages } from '@opencloudcms/core';

export const messages = defineMessages({
  'en-US': {
    home: {
      tagline: 'A website and its OpenCloudCMS admin, served by one Next.js app.',
      openAdmin: 'Open admin',
    },
  },
  'vi-VN': {
    home: {
      tagline: 'Một website và trang quản trị OpenCloudCMS, chạy trong cùng một ứng dụng Next.js.',
      openAdmin: 'Mở trang quản trị',
    },
  },
});
`;

export const sitePageTsx = (name: string): string => `import { createTranslator } from '@opencloudcms/core';
import locales from '../../src/locales';
import { messages } from './messages';

export default function HomePage() {
  const t = createTranslator(messages, locales.defaultLocale);
  return (
    <main data-opencloudcms-site="" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">${name}</h1>
      <p className="text-muted-foreground">{t('home.tagline')}</p>
      <p>
        <a
          href="/admin"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('home.openAdmin')}
        </a>
      </p>
    </main>
  );
}
`;

export const globalsCss = (): string => `@import "tailwindcss";
@import "@opencloudcms/core/admin/theme.css";
@source "../node_modules/@opencloudcms/core/dist/admin";
`;

/** `link` (set by `--link`): the core is a symlink outside the project; Turbopack and output tracing only follow files under their root. */
export function nextConfigTs(link?: { root: string }): string {
  if (!link) {
    return `import type { NextConfig } from 'next';

// Server components may import the i18n helpers from @opencloudcms/core: under the \`react-server\` condition the
// package resolves to a NestJS-free module. Client components ('use client') import them from @opencloudcms/core/admin.
const nextConfig: NextConfig = {};

export default nextConfig;
`;
  }
  const root = JSON.stringify(link.root);
  return `import type { NextConfig } from 'next';

// @opencloudcms/core is linked from outside this directory (opencloudcms init --link); Turbopack and output tracing
// only follow files under their root, so both point at the common ancestor of the project and the checkout.
// Server components may import the i18n helpers from @opencloudcms/core: under the \`react-server\` condition the
// package resolves to a NestJS-free module. Client components ('use client') import them from @opencloudcms/core/admin.
const nextConfig: NextConfig = {
  turbopack: { root: ${root} },
  outputFileTracingRoot: ${root},
};

export default nextConfig;
`;
}

export const postcssConfig = (): string => `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;

export const nextEnvDts = (): string => `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

export const tsconfigNextJson = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'react-jsx',
        incremental: true,
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', 'app/**/*', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
      exclude: ['node_modules'],
    },
    null,
    2,
  ) + '\n';

export const extensionsTs = (): string => 'export const hooks = [];\n';

export function envFile(opts: { dbUrl: string; port: number; secret: string }): string {
  return `DATABASE_URL=${opts.dbUrl}
PORT=${opts.port}
OPENCLOUDCMS_SECRET=${opts.secret}
# OPENCLOUDCMS_PUBLIC_URL=https://cms.example.com  (required when NODE_ENV=production)
# OPENCLOUDCMS_ADMIN_EMAIL=
# OPENCLOUDCMS_ADMIN_PASSWORD=  (create the admin without the setup wizard)
`;
}

export const gitignore = (): string => 'node_modules\ndist\n.next/\n.env\n*.log\n';

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

An OpenCloudCMS project: a NestJS backend (\`src/\`) and one Next.js app (\`app/\`) that serves the admin at \`/admin\` and your website everywhere else.

## Structure

\`\`\`
src/                  NestJS: main.ts, app.module.ts, content types, hooks, generated code
  locales.ts          website languages (managed from Settings > Languages)
  content-groups.ts   sidebar groups of content types (managed from Settings > Content types)
app/                  Next.js App Router: one app for the admin and the website
  (admin)/            root layout + page of the admin (re-exported from @opencloudcms/core)
  (site)/             root layout, home page and strings (messages.ts) of the website: yours to change
  globals.css         Tailwind v4 + the admin theme
migrations/           SQL migrations (opencloudcms migrate:create / migrate:up)
next.config.ts        Next config
tsconfig.json         for Next; tsconfig.server.json is for the NestJS server
opencloudcms.config.ts database, locales
.env                  configuration (see .env.example)
\`\`\`

## Run it

\`\`\`sh
docker compose up -d     # Postgres 16 (skip if you already have a database; edit DATABASE_URL in .env)
${pm} run dev            # applies migrations, then starts NestJS with Next in dev mode
\`\`\`

Open http://localhost:${port}/admin and create the first administrator. The website is at http://localhost:${port}/.

Configuration lives in \`.env\` (see \`.env.example\`). Every \`opencloudcms\` command loads it automatically.

## Scripts

- \`${pm} run dev\`: applies migrations, then starts the server with Next in dev mode.
- \`${pm} run build\`: compiles the server (\`tsc -p tsconfig.server.json\`) and builds the Next app (\`next build\`).
- \`${pm} run start\`: applies migrations, then starts the production server (\`dist/src/main.js\`) with \`NODE_ENV=production\`.

## Deploy

1. Run \`${pm} run build\` first: without a Next build the server answers \`/admin\` and the website with a 503.
2. Set \`NODE_ENV=production\` (the \`start\` script sets it for you; set it as well when you run \`build\` in CI so the environment matches).
3. Set \`OPENCLOUDCMS_PUBLIC_URL\` to the public URL of the site (required in production, the server refuses to start without it).
4. Set \`OPENCLOUDCMS_SECRET\` (random, at least 32 bytes) and \`DATABASE_URL\`.
5. Install with dev dependencies (do not use \`--omit=dev\` / \`--prod\`): \`start\` runs \`opencloudcms migrate:up\`, and \`@opencloudcms/cli\` and \`typescript\` are dev dependencies.
6. \`${pm} run start\`.

## Website

The website is the \`app/(site)\` route group; edit it like any Next app. To run only the API and no admin or website, set \`web: { enabled: false }\` in \`OpenCloudCmsModule.forRoot({ ... })\` (\`src/app.module.ts\`).

Limitation: Next keeps its cache in \`.next/cache\` on disk, so caching is only correct when a single instance runs.

## Languages

- Website languages are in \`src/locales.ts\` (\`defaultLocale\`, \`locales\`); \`opencloudcms.config.ts\` spreads it. Supported codes: \`en-US\`, \`vi-VN\`, \`fr-FR\`, \`id-ID\`. In dev the admin page Settings > Languages rewrites the file.
- Website strings are in \`app/(site)/messages.ts\` (\`defineMessages\`: \`en-US\` required, other languages may be partial). Translate with \`createTranslator(messages, locale)\`; format with \`formatDateTime\` / \`formatNumber\`.
- Server components import these helpers from \`@opencloudcms/core\` (in a server component it resolves to a small module without NestJS). Client components (\`'use client'\`) must import them from \`@opencloudcms/core/admin\`, which also has \`useLocale\`, \`useTranslator\` and \`useFormat\`.

## Security notes

- Keep \`.env\` out of version control (it is in \`.gitignore\`) and never reuse \`OPENCLOUDCMS_SECRET\` between environments.
- While no user exists, whoever opens \`/admin/setup\` first becomes the super admin (the server logs a WARN at every boot). In production, create the admin from the environment instead (\`OPENCLOUDCMS_ADMIN_EMAIL\` / \`OPENCLOUDCMS_ADMIN_PASSWORD\`).
- The rate limiter is in-memory: it is only correct with a single instance.
- Run behind HTTPS in production; the session cookie is only marked secure when \`OPENCLOUDCMS_PUBLIC_URL\` is https.
- \`OPENCLOUDCMS_ADMIN_EMAIL\` / \`OPENCLOUDCMS_ADMIN_PASSWORD\` create an administrator at start-up. Remove them from the environment once the account exists.
- The Content Type Builder writes schema files and migrations, so it is disabled when \`NODE_ENV=production\`.
`;
}
