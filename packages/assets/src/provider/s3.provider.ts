import type { S3AssetsConfig } from '../types';
import type { StorageProvider } from './storage-provider';

interface S3Client {
  send(cmd: unknown): Promise<unknown>;
}

interface S3Sdk {
  S3Client: new (config: { region: string }) => S3Client;
  PutObjectCommand: new (input: { Bucket: string; Key: string; Body: Buffer; ContentType: string }) => unknown;
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
}

export interface S3ProviderDeps {
  /** Pre-built client (tests / custom credentials). Defaults to `new S3Client({ region })`. */
  client?: S3Client;
}

function loadSdk(): S3Sdk {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@aws-sdk/client-s3') as S3Sdk;
  } catch (err) {
    throw new Error('Provider "s3" requires optional peer @aws-sdk/client-s3', { cause: err });
  }
}

export function createS3Provider(cfg: S3AssetsConfig, deps?: S3ProviderDeps): StorageProvider {
  const sdk = loadSdk();
  const client = deps?.client ?? new sdk.S3Client({ region: cfg.region });
  const { bucket, region } = cfg;
  const baseUrl = (cfg.publicBaseUrl ?? `https://${bucket}.s3.${region}.amazonaws.com`).replace(/\/+$/, '');

  return {
    kind: 's3',

    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async delete(key: string): Promise<void> {
      await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    publicUrl(key: string): string {
      return `${baseUrl}/${key}`;
    },
  };
}
