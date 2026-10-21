import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { findProjectRoot } from './root';

async function bootstrap() {
  // Load .env before the app (and opencms.config.ts) is evaluated; variables already set win.
  const envFile = path.join(findProjectRoot(__dirname), '.env');
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      console.warn(`Could not load ${envFile}: ${(e as Error).message}`);
    }
  }
  const { AppModule } = await import('./app.module');
  // bodyParser: false — @opencms/core owns request body parsing.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  const publicUrl = process.env.OPENCMS_PUBLIC_URL ?? `http://localhost:${port}`;
  console.log(`OpenCMS ready at ${publicUrl}`);
  console.log(`Admin: ${publicUrl}/admin`);
}
// Exit on a boot failure: Next installs its own unhandledRejection handler, which would keep the process alive.
bootstrap().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
