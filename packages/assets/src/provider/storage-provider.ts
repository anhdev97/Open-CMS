import type { Readable } from 'node:stream';
import type { StorageProviderKind } from '../types';

/** Keys of private files start with this prefix (spec §7): no public URL, never served statically. */
export const PRIVATE_KEY_PREFIX = 'private/';

export const isPrivateKey = (key: string): boolean => key.startsWith(PRIVATE_KEY_PREFIX);

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  /** Streams a stored object (private downloads). Rejects when it does not exist. */
  get(key: string): Promise<Readable>;
}
