import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { LocalAssetsConfig } from '../types';
import { PRIVATE_KEY_PREFIX, isPrivateKey, type StorageProvider } from './storage-provider';

/**
 * Private files (`private/…` keys) live in `privateRoot`, by default `private-assets` next to `root`: outside the
 * directory the local-static middleware serves.
 */
export function localPrivateRoot(cfg: LocalAssetsConfig): string {
  return path.resolve(cfg.privateRoot ?? path.join(path.dirname(path.resolve(cfg.root)), 'private-assets'));
}

export function createLocalServerProvider(cfg: LocalAssetsConfig): StorageProvider {
  const { root, publicBaseUrl } = cfg;
  const baseUrl = publicBaseUrl.replace(/\/$/, '');
  const privateRoot = localPrivateRoot(cfg);
  const publicRoot = path.resolve(root);
  if (privateRoot === publicRoot || privateRoot.startsWith(publicRoot + path.sep)) {
    throw new Error('assets.local.privateRoot must be outside assets.local.root (the statically served directory)');
  }
  const filePath = (key: string): string =>
    isPrivateKey(key) ? path.join(privateRoot, key.slice(PRIVATE_KEY_PREFIX.length)) : path.join(root, key);

  return {
    kind: 'local',

    async put(key: string, body: Buffer, _contentType: string): Promise<void> {
      const p = filePath(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },

    async delete(key: string): Promise<void> {
      try {
        await fs.unlink(filePath(key));
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

    async get(key: string): Promise<Readable> {
      // Open first, so that a missing file rejects here rather than erroring mid-stream.
      const handle = await fs.open(filePath(key), 'r');
      return handle.createReadStream();
    },
  };
}
