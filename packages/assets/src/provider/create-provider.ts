import type { AssetsModuleOptions } from '../types';
import { createLocalServerProvider } from './local.provider';
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
    case 's3':
    case 'gcs':
      // Added in a later task (Task 7).
      throw new Error(`${assets.provider === 's3' ? 'S3' : 'GCS'} provider not available yet`);
    default:
      throw new Error(`Unknown assets provider "${String((assets as { provider: unknown }).provider)}"`);
  }
}
