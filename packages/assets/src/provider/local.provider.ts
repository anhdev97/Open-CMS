import fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalAssetsConfig } from '../types';
import type { StorageProvider } from './storage-provider';

export function createLocalServerProvider(cfg: LocalAssetsConfig): StorageProvider {
  const { root, publicBaseUrl } = cfg;
  const baseUrl = publicBaseUrl.replace(/\/$/, '');

  return {
    kind: 'local',

    async put(key: string, body: Buffer, _contentType: string): Promise<void> {
      const filePath = path.join(root, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body);
    },

    async delete(key: string): Promise<void> {
      const filePath = path.join(root, key);
      try {
        await fs.unlink(filePath);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          return;
        }
        throw err;
      }
    },

    publicUrl(key: string): string {
      return `${baseUrl}/${key}`;
    },
  };
}
