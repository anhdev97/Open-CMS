import * as path from 'node:path';
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
