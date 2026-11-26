import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { LocalAssetsConfig } from '../types';
import { PRIVATE_KEY_PREFIX, type AssetVisibility, type StorageProvider } from './storage-provider';

/**
 * Private files live in `privateRoot`, by default `private-assets` next to `root`: outside the directory the
 * local-static middleware serves.
 */
export function localPrivateRoot(cfg: LocalAssetsConfig): string {
  return path.resolve(cfg.privateRoot ?? path.join(path.dirname(path.resolve(cfg.root)), 'private-assets'));
}

/** Real path of `p`: its nearest existing ancestor resolved through symlinks, plus the part that does not exist yet. */
function realish(p: string): string {
  const abs = path.resolve(p);
  let existing = abs;
  const rest: string[] = [];
  while (!fsSync.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fsSync.realpathSync.native(existing), ...rest);
}

const within = (child: string, parent: string): boolean => child === parent || child.startsWith(parent + path.sep);

export function createLocalServerProvider(cfg: LocalAssetsConfig): StorageProvider {
  const { root, publicBaseUrl } = cfg;
  const baseUrl = publicBaseUrl.replace(/\/$/, '');
  const privateRoot = localPrivateRoot(cfg);
  const realPublic = realish(root);
  const realPrivate = realish(privateRoot);
  if (within(realPrivate, realPublic) || within(realPublic, realPrivate)) {
    throw new Error('assets.local.privateRoot and assets.local.root must not contain each other (root is served statically)');
  }
  // Private keys carry the `private/` prefix; inside privateRoot it is dropped.
  const filePath = (key: string, visibility: AssetVisibility = 'public'): string =>
    visibility === 'private'
      ? path.join(privateRoot, key.startsWith(PRIVATE_KEY_PREFIX) ? key.slice(PRIVATE_KEY_PREFIX.length) : key)
      : path.join(root, key);

  return {
    kind: 'local',

    async put(key: string, body: Buffer, _contentType: string, visibility?: AssetVisibility): Promise<void> {
      const p = filePath(key, visibility);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },

    async delete(key: string, visibility?: AssetVisibility): Promise<void> {
      try {
        await fs.unlink(filePath(key, visibility));
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

    async get(key: string, visibility?: AssetVisibility): Promise<Readable> {
      // Open first, so that a missing file rejects here rather than erroring mid-stream.
      const handle = await fs.open(filePath(key, visibility), 'r');
      return handle.createReadStream();
    },
  };
}
