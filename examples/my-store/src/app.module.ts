import { Module } from '@nestjs/common';
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
      web: { dir: projectRoot },
    }),
  ],
})
export class AppModule {}
