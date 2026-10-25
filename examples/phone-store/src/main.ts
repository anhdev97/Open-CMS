import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { findProjectRoot } from './root';

async function bootstrap() {
  const envFile = path.join(findProjectRoot(__dirname), '.env');
  if (fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch (e) {
      console.warn(`Could not load ${envFile}: ${(e as Error).message}`);
    }
  }
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port);
  const publicUrl = process.env.OPENCLOUDCMS_PUBLIC_URL ?? `http://localhost:${port}`;
  console.log(`OpenCloudCMS ready at ${publicUrl}`);
  console.log(`Admin: ${publicUrl}/admin`);
  console.log(`Store: ${publicUrl}/`);
}

bootstrap().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
