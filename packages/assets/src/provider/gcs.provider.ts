import type { Readable } from 'node:stream';
import type { GcsAssetsConfig } from '../types';
import type { StorageProvider } from './storage-provider';

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
}

function loadBucket(name: string): GcsBucket {
  let sdk: GcsSdk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require('@google-cloud/storage') as GcsSdk;
  } catch (err) {
    throw new Error('Provider "gcs" requires optional peer @google-cloud/storage', { cause: err });
  }
  return new sdk.Storage().bucket(name);
}

export function createGcsProvider(cfg: GcsAssetsConfig, deps?: GcsProviderDeps): StorageProvider {
  const bucket = deps?.bucket ?? loadBucket(cfg.bucket);
  const baseUrl = (cfg.publicBaseUrl ?? `https://storage.googleapis.com/${cfg.bucket}`).replace(/\/+$/, '');

  return {
    kind: 'gcs',

    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      await bucket.file(key).save(body, { contentType, resumable: false });
    },

    async delete(key: string): Promise<void> {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },

    publicUrl(key: string): string {
      return `${baseUrl}/${key}`;
    },

    async get(key: string): Promise<Readable> {
      // Fail before streaming when the object is missing (the stream would only error later).
      const file = bucket.file(key);
      if (file.exists) {
        const [exists] = await file.exists();
        if (!exists) throw Object.assign(new Error(`GCS object "${key}" not found`), { code: 'ENOENT' });
      }
      return file.createReadStream();
    },
  };
}
