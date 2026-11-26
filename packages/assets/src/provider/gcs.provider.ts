import type { Readable } from 'node:stream';
import type { GcsAssetsConfig } from '../types';
import type { AssetVisibility, StorageProvider } from './storage-provider';

interface GcsFile {
  save(data: Buffer, options?: { contentType?: string; resumable?: boolean }): Promise<unknown>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  createReadStream(): Readable;
  exists?(): Promise<[boolean]>;
}

interface GcsBucket {
  file(key: string): GcsFile;
}

interface GcsSdk {
  Storage: new () => { bucket(name: string): GcsBucket };
}

export interface GcsProviderDeps {
  /** Pre-built bucket handle (tests / custom credentials). Defaults to `new Storage().bucket(bucket)`. */
  bucket?: GcsBucket;
  /** Pre-built handle for `privateBucket` (tests / custom credentials). Defaults to `new Storage().bucket(privateBucket)`. */
  privateBucket?: GcsBucket;
}

function loadStorage(): { bucket(name: string): GcsBucket } {
  let sdk: GcsSdk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require('@google-cloud/storage') as GcsSdk;
  } catch (err) {
    throw new Error('Provider "gcs" requires optional peer @google-cloud/storage', { cause: err });
  }
  return new sdk.Storage();
}

export function createGcsProvider(cfg: GcsAssetsConfig, deps?: GcsProviderDeps): StorageProvider {
  let storage: { bucket(name: string): GcsBucket } | undefined;
  const open = (name: string): GcsBucket => (storage ??= loadStorage()).bucket(name);
  const bucket = deps?.bucket ?? open(cfg.bucket);
  // Private objects go to `privateBucket` when configured, otherwise they share the main bucket.
  const privateBucket = cfg.privateBucket ? (deps?.privateBucket ?? open(cfg.privateBucket)) : bucket;
  const bucketFor = (visibility: AssetVisibility = 'public'): GcsBucket => (visibility === 'private' ? privateBucket : bucket);
  const baseUrl = (cfg.publicBaseUrl ?? `https://storage.googleapis.com/${cfg.bucket}`).replace(/\/+$/, '');

  return {
    kind: 'gcs',

    async put(key: string, body: Buffer, contentType: string, visibility?: AssetVisibility): Promise<void> {
      await bucketFor(visibility).file(key).save(body, { contentType, resumable: false });
    },

    async delete(key: string, visibility?: AssetVisibility): Promise<void> {
      await bucketFor(visibility).file(key).delete({ ignoreNotFound: true });
    },

    publicUrl(key: string): string {
      return `${baseUrl}/${key}`;
    },

    async get(key: string, visibility?: AssetVisibility): Promise<Readable> {
      // Fail before streaming when the object is missing (the stream would only error later).
      const file = bucketFor(visibility).file(key);
      if (file.exists) {
        const [exists] = await file.exists();
        if (!exists) throw Object.assign(new Error(`GCS object "${key}" not found`), { code: 'ENOENT' });
      }
      return file.createReadStream();
    },
  };
}
