import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { SYSTEM_TABLES } from '@opencms/schema';
import { ASSETS_DB, ASSETS_OPTIONS, DEFAULT_IMAGE_SIZES, DEFAULT_MAX_BYTES, STORAGE_PROVIDER } from '../constants';
import { ImageTooLargeError, InvalidImageError, processUpload } from '../pipeline/image-pipeline';
import type { StorageProvider } from '../provider/storage-provider';
import { missingAlt } from '../seo/missing-alt';
import type { AssetVariants, AssetsModuleOptions } from '../types';

export interface UploadedFileInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface RegisterAssetInput {
  filename?: string;
  url?: string;
  mimeType?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface AssetApiRow {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  storageKey: string | null;
  provider: string | null;
  variants: AssetVariants | null;
  metadata: unknown;
  createdAt: Date | string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 200;

function parseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

function toApi(row: any): AssetApiRow {
  return {
    id: row.id,
    filename: row.filename,
    url: row.url,
    mimeType: row.mime_type ?? null,
    size: row.size == null ? null : Number(row.size),
    width: row.width ?? null,
    height: row.height ?? null,
    alt: row.alt ?? null,
    storageKey: row.storage_key ?? null,
    provider: row.provider ?? null,
    variants: parseJson<AssetVariants>(row.variants),
    metadata: parseJson(row.metadata),
    createdAt: row.created_at,
  };
}

function optString(v: unknown, field: string, max: number): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw new BadRequestException(`${field} must be a string`);
  if (v.length > max) throw new BadRequestException(`${field} must be at most ${max} characters`);
  return v;
}

function optInt(v: unknown, field: string): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new BadRequestException(`${field} must be a non-negative integer`);
  return v;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @Inject(ASSETS_DB) private readonly db: Kysely<any>,
    @Optional() @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider | null = null,
    @Optional() @Inject(ASSETS_OPTIONS) private readonly options: AssetsModuleOptions | null = null,
  ) {}

  async list(limit: number): Promise<{ data: AssetApiRow[] }> {
    const n = Math.min(Math.max(Math.trunc(limit) || 50, 1), MAX_LIST);
    const rows = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().orderBy('created_at', 'desc').limit(n).execute();
    return { data: rows.map(toApi) };
  }

  /** Registers an asset that already lives at `url` (no storage provider involved). */
  async register(body: RegisterAssetInput): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
    if (!body?.filename || !body.url) throw new BadRequestException('filename and url are required');
    const filename = optString(body.filename, 'filename', 255)!;
    const url = optString(body.url, 'url', 2048)!;
    const mimeType = optString(body.mimeType, 'mimeType', 127);
    const alt = optString(body.alt, 'alt', 512);
    const row = await this.db
      .insertInto(SYSTEM_TABLES.assets)
      .values({
        filename,
        url,
        mime_type: mimeType,
        alt,
        width: optInt(body.width, 'width'),
        height: optInt(body.height, 'height'),
        variants: null,
        provider: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const data = toApi(row);
    return { data, seo: { missingAlt: missingAlt(data) } };
  }

  async upload(file: UploadedFileInput, alt?: string): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
    const provider = this.provider;
    if (!provider || !this.options) throw new Error('Asset uploads are not configured');
    if (!file?.buffer) throw new BadRequestException('file is required');

    const maxBytes = this.options.limits?.maxBytes ?? DEFAULT_MAX_BYTES;
    const size = file.size ?? file.buffer.length;
    if (size > maxBytes || file.buffer.length > maxBytes) {
      throw new PayloadTooLargeException(`File exceeds maximum size of ${maxBytes} bytes`);
    }
    const accept = this.options.limits?.accept;
    const mime = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    if (accept?.length && !accept.some((a) => acceptMatches(a, mime))) {
      throw new UnsupportedMediaTypeException(`Unsupported file type "${mime}"`);
    }
    const altText = optString(alt, 'alt', 512);

    let processed;
    try {
      const s = this.options.image?.sizes;
      processed = await processUpload(
        { buffer: file.buffer, originalFilename: file.originalname, mimeType: file.mimetype },
        { sizes: { ...DEFAULT_IMAGE_SIZES, ...(s?.thumb ? { thumb: s.thumb } : {}), ...(s?.medium ? { medium: s.medium } : {}), ...(s?.large ? { large: s.large } : {}) } },
      );
    } catch (err) {
      if (err instanceof ImageTooLargeError) throw new BadRequestException({ message: err.message, code: err.code });
      if (err instanceof InvalidImageError) throw new BadRequestException({ message: err.message, code: err.code });
      throw err;
    }

    const putKeys: string[] = [];
    try {
      for (const obj of processed.objects) {
        await provider.put(obj.key, obj.body, obj.contentType);
        putKeys.push(obj.key);
      }
    } catch (err) {
      this.logger.error(`Storage put failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.cleanup(provider, putKeys);
      throw new BadGatewayException('Failed to store asset');
    }

    const variants: Record<string, unknown> = {};
    for (const obj of processed.objects) {
      variants[obj.kind] = {
        key: obj.key,
        url: provider.publicUrl(obj.key),
        width: obj.width,
        height: obj.height,
        bytes: obj.body.length,
        mimeType: obj.contentType,
      };
    }
    const original = processed.objects.find((o) => o.kind === 'original')!;

    let row;
    try {
      row = await this.db
        .insertInto(SYSTEM_TABLES.assets)
        .values({
          filename: processed.filename,
          url: provider.publicUrl(processed.storageKey),
          mime_type: processed.mimeType,
          size: original.body.length,
          width: original.width ?? null,
          height: original.height ?? null,
          alt: altText,
          storage_key: processed.storageKey,
          provider: provider.kind,
          variants: JSON.stringify(variants),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      const leftover = await this.cleanup(provider, putKeys);
      this.logger.error(
        `Asset DB insert failed after storage put (${err instanceof Error ? err.message : String(err)}); ` +
          (leftover.length ? `orphaned storage keys: ${leftover.join(', ')}` : 'stored objects were removed'),
      );
      throw err;
    }

    const data = toApi(row);
    return { data, seo: { missingAlt: missingAlt(data) } };
  }

  async patch(id: string, body: { alt?: string | null }): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Asset not found');
    if (!body || !('alt' in body)) throw new BadRequestException('alt is required');
    const alt = optString(body.alt, 'alt', 512);
    const row = await this.db
      .updateTable(SYSTEM_TABLES.assets)
      .set({ alt: alt === null || alt.trim() === '' ? null : alt })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Asset not found');
    const data = toApi(row);
    return { data, seo: { missingAlt: missingAlt(data) } };
  }

  /** Deletes storage objects first, then the row. A storage failure keeps the row (502). */
  async delete(id: string): Promise<{ data: { id: string } }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Asset not found');
    const row = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Asset not found');

    const keys = collectKeys(row);
    if (keys.length) {
      if (!this.provider || (row.provider && row.provider !== this.provider.kind)) {
        throw new ConflictException(`Asset is stored with provider "${row.provider ?? 'unknown'}" which is not configured`);
      }
      try {
        for (const key of keys) await this.provider.delete(key);
      } catch (err) {
        this.logger.error(`Storage delete failed for asset ${id}: ${err instanceof Error ? err.message : String(err)}`);
        throw new BadGatewayException('Failed to delete asset from storage');
      }
    }
    await this.db.deleteFrom(SYSTEM_TABLES.assets).where('id', '=', id).execute();
    return { data: { id } };
  }

  /** Best-effort delete; returns keys that could not be removed. */
  private async cleanup(provider: StorageProvider, keys: string[]): Promise<string[]> {
    const leftover: string[] = [];
    for (const key of keys) {
      try {
        await provider.delete(key);
      } catch {
        leftover.push(key);
      }
    }
    return leftover;
  }
}

function acceptMatches(pattern: string, mime: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p === '*/*') return true;
  if (p.endsWith('/*')) return mime.startsWith(p.slice(0, -1));
  return p === mime;
}

function collectKeys(row: any): string[] {
  const keys = new Set<string>();
  if (row.storage_key) keys.add(row.storage_key);
  const variants = parseJson<Record<string, { key?: string } | undefined>>(row.variants);
  if (variants) for (const v of Object.values(variants)) if (v?.key) keys.add(v.key);
  return [...keys];
}
