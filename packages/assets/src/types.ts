export type StorageProviderKind = 'local' | 's3' | 'gcs';

export interface VariantInfo {
  url: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
}

export interface AssetVariants {
  original: VariantInfo;
  thumb?: VariantInfo;
  medium?: VariantInfo;
  large?: VariantInfo;
}

export interface LocalAssetsConfig {
  root: string;
  publicBaseUrl: string;
}

export interface S3AssetsConfig {
  bucket: string;
  region: string;
  publicBaseUrl?: string;
}

export interface GcsAssetsConfig {
  bucket: string;
  publicBaseUrl?: string;
}

export interface AssetsImageConfig {
  sizes?: { thumb?: number; medium?: number; large?: number };
}

export interface AssetsLimitsConfig {
  maxBytes?: number;
  accept?: string[];
}

export interface AssetsModuleOptions {
  provider: StorageProviderKind;
  local?: LocalAssetsConfig;
  s3?: S3AssetsConfig;
  gcs?: GcsAssetsConfig;
  limits?: AssetsLimitsConfig;
  image?: AssetsImageConfig;
}
