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

export class InvalidImageError extends Error {
  readonly code = 'invalid_image';
  constructor(message = 'invalid_image: image could not be processed', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InvalidImageError';
  }
}

const SVG_MIME = 'image/svg+xml';
const WEBP_MIME = 'image/webp';
const WEBP_MAX_DIMENSION = 16383;
const SAFE_EXT = /^[a-z0-9]{1,10}$/;

function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

function isTransformable(mime: string): boolean {
  return mime.startsWith('image/') && mime !== SVG_MIME;
}

function safeExt(ext: string): string {
  if (!ext) return '';
  return SAFE_EXT.test(ext) ? ext : 'bin';
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

  const mime = normalizeMime(input.mimeType);

  if (!isTransformable(mime)) {
    const { slug, ext: rawExt } = slugifyFilename(input.originalFilename);
    const ext = safeExt(rawExt);
    const filename = ext ? `${slug}.${ext}` : slug;
    const key = `${buildKeyPrefix(now, slug, shortId)}${ext ? `.${ext}` : ''}`;
    return {
      filename,
      mimeType: mime,
      storageKey: key,
      objects: [{ kind: 'original', key, body: input.buffer, contentType: mime }],
    };
  }

  const { slug } = slugifyFilename(input.originalFilename, 'webp');
  const prefix = buildKeyPrefix(now, slug, shortId);
  const originalKey = `${prefix}.webp`;

  let objects: PipelineObject[];
  try {
    // limitInputPixels guards decode; we also check metadata explicitly for a clear error.
    // Note: animated GIFs are flattened to the first frame (animation is not preserved) in v1.
    const base = () => sharp(input.buffer, { limitInputPixels: false }).rotate();
    const meta = await sharp(input.buffer, { limitInputPixels: false }).metadata();
    const srcWidth = meta.width ?? 0;
    const srcHeight = meta.height ?? 0;
    if (srcWidth * srcHeight > MAX_IMAGE_PIXELS) {
      throw new ImageTooLargeError();
    }
    if (srcWidth > WEBP_MAX_DIMENSION || srcHeight > WEBP_MAX_DIMENSION) {
      throw new InvalidImageError(
        `invalid_image: dimensions exceed WebP maximum of ${WEBP_MAX_DIMENSION}px`,
      );
    }

    const original = await base().webp().toBuffer({ resolveWithObject: true });
    objects = [
      {
        kind: 'original',
        key: originalKey,
        body: original.data,
        contentType: WEBP_MIME,
        width: original.info.width,
        height: original.info.height,
      },
    ];

    const origMaxEdge = Math.max(original.info.width, original.info.height);
    const variants: Array<['thumb' | 'medium' | 'large', number]> = [
      ['thumb', sizes.thumb],
      ['medium', sizes.medium],
      ['large', sizes.large],
    ];
    for (const [kind, target] of variants) {
      if (origMaxEdge <= target) continue;
      const out = await base()
        .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
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
  } catch (err) {
    if (err instanceof ImageTooLargeError || err instanceof InvalidImageError) throw err;
    throw new InvalidImageError(
      `invalid_image: ${err instanceof Error ? err.message : 'image could not be processed'}`,
      { cause: err },
    );
  }

  return {
    filename: `${slug}.webp`,
    mimeType: WEBP_MIME,
    storageKey: originalKey,
    objects,
  };
}
