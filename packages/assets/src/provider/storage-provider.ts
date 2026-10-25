import type { StorageProviderKind } from '../types';

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
