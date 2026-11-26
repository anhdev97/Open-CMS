export type StorageProviderKind = 'local' | 's3' | 'gcs';

export interface VariantInfo {
  /** Storage object key (used for deletes). */
  key: string;
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
  /** Directory of private files (spec §7). Default: `private-assets` next to `root`; never under `root`. */
  privateRoot?: string;
}

export interface S3AssetsConfig {
  bucket: string;
  region: string;
  publicBaseUrl?: string;
  /** Bucket for private files (`private/<apiId>/<uuid>`). When unset they share `bucket`, whose policy must then deny public reads on `private/*`. */
  privateBucket?: string;
}

export interface GcsAssetsConfig {
  bucket: string;
  publicBaseUrl?: string;
  /** Bucket for private files (`private/<apiId>/<uuid>`). When unset they share `bucket`, which must then keep `private/*` non-public. */
  privateBucket?: string;
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
