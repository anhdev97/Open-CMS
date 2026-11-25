import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
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
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { OAUTH2_CONFIG } from '@opencloudcms/oauth2';
import { SYSTEM_TABLES } from '@opencloudcms/schema';
import { ASSETS_DB, ASSETS_OPTIONS, DEFAULT_IMAGE_SIZES, DEFAULT_MAX_BYTES, STORAGE_PROVIDER } from '../constants';
import { ImageTooLargeError, InvalidImageError, processUpload } from '../pipeline/image-pipeline';
import { PRIVATE_KEY_PREFIX, type StorageProvider } from '../provider/storage-provider';
import { missingAlt } from '../seo/missing-alt';
import { resolveUploadMime } from '../sniff';
import type { AssetVariants, AssetsModuleOptions } from '../types';
import { FoldersService } from './folders.service';
import { deriveAssetLinkKey, signAssetLink, verifyAssetLink } from './signed-link';

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
  folderId?: string | null;
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
  folderId: string | null;
  storageKey: string | null;
  provider: string | null;
  variants: AssetVariants | null;
  metadata: unknown;
  createdAt: Date | string;
}

export type PublicAssetRow = Pick<AssetApiRow, 'id' | 'url' | 'alt' | 'width' | 'height' | 'mimeType'>;

/** A file for a private asset field (server API and admin upload). Its type is sniffed from `buffer`. */
export interface PrivateFileInput {
  buffer: Buffer;
  filename: string;
  /** Declared type: only used to tell text formats apart (binary types are always sniffed). */
  contentType?: string | null;
}

export interface PrivateUploadOptions {
  /** apiId of the private content type whose entry will own the file. */
  ownerApiId: string;
  /** Owning entry; null/absent = owned by the uploader until an entry save attaches it (decision 9). */
  ownerDocumentId?: string | null;
  /** The field's `accept` list (sniffed type must match). */
  accept?: readonly string[] | null;
  /** User id of the uploader, kept in `metadata.uploadedBy`. */
  uploadedBy?: string | null;
}

/** A private asset: `url` is always '' (no public URL exists); downloads go through `GET /api/admin/assets/:id/file`. */
export interface PrivateAssetApiRow extends AssetApiRow {
  visibility: 'private';
  ownerApiId: string;
  ownerDocumentId: string | null;
}

/** Unattached private uploads older than this are deleted by the sweeper. */
export const UNATTACHED_PRIVATE_TTL_MS = 24 * 3600_000;
const SWEEP_INTERVAL_MS = 3600_000;
const API_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 200;
const MAX_BULK = 100;

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
    folderId: row.folder_id ?? null,
    storageKey: row.storage_key ?? null,
    provider: row.provider ?? null,
    variants: parseJson<AssetVariants>(row.variants),
    metadata: parseJson(row.metadata),
    createdAt: row.created_at,
  };
}

function toPrivateApi(row: any): PrivateAssetApiRow {
  return { ...toApi(row), visibility: 'private', ownerApiId: row.owner_api_id, ownerDocumentId: row.owner_document_id ?? null };
}

/** Display filename of a private upload: no path, no control characters, at most 255 characters. */
function privateFilename(name: unknown): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return clean || 'file';
}

/**
 * Multer reads multipart filenames as latin1; a UTF-8 name arrives mis-decoded ("Ã©" for "é"). Re-decode when the
 * latin1 bytes form valid UTF-8, else keep the name as it came.
 */
export function decodeMultipartFilename(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
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
export class AssetsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AssetsService.name);
  private readonly linkKey: Buffer | null;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(ASSETS_DB) private readonly db: Kysely<any>,
    @Inject(FoldersService) private readonly folders: FoldersService,
    @Optional() @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider | null = null,
    @Optional() @Inject(ASSETS_OPTIONS) private readonly options: AssetsModuleOptions | null = null,
    @Optional() @Inject(OAUTH2_CONFIG) authConfig: { secret?: Buffer } | null = null,
  ) {
    this.linkKey = authConfig?.secret ? deriveAssetLinkKey(authConfig.secret) : null;
  }

  /** Sweeps unattached private uploads now and hourly (after every module's init, so migrations have run). */
  onApplicationBootstrap(): void {
    if (!this.provider) return;
    const sweep = () => {
      this.sweepUnattachedPrivateAssets().catch((e) => this.logger.error(`Private asset sweep failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    sweep();
    this.sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /** `ids` query (`a,b,…`): 1–100 UUIDs, else 400. */
  static parseIds(raw: unknown): string[] {
    const ids = typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (ids.length === 0) throw new BadRequestException('ids must list 1 to 100 asset ids');
    if (ids.length > MAX_BULK) throw new BadRequestException(`ids accepts at most ${MAX_BULK} ids`);
    if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('ids must be a comma-separated list of UUIDs');
    return [...new Set(ids)];
  }

  /** Existing assets among `ids` (unordered; missing ids are omitted). */
  async byIds(ids: string[]): Promise<{ data: AssetApiRow[] }> {
    const rows = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('id', 'in', ids).where('visibility', '=', 'public').execute();
    return { data: rows.map(toApi) };
  }

  /**
   * Public projection for the delivery API (`GET /api/content/assets?ids=`): only what a page needs to render an
   * image. Asset files are already served from public URLs.
   */
  async publicByIds(ids: string[]): Promise<{ data: PublicAssetRow[] }> {
    const { data } = await this.byIds(ids);
    return { data: data.map(({ id, url, alt, width, height, mimeType }) => ({ id, url, alt, width, height, mimeType })) };
  }

  /**
   * `folderId` omitted → all assets; `folderId=null` / query `root` → assets in root;
   * UUID → that folder only (not descendants).
   */
  async list(limit: number, folderId?: string | null | undefined): Promise<{ data: AssetApiRow[] }> {
    const n = Math.min(Math.max(Math.trunc(limit) || 50, 1), MAX_LIST);
    let q = this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('visibility', '=', 'public').orderBy('created_at', 'desc').limit(n);
    if (folderId === null) q = q.where('folder_id', 'is', null);
    else if (typeof folderId === 'string') {
      if (!UUID_RE.test(folderId)) throw new BadRequestException('Invalid folderId');
      q = q.where('folder_id', '=', folderId);
    }
    const rows = await q.execute();
    return { data: rows.map(toApi) };
  }

  async register(body: RegisterAssetInput): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
    if (!body?.filename || !body.url) throw new BadRequestException('filename and url are required');
    const filename = optString(body.filename, 'filename', 255)!;
    const url = optString(body.url, 'url', 2048)!;
    const mimeType = optString(body.mimeType, 'mimeType', 127);
    const alt = optString(body.alt, 'alt', 512);
    const folderId = await this.folders.assertExists(body.folderId);
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
        folder_id: folderId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const data = toApi(row);
    return { data, seo: { missingAlt: missingAlt(data) } };
  }

  async upload(
    file: UploadedFileInput,
    opts: { alt?: string; folderId?: string | null } = {},
  ): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
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
    const altText = optString(opts.alt, 'alt', 512);
    const folderId = await this.folders.assertExists(opts.folderId);
    // A folder slug must never produce a key in private storage (`private/…`) or one the static middleware refuses.
    const keyPrefix = (await this.folders.pathSlugs(folderId))
      .split('/')
      .map((seg) => (/^private(-assets)?$/i.test(seg) ? `${seg}-folder` : seg))
      .join('/');

    let processed;
    try {
      const s = this.options.image?.sizes;
      processed = await processUpload(
        { buffer: file.buffer, originalFilename: file.originalname, mimeType: file.mimetype },
        {
          keyPrefix: keyPrefix || undefined,
          sizes: {
            ...DEFAULT_IMAGE_SIZES,
            ...(s?.thumb ? { thumb: s.thumb } : {}),
            ...(s?.medium ? { medium: s.medium } : {}),
            ...(s?.large ? { large: s.large } : {}),
          },
        },
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
          folder_id: folderId,
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

  async patch(
    id: string,
    body: { alt?: string | null; folderId?: string | null },
  ): Promise<{ data: AssetApiRow; seo: { missingAlt: boolean } }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Asset not found');
    if (!body || (!('alt' in body) && !('folderId' in body))) throw new BadRequestException('alt or folderId is required');
    const patch: Record<string, unknown> = {};
    if ('alt' in body) {
      const alt = optString(body.alt, 'alt', 512);
      patch.alt = alt === null || alt.trim() === '' ? null : alt;
    }
    if ('folderId' in body) {
      patch.folder_id = await this.folders.assertExists(body.folderId);
    }
    const row = await this.db
      .updateTable(SYSTEM_TABLES.assets)
      .set(patch)
      .where('id', '=', id)
      .where('visibility', '=', 'public')
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Asset not found');
    const data = toApi(row);
    return { data, seo: { missingAlt: missingAlt(data) } };
  }

  async bulk(body: { action?: string; ids?: string[]; folderId?: string | null }): Promise<{ data: { ids: string[] } }> {
    const action = body?.action;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)) : [];
    if (!ids.length) throw new BadRequestException('ids is required');
    if (ids.length > MAX_BULK) throw new BadRequestException(`At most ${MAX_BULK} assets per bulk request`);
    if (action === 'delete') {
      for (const id of ids) await this.delete(id);
      return { data: { ids } };
    }
    if (action === 'move') {
      const folderId = await this.folders.assertExists(body.folderId);
      await this.db.updateTable(SYSTEM_TABLES.assets).set({ folder_id: folderId }).where('id', 'in', ids).where('visibility', '=', 'public').execute();
      return { data: { ids } };
    }
    throw new BadRequestException('action must be "move" or "delete"');
  }

  /**
   * Media library delete (public assets only). Deletes storage objects first, then the row. A storage failure
   * keeps the row (502). Private files are deleted with their entry (`deletePrivate`).
   */
  async delete(id: string): Promise<{ data: { id: string } }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Asset not found');
    const row = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('id', '=', id).where('visibility', '=', 'public').executeTakeFirst();
    if (!row) throw new NotFoundException('Asset not found');
    await this.removeRow(row);
    return { data: { id } };
  }

  private async removeRow(row: any): Promise<void> {
    const id = row.id as string;
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
  }

  /* ------------------------------ private files (spec §7) ------------------------------ */

  /**
   * Stores a private file under `private/<apiId>/<uuid>` with `url = ''`. Size limit: the module's `maxBytes`
   * (413). Type: sniffed from the bytes and checked against `accept` (415); the stored type is the sniffed one.
   */
  async uploadPrivate(file: PrivateFileInput, opts: PrivateUploadOptions): Promise<PrivateAssetApiRow> {
    const provider = this.provider;
    if (!provider || !this.options) throw new ServiceUnavailableException('Asset uploads are not configured');
    if (!file || !Buffer.isBuffer(file.buffer)) throw new BadRequestException('file is required');
    if (!API_ID_RE.test(opts.ownerApiId ?? '')) throw new BadRequestException('Invalid owner apiId');
    if (opts.ownerDocumentId != null && !UUID_RE.test(opts.ownerDocumentId)) throw new BadRequestException('Invalid owner documentId');
    const maxBytes = this.options.limits?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (file.buffer.length > maxBytes) throw new PayloadTooLargeException(`File exceeds maximum size of ${maxBytes} bytes`);
    const mime = resolveUploadMime(file.buffer, file.contentType, opts.accept);
    if (!mime) {
      throw new UnsupportedMediaTypeException({
        code: 'unsupported_file_type',
        message: opts.accept?.length ? `File content is not one of: ${opts.accept.join(', ')}` : 'Unknown file type',
      });
    }
    const key = `${PRIVATE_KEY_PREFIX}${opts.ownerApiId}/${randomUUID()}`;
    try {
      await provider.put(key, file.buffer, mime);
    } catch (err) {
      this.logger.error(`Storage put failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.cleanup(provider, [key]);
      throw new BadGatewayException('Failed to store asset');
    }
    try {
      const row = await this.db
        .insertInto(SYSTEM_TABLES.assets)
        .values({
          filename: privateFilename(file.filename),
          url: '',
          mime_type: mime,
          size: file.buffer.length,
          storage_key: key,
          provider: provider.kind,
          variants: null,
          folder_id: null,
          visibility: 'private',
          owner_api_id: opts.ownerApiId,
          owner_document_id: opts.ownerDocumentId ?? null,
          metadata: opts.uploadedBy ? JSON.stringify({ uploadedBy: opts.uploadedBy }) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPrivateApi(row);
    } catch (err) {
      await this.cleanup(provider, [key]);
      throw err;
    }
  }

  /** The private asset `id` (404 for unknown ids and public assets). */
  async privateById(id: string): Promise<PrivateAssetApiRow> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Asset not found');
    const row = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('id', '=', id).where('visibility', '=', 'private').executeTakeFirst();
    if (!row) throw new NotFoundException('Asset not found');
    return toPrivateApi(row);
  }

  /** Opens a private file for download. */
  async openPrivate(id: string): Promise<{ asset: PrivateAssetApiRow; stream: Readable }> {
    const asset = await this.privateById(id);
    const provider = this.provider;
    if (!asset.storageKey || !provider || (asset.provider && asset.provider !== provider.kind)) {
      throw new ConflictException(`Asset is stored with provider "${asset.provider ?? 'unknown'}" which is not configured`);
    }
    try {
      return { asset, stream: await provider.get(asset.storageKey) };
    } catch (err) {
      const e = err as { code?: unknown; name?: unknown } | null;
      if (e && (e.code === 'ENOENT' || e.code === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound')) {
        throw new NotFoundException('Asset file not found');
      }
      this.logger.error(`Storage get failed for asset ${id}: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadGatewayException('Failed to read asset from storage');
    }
  }

  /** Deletes a private file (storage, then row). Unknown ids are ignored. */
  async deletePrivate(id: string): Promise<void> {
    if (!UUID_RE.test(id)) return;
    const row = await this.db.selectFrom(SYSTEM_TABLES.assets).selectAll().where('id', '=', id).where('visibility', '=', 'private').executeTakeFirst();
    if (row) await this.removeRow(row);
  }

  /**
   * Deletes private uploads that no entry attached (`owner_document_id is null`) and that are older than 24 h.
   * Returns the deleted ids; a file that cannot be deleted is logged and left for the next sweep.
   */
  async sweepUnattachedPrivateAssets(now: Date = new Date()): Promise<string[]> {
    const cutoff = new Date(now.getTime() - UNATTACHED_PRIVATE_TTL_MS);
    const rows = await this.db
      .selectFrom(SYSTEM_TABLES.assets)
      .selectAll()
      .where('visibility', '=', 'private')
      .where('owner_document_id', 'is', null)
      .where('created_at', '<', cutoff)
      .execute();
    const deleted: string[] = [];
    for (const row of rows) {
      try {
        await this.removeRow(row);
        deleted.push(row.id);
      } catch (err) {
        this.logger.warn(`Could not sweep private asset ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return deleted;
  }

  /** A 5-minute signed download link for a private asset, bound to `userId` (decision 15). */
  async createLink(id: string, userId: string): Promise<{ url: string; expiresAt: string }> {
    if (!this.linkKey) throw new ServiceUnavailableException('Signed links need the auth secret');
    const asset = await this.privateById(id);
    const { token, expiresAt } = signAssetLink(this.linkKey, asset.id, userId);
    return { url: `/api/admin/assets/${asset.id}/file?token=${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Whether `token` is a valid, unexpired link for asset `id`. */
  verifyLink(id: string, token: string): boolean {
    return !!this.linkKey && verifyAssetLink(this.linkKey, token, id) !== null;
  }

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
