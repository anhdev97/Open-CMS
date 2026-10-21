import { Module } from '@nestjs/common';
import { OpenCmsModule } from '@opencms/core';
import config from '../opencms.config';
import { contentTypes } from './generated';
import { hooks } from './extensions';
import { findProjectRoot } from './root';

const projectRoot = findProjectRoot(__dirname);

@Module({
  imports: [
    OpenCmsModule.forRoot({
      root: projectRoot,
      config,
      contentTypes,
      hooks,
      // Content Type Builder writes schema files + migrations: dev only.
      schemaEditable: process.env.NODE_ENV !== 'production',
      // One Next app (app/) serves the admin at /admin and the website everywhere else.
      web: { dir: projectRoot },
    }),
  ],
})
export class AppModule {}
