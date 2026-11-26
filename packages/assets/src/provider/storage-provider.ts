import type { Readable } from 'node:stream';
import type { StorageProviderKind } from '../types';

/** Keys of private files start with this prefix (spec §7), so that S3/GCS bucket policies can keep them private. */
export const PRIVATE_KEY_PREFIX = 'private/';

export const isPrivateKey = (key: string): boolean => key.startsWith(PRIVATE_KEY_PREFIX);

/** Where an object lives: `public` files may have a public URL, `private` ones never do. */
export type AssetVisibility = 'public' | 'private';

/**
 * Every call takes the object's visibility explicitly (default `public`), so where an object is stored never depends
 * on how its key looks (the local provider keeps private files in a separate directory).
 */
export interface StorageProvider {
  readonly kind: StorageProviderKind;
  put(key: string, body: Buffer, contentType: string, visibility?: AssetVisibility): Promise<void>;
  delete(key: string, visibility?: AssetVisibility): Promise<void>;
  publicUrl(key: string): string;
  /** Streams a stored object (private downloads). Rejects when it does not exist. */
  get(key: string, visibility?: AssetVisibility): Promise<Readable>;
}
