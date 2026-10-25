import type { AssetsModuleOptions } from '../types';
import { createLocalServerProvider } from './local.provider';
import { createS3Provider } from './s3.provider';
import { createGcsProvider } from './gcs.provider';
import type { StorageProvider } from './storage-provider';

/** Builds the configured StorageProvider. Throws on incomplete config or an unavailable provider kind. */
export function createProvider(assets: AssetsModuleOptions): StorageProvider {
  switch (assets.provider) {
    case 'local': {
      if (!assets.local?.root || !assets.local.publicBaseUrl) {
        throw new Error('assets.local.root and assets.local.publicBaseUrl are required for the local provider');
      }
      return createLocalServerProvider(assets.local);
    }
    case 's3': {
      if (!assets.s3?.bucket || !assets.s3.region) {
        throw new Error('assets.s3.bucket and assets.s3.region are required for the s3 provider');
      }
      return createS3Provider(assets.s3);
    }
    case 'gcs': {
      if (!assets.gcs?.bucket) {
        throw new Error('assets.gcs.bucket is required for the gcs provider');
      }
      return createGcsProvider(assets.gcs);
    }
    default:
      throw new Error(`Unknown assets provider "${String((assets as { provider: unknown }).provider)}"`);
  }
}
