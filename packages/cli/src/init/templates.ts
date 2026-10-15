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
          dev: 'opencms migrate:up && tsx src/main.ts',
          build: 'tsc -p tsconfig.json',
          start: 'opencms migrate:up && node dist/src/main.js',
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

export const configTs = (): string => `import { defineConfig } from '@opencms/schema';

export default defineConfig({
  database: { url: process.env.DATABASE_URL! },
  defaultLocale: 'en',
  locales: ['en'],
});
`;

export const mainTs = (): string => `import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  // Load .env before the app (and opencms.config.ts) is evaluated; variables already set win.
  const envFile = path.resolve(__dirname, '..', '.env');
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

export const appModuleTs = (): string => `import * as path from 'node:path';
import { Module } from '@nestjs/common';
import { OpenCmsModule } from '@opencms/core';
import config from '../opencms.config';
import { contentTypes } from './generated';
import { hooks } from './extensions';

@Module({
  imports: [
    OpenCmsModule.forRoot({
      root: path.resolve(__dirname, '..'),
      config,
      contentTypes,
      hooks,
      // Content Type Builder writes schema files + migrations: dev only.
      schemaEditable: process.env.NODE_ENV !== 'production',
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
`;
}

export const gitignore = (): string => 'node_modules\ndist\n.env\n*.log\n';

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

Configuration lives in \`.env\` (see \`.env.example\`). Every \`opencms\` command loads it automatically.

## Deploy

1. Set \`NODE_ENV=production\`.
2. Set \`OPENCMS_PUBLIC_URL\` to the public URL of the site (required in production, the server refuses to start without it).
3. Set \`OPENCMS_SECRET\` (random, at least 32 bytes) and \`DATABASE_URL\`.
4. \`${pm} run build\`, then \`${pm} run start\` (applies migrations, then starts \`dist/src/main.js\`).

## Security notes

- Keep \`.env\` out of version control (it is in \`.gitignore\`) and never reuse \`OPENCMS_SECRET\` between environments.
- While no user exists, whoever opens \`/admin/setup\` first becomes the super admin (the server logs a WARN at every boot). In production, create the admin from the environment instead (\`OPENCMS_ADMIN_EMAIL\` / \`OPENCMS_ADMIN_PASSWORD\`).
- The rate limiter is in-memory: it is only correct with a single instance.
- Run behind HTTPS in production; the session cookie is only marked secure when \`OPENCMS_PUBLIC_URL\` is https.
- \`OPENCMS_ADMIN_EMAIL\` / \`OPENCMS_ADMIN_PASSWORD\` create an administrator at start-up. Remove them from the environment once the account exists.
- The Content Type Builder writes schema files and migrations, so it is disabled when \`NODE_ENV=production\`.
`;
}
