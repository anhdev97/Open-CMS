import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { DEFAULT_IMAGE_SIZES, MAX_IMAGE_PIXELS } from '../constants';
import { slugifyFilename } from '../seo/slug';

export type VariantKind = 'original' | 'thumb' | 'medium' | 'large';

export interface PipelineObject {
  kind: VariantKind;
  key: string;
  body: Buffer;
  contentType: string;
  width?: number;
  height?: number;
}

export interface ProcessedUpload {
  filename: string;
  mimeType: string;
  storageKey: string;
  objects: PipelineObject[];
}

export interface ProcessUploadInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}

export interface ProcessUploadOptions {
  now?: Date;
  shortId?: string;
  sizes?: { thumb: number; medium: number; large: number };
}

export class ImageTooLargeError extends Error {
  readonly code = 'image_too_large';
  constructor(message = 'image_too_large: image exceeds maximum pixel count') {
    super(message);
    this.name = 'ImageTooLargeError';
  }
}

const SVG_MIME = 'image/svg+xml';
const WEBP_MIME = 'image/webp';

function isTransformable(mimeType: string): boolean {
  return mimeType.startsWith('image/') && mimeType !== SVG_MIME;
}

function buildKeyPrefix(now: Date, slug: string, shortId: string): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${slug}-${shortId}`;
}

export async function processUpload(
  input: ProcessUploadInput,
  opts: ProcessUploadOptions = {},
): Promise<ProcessedUpload> {
  const now = opts.now ?? new Date();
  const shortId = opts.shortId ?? randomBytes(2).toString('hex');
  const sizes = opts.sizes ?? DEFAULT_IMAGE_SIZES;

  if (!isTransformable(input.mimeType)) {
    const { slug, ext } = slugifyFilename(input.originalFilename);
    const filename = ext ? `${slug}.${ext}` : slug;
    const key = `${buildKeyPrefix(now, slug, shortId)}${ext ? `.${ext}` : ''}`;
    return {
      filename,
      mimeType: input.mimeType,
      storageKey: key,
      objects: [{ kind: 'original', key, body: input.buffer, contentType: input.mimeType }],
    };
  }

  const { slug } = slugifyFilename(input.originalFilename, 'webp');
  const prefix = buildKeyPrefix(now, slug, shortId);
  const originalKey = `${prefix}.webp`;

  // limitInputPixels guards decode; we also check metadata explicitly for a clear error.
  const base = () => sharp(input.buffer, { limitInputPixels: false }).rotate();
  const meta = await sharp(input.buffer, { limitInputPixels: false }).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (srcWidth * srcHeight > MAX_IMAGE_PIXELS) {
    throw new ImageTooLargeError();
  }

  const original = await base().webp().toBuffer({ resolveWithObject: true });
  const objects: PipelineObject[] = [
    {
      kind: 'original',
      key: originalKey,
      body: original.data,
      contentType: WEBP_MIME,
      width: original.info.width,
      height: original.info.height,
    },
  ];

  const origWidth = original.info.width;
  const variants: Array<['thumb' | 'medium' | 'large', number]> = [
    ['thumb', sizes.thumb],
    ['medium', sizes.medium],
    ['large', sizes.large],
  ];
  for (const [kind, target] of variants) {
    if (origWidth <= target) continue;
    const out = await base()
      .resize({ width: target, withoutEnlargement: true })
      .webp()
      .toBuffer({ resolveWithObject: true });
    objects.push({
      kind,
      key: `${prefix}_${kind}.webp`,
      body: out.data,
      contentType: WEBP_MIME,
      width: out.info.width,
      height: out.info.height,
    });
  }

  return {
    filename: `${slug}.webp`,
    mimeType: WEBP_MIME,
    storageKey: originalKey,
    objects,
  };
}
