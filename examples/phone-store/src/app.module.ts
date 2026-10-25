import { Module } from '@nestjs/common';
import path from 'node:path';
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
      contentGroups,
      hooks,
      schemaEditable: process.env.NODE_ENV !== 'production',
      assets: {
        provider: 'local',
        local: {
          root: path.join(projectRoot, 'uploads'),
          publicBaseUrl: '/media',
        },
      },
      // Seed boots this module without Next (`OPENCLOUDCMS_WEB=0`).
      web: process.env.OPENCLOUDCMS_WEB === '0' ? { enabled: false } : { dir: projectRoot },
    }),
  ],
})
export class AppModule {}
