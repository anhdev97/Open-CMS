import * as fs from 'node:fs';
import * as path from 'node:path';
import { Module } from '@nestjs/common';
import { OpenCmsModule } from '@opencms/core';
import config from '../opencms.config';
import { contentTypes } from './generated';
import { hooks } from './extensions';

function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

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
